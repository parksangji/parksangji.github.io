---
title: "LATERAL 조인의 진짜 비용: 스코프 규칙, loops, 그리고 de-correlate"
date: 2026-08-28 13:00:00 +0900
series: "PostgreSQL"
categories: [Database]
tags: [postgresql, lateral, join, explain, covering-index, index-only-scan]
description: "LATERAL이 성능 기능이 아니라 스코프 규칙인 이유, loops가 곱해지는 계획 읽기, 커버링 인덱스와 GROUP BY de-correlate 리라이팅을 다룬다."
---

목록 조회에서 구분 코드별로 `EXISTS`를 네 번 걸던 쿼리를 `LATERAL` 집계 한 번으로 합친 적이 있다. 결과는 빨라졌는데, "왜 빨라졌는가"를 잘못 설명하면 다음 최적화에서 반드시 틀린 선택을 하게 된다. 그 리팩터링을 처음부터 다시 뜯어본다.

도메인은 일반화해서 쓴다 — 프로젝트(`project`) 목록을 조회하면서, 매핑 테이블(`project_member`)에서 역할별 참여 여부 네 개를 플래그로 뽑는 형태다.

```sql
FROM project p
LEFT JOIN LATERAL (
    SELECT
        MAX(CASE WHEN x.role_type = 'OWNER'    THEN 1 ELSE 0 END) AS has_owner,
        MAX(CASE WHEN x.role_type = 'MANAGER'  THEN 1 ELSE 0 END) AS has_manager,
        MAX(CASE WHEN x.role_type = 'REVIEWER' THEN 1 ELSE 0 END) AS has_reviewer,
        MAX(CASE WHEN x.role_type = 'VIEWER'   THEN 1 ELSE 0 END) AS has_viewer
    FROM project_member x
    JOIN member m ON m.member_id = x.member_id
    WHERE x.project_id = p.project_id
      AND x.del_yn = 'N'
      AND m.member_name IS NOT NULL
      AND m.member_name != ''
) c ON TRUE
WHERE p.del_yn = 'N'
  AND p.project_id IN (...)
```

## LATERAL은 성능 기능이 아니라 스코프 기능이다

정의는 한 줄이다.

> `FROM` 절의 서브쿼리가 **자기보다 앞에 나온 `FROM` 항목의 컬럼을 참조**할 수 있게 해준다.
{: .prompt-tip }

이 쿼리에서 그 참조는 바로 이 줄이다.

```sql
WHERE x.project_id = p.project_id
                     ^^ 바깥 FROM의 project
```

그래서 `LATERAL`을 빼면 "더 느려지는" 게 아니라 **아예 실행이 안 된다.**

```text
ERROR:  invalid reference to FROM-clause entry for table "p"
HINT:   There is an entry for table "p", but it cannot be
        referenced from this part of the query.
```

일반 서브쿼리는 독립적으로 먼저 평가되어야 하므로 바깥 행을 볼 수 없다. `LATERAL`은 그 벽을 허물어 **"바깥 행 하나마다 서브쿼리를 다시 평가한다"** 는 의미를 부여한다. 성능 이득은 그 의미에서 따라오는 결과일 뿐이다.

그리고 하나 더 — **`LATERAL`이 일반 조인보다 본질적으로 빠른 게 아니다.** 오히려 대부분은 일반 조인이 빠르다. 일반 조인은 플래너가 Hash Join, Merge Join, 조인 순서 교체까지 자유롭게 고를 수 있지만, `LATERAL`은 "바깥 행마다 한 번"이라는 순서가 고정된 Nested Loop에 묶인다.

그럼 이 케이스에서 이득은 어디서 왔나?

```text
role_type 별 EXISTS 4회  →  LATERAL 1회 집계로 통합
```

`EXISTS` 4개는 매핑 테이블을 **네 번** 탐색한다. `LATERAL`은 **한 번** 탐색해서 값 네 개를 동시에 뽑는다. 이득의 정체는 "LATERAL이 빨라서"가 아니라 **"같은 데이터를 네 번 읽던 걸 한 번으로 줄여서"** 다.

## ON TRUE가 붙는 이유

`LEFT JOIN`은 문법적으로 `ON` 절을 요구한다. 생략할 수 없다. 그런데 상관 조건은 이미 서브쿼리 안 `WHERE`에 들어가 있어 붙일 게 없으니, 항등식 `TRUE`를 넣는다. INNER 쪽은 생략형이 따로 있다.

```sql
CROSS JOIN LATERAL (...) c          -- ≡ JOIN LATERAL (...) c ON TRUE
LEFT  JOIN LATERAL (...) c ON TRUE  -- LEFT는 ON을 생략할 수 없음
```

## 계획에서의 모양 — 그리고 loops의 함정

`LATERAL`은 `Nested Loop Left Join`으로 나타난다.

```text
Nested Loop Left Join
  ->  (바깥) project 스캔              rows=20
  ->  Aggregate  (actual ... loops=20)   ← 바깥 행마다 1회씩
        ->  project_member 접근
```

위험은 둘이다. 첫째, **바깥 행 수 × 안쪽 비용**이 그대로 곱해진다. 안쪽이 1ms라도 바깥이 1,000행이면 1초다. `LATERAL`은 플래너에게 "이 순서로 돌아라"라고 지시하는 것이라, 안쪽이 비싸도 다른 조인 전략으로 도망갈 수 없다.

둘째가 실무에서 진짜 많이 틀리는 부분인데, **`loops > 1`인 노드의 `actual time`과 `rows`는 "1회 평균"이다.** 총합이 아니다.

```text
->  Aggregate (actual time=3.412..3.413 rows=6 loops=20)
                                        ↑ 6건이 아니라 6 × 20 = 120건
                                          3.4ms가 아니라 3.4 × 20 ≈ 68ms
```

`loops`를 안 곱하면 병목을 통째로 놓친다.

## 실제 계획 — 820만 건 읽고 120건 남기기

`IN (...)` 리스트에 PK 20개가 들어간 상태의 계획이다.

```text
Nested Loop Left Join  (actual time=0.412..68.921 rows=20 loops=1)
  ->  Index Scan using pk_project p  (actual time=0.038..0.104 rows=20 loops=1)
        Index Cond: (project_id = ANY ('{...20개...}'))
        Filter: (del_yn = 'N')
  ->  Aggregate  (actual time=3.421..3.422 rows=1 loops=20)
        ->  Nested Loop  (actual time=0.184..3.301 rows=6 loops=20)
              ->  Seq Scan on project_member x  (actual time=0.019..2.914 rows=8 loops=20)
                    Filter: ((project_id = p.project_id) AND (del_yn = 'N'))
                    Rows Removed by Filter: 412339
              ->  Index Scan using pk_member m  (actual time=0.028..0.029 rows=1 loops=160)
                    Index Cond: (member_id = x.member_id)
                    Filter: ((member_name IS NOT NULL) AND (member_name <> ''))
```

스캔 총량부터 계산한다.

```text
(8 + 412,339) × 20 loops = 8,246,940 건
```

여기서 한 걸음 더 나가면 결정적인 관찰이 나온다. **41만이라는 숫자가 매핑 테이블 전체 행 수와 같다.** 즉 이 계획은 "필터로 좀 많이 버렸다"가 아니라 **"테이블 전체를 20번 통째로 읽었다"** 이다. `Seq Scan` + `loops=20`을 보면 곧바로 이 문장이 나와야 한다.

살아남는 행은 이만큼이다.

```text
Seq Scan    rows=8 loops=20  →  160건이 필터 통과
Nested Loop rows=6 loops=20  →  120건이 member 조인까지 생존
```

시간으로 보면 더 선명하다.

```text
Seq Scan:  2.914ms × 20 loops ≈ 58ms
전체:                            68.9ms
                                 ↑ 84%가 이 한 노드
```

## 커버링 인덱스 — 출력 컬럼까지 넣는다

인덱스를 설계할 때 탐색 키만 보면 절반만 한 것이다. **서브쿼리가 그 테이블에서 읽어야 하는 컬럼 전부**를 역산한다.

```sql
WHERE x.project_id = ?      -- 탐색 키
  AND x.del_yn = 'N'         -- 필터
JOIN member ON m.member_id = x.member_id   -- 출력 필요
MAX(CASE WHEN x.role_type = ...)           -- 출력 필요
```

네 개가 전부다. 그럼 힙에 아예 안 가는 인덱스를 만들 수 있다.

```sql
CREATE INDEX idx_pm_project_cover
    ON project_member (project_id)
 INCLUDE (member_id, role_type)
 WHERE del_yn = 'N';
```

```text
->  Index Only Scan using idx_pm_project_cover on project_member x
      Index Cond: (project_id = p.project_id)
      Heap Fetches: 0
      (actual time=0.018..0.021 rows=8 loops=20)
```

| | before | after |
|---|---|---|
| 노드 | Seq Scan | Index Only Scan |
| Rows Removed by Filter | 412,339 | 없어짐 |
| 스캔 총량 | 8,246,940 | 160 |
| 노드 시간 | 2.914 × 20 ≈ 58ms | 0.021 × 20 ≈ 0.4ms |
| 전체 | 68.9ms | 약 2ms |

여기서 함정 하나. `Index Only Scan`이 잡혔다고 끝이 아니다. **`Heap Fetches:` 줄을 반드시 확인한다.**

```text
Index Only Scan ...
  Heap Fetches: 8291     ← "Index Only"인데 힙에 가고 있음
```

인덱스에는 튜플의 **가시성(visibility)** 정보가 없다. PostgreSQL은 Visibility Map으로 "이 페이지는 전부 보이는 튜플"임을 확인하고서야 힙을 건너뛰는데, VM은 VACUUM이 갱신한다. 즉 갱신이 잦고 VACUUM이 못 따라오는 테이블에서는 **이름만 Index Only이고 실제로는 힙에 다 간다.**

## 반복이 무서운 게 아니라 안쪽이 비싼 게 무섭다

같은 화면이 `IN` 리스트에 500개를 넣는다면? **인덱스를 만든 뒤라면 `LATERAL` 구조를 그대로 둬도 된다.**

```text
0.021ms × 500 loops ≈ 10ms
```

Nested Loop + Index Scan은 바깥 행 수에 선형이라 500 정도는 무섭지 않다. 참고로 `member` 조인이 500번 도는 것도 문제가 아니다 — 이미 PK Index Scan 1회 0.029ms짜리라 500번이면 15ms 남짓, 선형으로만 는다. 진짜 문제였던 건 `Seq Scan` 쪽이었다. 20번에 820만 건이면 500번엔 **2억 건**이다.

> "LATERAL은 반복되니까 나쁘다"가 아니라 **"안쪽이 O(1)이면 반복은 싸다"** 가 맞는 감각이다.
{: .prompt-info }

## 바깥이 더 커지면 — de-correlate 리라이팅

바깥이 수천~수만으로 커지면 그때는 상관관계 자체를 제거한다.

```sql
FROM project p
LEFT JOIN (
    SELECT x.project_id,
           MAX(CASE WHEN x.role_type = 'OWNER'    THEN 1 ELSE 0 END) AS has_owner,
           MAX(CASE WHEN x.role_type = 'MANAGER'  THEN 1 ELSE 0 END) AS has_manager,
           MAX(CASE WHEN x.role_type = 'REVIEWER' THEN 1 ELSE 0 END) AS has_reviewer,
           MAX(CASE WHEN x.role_type = 'VIEWER'   THEN 1 ELSE 0 END) AS has_viewer
      FROM project_member x
      JOIN member m ON m.member_id = x.member_id
     WHERE x.del_yn = 'N'
       AND x.project_id IN (...)          -- 리스트를 안쪽으로 밀어넣음
       AND m.member_name IS NOT NULL AND m.member_name <> ''
     GROUP BY x.project_id                -- 상관관계를 GROUP BY로 대체
) c ON c.project_id = p.project_id
```

계획 모양이 이렇게 바뀐다.

```text
Hash Left Join                    ← Nested Loop이 아님
  ->  Index Scan on project
  ->  Hash
        ->  HashAggregate         ← 500번이 아니라 1번
              ->  Index Scan on project_member (loops=1)
```

바깥 행 수와 무관하게 안쪽을 1회만 돈다. `LATERAL`이 `O(N × 안쪽비용)`이라면 이쪽은 `O(N + M)`이다. 참고로 **PostgreSQL은 집계가 들어있는 LATERAL을 스스로 de-correlate 해주지 않는다.** 사람이 직접 다시 써야 하는 리라이팅이다.

## LEFT의 성격이 바뀌는 지점

원래 `LATERAL`에서 `LEFT`는 사실 **의미상 중복**이었다. `GROUP BY` 없는 집계 쿼리는 입력이 0행이어도 **항상 정확히 1행**을 반환하기 때문이다.

```sql
SELECT MAX(...) FROM project_member WHERE <아무것도 매칭 안 됨>
→ 0행이 아니라, NULL 하나를 담은 1행을 반환
```

그래서 매칭 여부와 무관하게 늘 1행이 오고, `LEFT`든 `INNER`든 바깥 행이 사라질 일이 없다. 증거는 호출부에 있다 — `COALESCE(c.has_owner, 0) = 1`이 필요하다는 것 자체가 "행은 오는데 값이 NULL"인 경우를 이미 다루고 있다는 뜻이다.

그런데 위 리라이팅에서는 `GROUP BY`가 생겼다. 그 순간 매칭 없는 프로젝트는 서브쿼리 결과에 **아예 행이 없다.**

> 원래 형태에서 `LEFT`는 미래 변경에 대한 **보험**이었지만, de-correlate 형태에서는 **필수**다. `INNER`로 쓰면 참여 멤버가 없는 프로젝트가 목록에서 조용히 사라진다.
{: .prompt-warning }

같은 리팩터링 안에서 `LEFT`의 성격이 "중복"에서 "필수"로 뒤집힌다. 개념이 실전에서 물리는 지점이 여기다.

## 운영 함정

**함정 1 — `LATERAL`을 성능 기능으로 설명하기.** 없으면 에러가 나는 스코프 규칙이다. `EXISTS` N회를 1회로 합쳤을 때의 이득은 "LATERAL이 빨라서"가 아니라 "같은 테이블을 N번 읽던 걸 1번으로 줄여서"다.

**함정 2 — `loops`를 안 곱하기.** `loops > 1`인 노드의 시간·행 수는 1회 평균이다. 곱하지 않으면 84%를 차지하는 병목이 3ms짜리로 보인다.

**함정 3 — `Index Only Scan`을 이름만 믿기.** `Heap Fetches:`가 0이 아니면 힙에 가고 있다. VACUUM이 Visibility Map을 못 따라오는 테이블에서 흔하다.

**함정 4 — 탐색 키만 인덱스에 넣기.** 출력 컬럼까지 `INCLUDE`에 넣어야 힙 접근이 사라진다.

## 면접 한 줄 Q&A

- **Q. LATERAL이 일반 서브쿼리와 결정적으로 다른 점은?** A. `FROM` 절 서브쿼리가 앞선 `FROM` 항목의 컬럼을 참조할 수 있게 하는 **스코프 규칙**이다. 없으면 느려지는 게 아니라 `invalid reference to FROM-clause entry` 에러가 난다.
- **Q. LATERAL은 일반 조인보다 빠른가?** A. 아니다. 대부분은 일반 조인이 빠르다. LATERAL은 "바깥 행마다 한 번"이라는 순서가 고정된 Nested Loop에 묶여 플래너가 Hash/Merge Join을 못 고른다. 이득이 나는 건 같은 테이블 반복 탐색을 1회로 줄일 때다.
- **Q. `loops=20`인 노드의 `actual time=3.4ms`는?** A. 1회 평균이다. 총합은 `3.4 × 20 ≈ 68ms`. 행 수도 마찬가지로 곱해야 한다.
- **Q. `Index Only Scan`인데 왜 느린가?** A. `Heap Fetches:`를 본다. 인덱스에는 가시성 정보가 없어 Visibility Map으로 확인해야 힙을 건너뛰는데, VACUUM이 못 따라오면 이름만 Index Only이고 힙에 다 간다.
- **Q. 바깥 행이 수만 건이면 LATERAL을 어떻게 바꾸나?** A. 상관 조건을 `GROUP BY`로 대체하고 `IN` 리스트를 안쪽으로 밀어 넣어 de-correlate한다. `Nested Loop O(N × 안쪽비용)`이 `Hash Left Join + HashAggregate O(N + M)`이 된다. 이때부터 `LEFT`는 필수다.

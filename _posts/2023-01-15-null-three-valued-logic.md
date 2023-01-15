---
title: "SQL의 NULL은 거짓이 아니다"
date: 2023-01-15 10:30:00 +0900
categories: [Database]
tags: [null, three-valued-logic, is-null, not-in, coalesce]
description: "SQL의 NULL은 false가 아니라 UNKNOWN이다. 3값 논리가 만드는 NOT IN·집계·조인의 함정과 COALESCE 정규화를 정리한다."
---

NULL 값 처리를 정리하다 보면, 결국 막히는 곳은 항상 같다. `= NULL`이 왜 안 먹히는가, `NOT IN`이 왜 한 줄도 안 나오는가. 이건 문법 실수가 아니라 SQL이 **2값이 아니라 3값 논리**로 돌아간다는 사실을 모를 때 터지는 함정이다.

## NULL은 값이 아니라 "모름"이다

SQL에서 비교 연산의 결과는 `TRUE`, `FALSE` 둘이 아니라 `TRUE`, `FALSE`, `UNKNOWN` 셋이다. NULL은 "값이 없음"이 아니라 "**값을 모름(unknown)**"을 뜻한다. 모르는 값과 무언가를 비교하면 결과 역시 알 수 없으므로 `UNKNOWN`이 된다.

```sql
SELECT NULL = NULL;    -- UNKNOWN (참이 아님)
SELECT NULL = 1;       -- UNKNOWN
SELECT NULL <> 1;      -- UNKNOWN
```

그래서 `WHERE col = NULL`은 절대 참이 되지 않고, 한 행도 반환하지 않는다. NULL을 걸러내려면 전용 술어인 `IS NULL` / `IS NOT NULL`을 써야 한다. 이 둘만이 NULL을 대상으로 TRUE/FALSE를 명확히 돌려준다.

`WHERE` 절은 결과가 **정확히 TRUE인 행만** 통과시킨다. FALSE와 UNKNOWN은 똑같이 버려진다. 바로 이 "UNKNOWN도 버린다"가 모든 사고의 근원이다.

## NOT IN의 함정

가장 악명 높은 사례다. 서브쿼리 결과에 NULL이 단 하나라도 섞이면 `NOT IN`은 통째로 빈 결과를 낸다.

```sql
-- referrer_id 중 하나라도 NULL이면, 이 쿼리는 0건을 반환한다
SELECT * FROM users u
WHERE u.id NOT IN (SELECT referrer_id FROM users);
```

`x NOT IN (a, b, NULL)`은 `x<>a AND x<>b AND x<>NULL`로 전개된다. 마지막 `x<>NULL`이 항상 UNKNOWN이므로, AND 전체가 TRUE가 될 수 없다(`TRUE AND UNKNOWN = UNKNOWN`). 결국 어떤 행도 TRUE를 만들지 못한다.

`NOT EXISTS`는 이 문제가 없다. 행의 존재 여부만 보지 NULL을 값으로 비교하지 않기 때문이다.

```sql
SELECT * FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM users r WHERE r.referrer_id = u.id
);
```

## 집계와 NULL

집계 함수는 NULL을 **무시한다**. 단 `COUNT(*)`만 예외다.

```sql
SELECT
  COUNT(*)        AS total_rows,  -- NULL 포함 전체 행
  COUNT(score)    AS scored,      -- score가 NULL이 아닌 행
  AVG(score)      AS avg_score    -- NULL 제외 평균 (0으로 안 침)
FROM exam;
```

여기서 함정은 `AVG`다. 점수가 없는 응시자를 0점으로 치고 싶다면 평균 전에 정규화해야 한다. `AVG(score)`는 NULL 행을 분모에서 빼버리므로, 의도와 다른 "응시자 평균"이 나온다.

## COALESCE로 정규화

표시·계산 단계에서 NULL을 기본값으로 바꿔 3값 논리를 2값으로 좁힌다.

```sql
SELECT
  AVG(COALESCE(score, 0)) AS avg_with_zero,  -- 미응시=0점 평균
  COALESCE(nickname, name, '익명') AS display_name
FROM exam;
```

`COALESCE`는 표준 SQL이고 인자를 여러 개 받아 첫 비-NULL을 고른다. `IFNULL`(MySQL)·`NVL`(Oracle)은 2인자 전용 방언이다. 이식성을 생각하면 `COALESCE`가 정답이다.

## 운영 함정

- **인덱스와 NULL**: 일반 B-Tree 인덱스에서 `IS NULL` 검색의 동작은 DB마다 다르다. 옵티마이저가 인덱스를 못 탈 수 있으니 NULL이 많은 컬럼의 `IS NULL` 조회는 실행계획을 반드시 확인한다.
- **UNIQUE 제약과 NULL**: 표준상 NULL끼리는 서로 다른 것으로 취급되어, UNIQUE 컬럼에 NULL이 여러 행 들어간다. "값이 없으면 중복 허용"이 의도가 아니라면 `NOT NULL`을 걸거나 기본값을 둔다.

## 핵심 요약

- SQL은 3값 논리: 비교 결과는 TRUE/FALSE/**UNKNOWN**. WHERE는 TRUE만 통과시킨다.
- NULL 판별은 오직 `IS (NOT) NULL`. `= NULL`은 항상 UNKNOWN.
- `NOT IN` + NULL = 0건 함정 → `NOT EXISTS`로 대체.
- 집계는 NULL 무시(COUNT(*) 제외). 의도가 다르면 `COALESCE`로 먼저 정규화한다.

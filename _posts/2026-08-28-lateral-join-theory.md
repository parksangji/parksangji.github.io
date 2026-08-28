---
title: "LATERAL 조인: 성능 기능이 아니라 스코프 규칙이다"
date: 2026-08-28 16:50:00 +0900
series: "PostgreSQL"
categories: [Database]
tags: [postgresql, lateral, join, nested-loop, correlated-subquery, top-n, query-tuning]
description: "LATERAL이 FROM 절의 스코프를 여는 문법 규칙이라는 정의에서 출발해, 그것이 강제하는 Nested Loop 실행 모양과 비용 모델, 그룹별 상위 N건 같은 고유 용도, 그리고 de-correlate 리라이팅까지 정리한다."
---

`LATERAL`을 "조인을 빠르게 해주는 키워드"로 알고 있으면 처음부터 어긋난다. 정의에 성능은 없다. **문법 규칙**이고, 정확히는 **스코프 규칙**이다.

> `FROM` 절의 서브쿼리가 **자기보다 앞에 나온 `FROM` 항목의 컬럼을 참조**할 수 있게 해준다.
{: .prompt-tip }

이 한 줄에서 실행 모양, 비용 모델, 쓸 수 있는 자리와 없는 자리가 전부 따라 나온다.

## FROM 절에는 벽이 있다

일반적인 `FROM` 절의 서브쿼리는 **독립적으로 먼저 평가되어야 하는 단위**다. 바깥 행이 무엇인지 모르는 상태에서 자기 결과를 다 만들어 놓아야 한다. 그래서 바깥 컬럼을 참조할 수 없다.

<div class="lj-scope" markdown="0">
<style>
.lj-scope{margin:1.6rem 0;overflow-x:auto}
.lj-scope svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lj-scope .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.lj-scope .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.lj-scope .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.lj-scope .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;fill:currentColor;opacity:.9}
.lj-scope rect.box{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.38}
.lj-scope rect.ok{fill:#1864ab;fill-opacity:.13;stroke:#1864ab;stroke-width:1.5}
.lj-scope line.wall{stroke:currentColor;stroke-width:3;opacity:.55}
.lj-scope line.open{stroke:#1864ab;stroke-width:3;opacity:.85;stroke-dasharray:6 6}
:root[data-bs-theme='dark'] .lj-scope rect.ok{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}
:root[data-bs-theme='dark'] .lj-scope line.open{stroke:#4dabf7}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .lj-scope rect.ok{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}
:root:not([data-bs-theme]) .lj-scope line.open{stroke:#4dabf7}}
</style>
<svg viewBox="0 0 700 226" role="img" aria-label="일반 서브쿼리는 FROM 절의 경계 때문에 바깥 테이블 컬럼을 참조할 수 없어 오류가 나고 LATERAL은 그 경계를 열어 참조를 허용한다는 비교">
  <text class="cap" x="14" y="16">일반 서브쿼리 — 경계가 닫혀 있다</text>
  <rect class="box" x="12" y="26" width="150" height="46" rx="6"/>
  <text class="lbl" x="87" y="46" text-anchor="middle">project p</text>
  <text class="sub" x="87" y="62" text-anchor="middle">앞선 FROM 항목</text>
  <line class="wall" x1="192" y1="22" x2="192" y2="76"/>
  <rect class="box" x="222" y="26" width="230" height="46" rx="6"/>
  <text class="mono" x="337" y="46" text-anchor="middle">WHERE x.project_id = p.project_id</text>
  <text class="sub" x="337" y="62" text-anchor="middle">독립적으로 먼저 평가되어야 함</text>
  <text class="mono" x="470" y="44">ERROR: invalid reference to</text>
  <text class="mono" x="470" y="60">FROM-clause entry for table "p"</text>

  <text class="cap" x="14" y="126">LATERAL — 경계가 열린다</text>
  <rect class="box" x="12" y="136" width="150" height="46" rx="6"/>
  <text class="lbl" x="87" y="156" text-anchor="middle">project p</text>
  <text class="sub" x="87" y="172" text-anchor="middle">앞선 FROM 항목</text>
  <line class="open" x1="192" y1="132" x2="192" y2="186"/>
  <rect class="ok" x="222" y="136" width="230" height="46" rx="6"/>
  <text class="mono" x="337" y="156" text-anchor="middle">WHERE x.project_id = p.project_id</text>
  <text class="sub" x="337" y="172" text-anchor="middle">바깥 행 하나마다 다시 평가</text>
  <text class="sub" x="470" y="154">참조가 허용된다</text>
  <text class="sub" x="470" y="170">= 실행 순서가 고정된다는 뜻이기도 하다</text>

  <text class="sub" x="14" y="214">LATERAL을 빼면 "느려지는" 게 아니라 파싱 단계에서 실패한다. 성능 선택지가 아니라 문법 요건이다.</text>
</svg>
</div>

## 의미가 곧 실행 순서다

"바깥 행 하나마다 서브쿼리를 다시 평가한다"는 의미를 부여받는 순간, 실행 모양이 **하나로 고정된다.** 다른 방법으로는 그 의미를 만들 수 없기 때문이다.

<div class="lj-shape" markdown="0">
<style>
.lj-shape{margin:1.6rem 0;overflow-x:auto}
.lj-shape svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lj-shape .lbl{fill:currentColor;font-size:11px;font-weight:600}
.lj-shape .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.lj-shape .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.lj-shape .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;fill:currentColor}
.lj-shape rect.row{fill:#1864ab;fill-opacity:.55}
.lj-shape rect.inner{fill:none;stroke:#1864ab;stroke-width:1.5;fill-opacity:0}
.lj-shape .arr{stroke:currentColor;opacity:.3;stroke-width:1.3;fill:none}
:root[data-bs-theme='dark'] .lj-shape rect.row{fill:#4dabf7;fill-opacity:.6}
:root[data-bs-theme='dark'] .lj-shape rect.inner{stroke:#4dabf7}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .lj-shape rect.row{fill:#4dabf7;fill-opacity:.6}
:root:not([data-bs-theme]) .lj-shape rect.inner{stroke:#4dabf7}}
</style>
<svg viewBox="0 0 700 208" role="img" aria-label="바깥 행 하나마다 안쪽 서브쿼리가 한 번씩 실행되어 실행계획에 Nested Loop과 loops 값으로 나타나는 구조">
  <text class="cap" x="14" y="16">바깥 입력 — N행</text>
  <rect class="row" x="14" y="26" width="18" height="18" rx="3"/>
  <rect class="row" x="36" y="26" width="18" height="18" rx="3"/>
  <rect class="row" x="58" y="26" width="18" height="18" rx="3"/>
  <rect class="row" x="80" y="26" width="18" height="18" rx="3"/>
  <rect class="row" x="102" y="26" width="18" height="18" rx="3"/>
  <text class="sub" x="130" y="40">… N행</text>

  <line class="arr" x1="23" y1="46" x2="23" y2="66"/>
  <line class="arr" x1="45" y1="46" x2="45" y2="66"/>
  <line class="arr" x1="67" y1="46" x2="67" y2="66"/>
  <line class="arr" x1="89" y1="46" x2="89" y2="66"/>
  <line class="arr" x1="111" y1="46" x2="111" y2="66"/>

  <rect class="inner" x="14" y="70" width="18" height="26" rx="3"/>
  <rect class="inner" x="36" y="70" width="18" height="26" rx="3"/>
  <rect class="inner" x="58" y="70" width="18" height="26" rx="3"/>
  <rect class="inner" x="80" y="70" width="18" height="26" rx="3"/>
  <rect class="inner" x="102" y="70" width="18" height="26" rx="3"/>
  <text class="sub" x="130" y="88">안쪽 서브쿼리가 행마다 한 번씩 — 총 N회</text>

  <text class="mono" x="14" y="132">Nested Loop Left Join</text>
  <text class="mono" x="14" y="150">  -&gt;  Index Scan on project              (rows=N loops=1)</text>
  <text class="mono" x="14" y="168">  -&gt;  Aggregate                           (loops=N)   ← 바깥 행 수와 같다</text>
  <text class="sub" x="14" y="198">loops 값이 곧 바깥 행 수다. 그리고 그 노드의 actual time·rows는 1회 평균이라 곱해야 총합이 된다.</text>
</svg>
</div>

`LEFT JOIN LATERAL`에 `ON TRUE`가 붙는 이유도 여기서 나온다. 상관 조건은 이미 서브쿼리 안 `WHERE`에 들어가 있어 `ON`에 쓸 게 없는데, `LEFT JOIN`은 문법적으로 `ON`을 요구한다. 그래서 항등식을 넣는다.

```sql
CROSS JOIN LATERAL (...) c          -- ≡ JOIN LATERAL (...) c ON TRUE
LEFT  JOIN LATERAL (...) c ON TRUE  -- LEFT는 ON을 생략할 수 없음
```

## LATERAL이 아니면 안 되는 일 — 그룹별 상위 N건

LATERAL의 존재 이유를 가장 잘 보여주는 건 성능 최적화가 아니라 **표현할 수 없던 걸 표현하게 되는 경우**다. 대표가 "각 그룹마다 상위 N건"이다.

```sql
SELECT p.project_id, p.name, r.title, r.created_at
FROM project p
LEFT JOIN LATERAL (
    SELECT title, created_at
    FROM report
    WHERE report.project_id = p.project_id    -- 바깥 행 참조
    ORDER BY created_at DESC
    LIMIT 3                                    -- 그룹마다 3건
) r ON TRUE;
```

`LIMIT`은 서브쿼리 단위로 걸린다. 즉 **바깥 행마다 따로 3건**을 가져온다. 윈도우 함수(`ROW_NUMBER() OVER (PARTITION BY ...)`)로도 같은 결과를 낼 수 있지만 동작이 다르다.

| | LATERAL + LIMIT | 윈도우 함수 + 필터 |
|---|---|---|
| 읽는 양 | 그룹마다 상위 N건에서 멈춘다 | **전체를 읽어** 번호를 매긴 뒤 버린다 |
| 인덱스 활용 | `(group_key, sort_key)` 인덱스로 N건만 | 정렬 전체가 필요 |
| 그룹이 적고 그룹당 행이 많을 때 | 유리 | 불리 |
| 그룹이 아주 많을 때 | loops가 커진다 | 한 번의 스캔으로 끝 |

집합 반환 함수에 바깥 컬럼을 넘기는 것도 LATERAL 없이는 안 된다.

```sql
SELECT p.project_id, t.tag
FROM project p,
     LATERAL unnest(p.tag_array) AS t(tag);   -- p의 컬럼을 함수 인자로
```

## 비용은 반복 횟수가 아니라 안쪽 복잡도가 정한다

가장 흔한 오해가 "LATERAL은 반복되니까 느리다"는 것이다. 비용 모델은 `O(N × 안쪽 비용)`이므로, **안쪽이 상수 시간이면 N이 커도 싸다.** 무서운 건 반복이 아니라 안쪽이 비싼 경우다.

<div class="lj-cost" markdown="0">
<style>
.lj-cost{margin:1.6rem 0;overflow-x:auto}
.lj-cost svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lj-cost .lbl{fill:currentColor;font-size:11px;font-weight:600}
.lj-cost .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.lj-cost .val{fill:currentColor;font-size:11px;font-weight:700}
.lj-cost .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.lj-cost .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9.5px;fill:currentColor;opacity:.85}
.lj-cost rect.cheap{fill:#4dabf7}
.lj-cost rect.dear{fill:#0b3d66}
.lj-cost .base{stroke:currentColor;opacity:.26;stroke-width:1}
.lj-cost .rule{stroke:currentColor;opacity:.14;stroke-width:1}
:root[data-bs-theme='dark'] .lj-cost rect.cheap{fill:#a5d8ff}
:root[data-bs-theme='dark'] .lj-cost rect.dear{fill:#1864ab}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .lj-cost rect.cheap{fill:#a5d8ff}
:root:not([data-bs-theme]) .lj-cost rect.dear{fill:#1864ab}}
</style>
<svg viewBox="0 0 700 214" role="img" aria-label="같은 500회 반복이라도 안쪽이 인덱스 스캔이면 10밀리초 안쪽이 순차 스캔이면 1450밀리초로 자릿수가 갈린다는 로그 눈금 비교">
  <text class="cap" x="14" y="16">같은 loops = 500 — 안쪽 노드만 다를 때  ·  가로축 로그 눈금</text>

  <text class="lbl" x="14" y="52">안쪽 = Index Scan</text>
  <text class="sub" x="14" y="68">1회 0.02 ms</text>
  <rect class="cheap" x="200" y="42" width="65" height="14" rx="4"/>
  <text class="val" x="273" y="53">10 ms</text>
  <text class="mono" x="340" y="53">0.02 × 500 — 안쪽이 O(1)이면 반복은 싸다</text>

  <text class="lbl" x="14" y="106">안쪽 = Seq Scan</text>
  <text class="sub" x="14" y="122">1회 2.9 ms</text>
  <rect class="dear" x="200" y="96" width="345" height="14" rx="4"/>
  <text class="val" x="553" y="107">1,450 ms</text>
  <text class="mono" x="340" y="128">2.9 × 500 — 안쪽이 O(M)이면 N × M이 된다</text>

  <line class="base" x1="200" y1="150" x2="590" y2="150"/>
  <text class="sub" x="200" y="164" text-anchor="middle">10 ms</text>
  <text class="sub" x="330" y="164" text-anchor="middle">100 ms</text>
  <text class="sub" x="460" y="164" text-anchor="middle">1 s</text>
  <text class="sub" x="590" y="164" text-anchor="middle">10 s</text>

  <text class="lbl" x="14" y="192">반복 횟수는 같은데 145배 차이가 난다. 진단할 곳은 loops가 아니라 안쪽 노드다.</text>
</svg>
</div>

그래서 LATERAL이 느릴 때의 처방은 **"LATERAL을 없애기"가 아니라 "안쪽을 인덱스로 O(1)에 가깝게 만들기"** 가 먼저다. 안쪽이 `Seq Scan`이면 그 인덱스를 만들고, 필요하면 출력 컬럼까지 `INCLUDE`에 넣어 힙 접근을 없앤다.

## 대신 플래너의 자유를 잃는다

`LATERAL`이 일반 조인보다 **본질적으로 빠른 건 아니다.** 오히려 대부분은 일반 조인이 빠르다. 이유는 선택지의 수다.

| | 일반 조인 | LATERAL |
|---|---|---|
| 조인 알고리즘 | Nested Loop / Hash / Merge 중 선택 | **Nested Loop 고정** |
| 조인 순서 | 플래너가 재배치 가능 | 바깥 → 안쪽으로 고정 |
| 안쪽이 비쌀 때 | 다른 전략으로 회피 가능 | 회피 불가, 그대로 곱해짐 |

조인 알고리즘 세 가지의 비용 모델과 선택 기준은 [조인은 어떻게 실행되는가](/posts/join-strategies/)에서 따로 다뤘다.

그럼 언제 이기는가. **같은 데이터를 여러 번 훑던 것을 한 번으로 줄일 때**다.

```sql
-- 전: 구분 코드별 EXISTS 4개 → 매핑 테이블을 4번 탐색
SELECT p.*,
       EXISTS (SELECT 1 FROM project_member WHERE project_id = p.project_id AND role_type='OWNER')    AS has_owner,
       EXISTS (SELECT 1 FROM project_member WHERE project_id = p.project_id AND role_type='MANAGER')  AS has_manager,
       EXISTS (SELECT 1 FROM project_member WHERE project_id = p.project_id AND role_type='REVIEWER') AS has_reviewer,
       EXISTS (SELECT 1 FROM project_member WHERE project_id = p.project_id AND role_type='VIEWER')   AS has_viewer
FROM project p;

-- 후: LATERAL 집계 1개 → 한 번 탐색해 값 4개를 동시에
SELECT p.*, c.*
FROM project p
LEFT JOIN LATERAL (
    SELECT MAX(CASE WHEN role_type='OWNER'    THEN 1 ELSE 0 END) AS has_owner,
           MAX(CASE WHEN role_type='MANAGER'  THEN 1 ELSE 0 END) AS has_manager,
           MAX(CASE WHEN role_type='REVIEWER' THEN 1 ELSE 0 END) AS has_reviewer,
           MAX(CASE WHEN role_type='VIEWER'   THEN 1 ELSE 0 END) AS has_viewer
    FROM project_member
    WHERE project_id = p.project_id
) c ON TRUE;
```

이득의 정체는 "LATERAL이 빨라서"가 아니라 **"같은 테이블을 네 번 읽던 걸 한 번으로 줄여서"** 다. 이 구분을 못 하면 다음 최적화에서 틀린 선택을 한다.

## 바깥이 커지면 — de-correlate 리라이팅

바깥 행이 수천~수만으로 커지면 `N × 안쪽`의 N 자체가 문제가 된다. 이때는 **상관관계 자체를 제거**한다. `WHERE`의 상관 조건을 `GROUP BY`로 바꾸고, 필터를 안쪽으로 밀어 넣는다.

<div class="lj-deco" markdown="0">
<style>
.lj-deco{margin:1.6rem 0;overflow-x:auto}
.lj-deco svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lj-deco .lbl{fill:currentColor;font-size:11px;font-weight:600}
.lj-deco .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.lj-deco .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.lj-deco .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9.5px;fill:currentColor;opacity:.9}
.lj-deco .big{font-size:12.5px;font-weight:700;fill:currentColor}
.lj-deco rect.rep{fill:#1864ab;fill-opacity:.45}
.lj-deco rect.once{fill:#1864ab;fill-opacity:.85}
.lj-deco .rule{stroke:currentColor;opacity:.14;stroke-width:1}
:root[data-bs-theme='dark'] .lj-deco rect.rep{fill:#4dabf7;fill-opacity:.5}
:root[data-bs-theme='dark'] .lj-deco rect.once{fill:#a5d8ff;fill-opacity:.9}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .lj-deco rect.rep{fill:#4dabf7;fill-opacity:.5}
:root:not([data-bs-theme]) .lj-deco rect.once{fill:#a5d8ff;fill-opacity:.9}}
</style>
<svg viewBox="0 0 700 234" role="img" aria-label="LATERAL은 바깥 행마다 안쪽을 반복해 O 엔 곱하기 엠이지만 GROUP BY로 상관관계를 제거하면 안쪽을 한 번만 돌아 O 엔 더하기 엠이 된다는 비교">
  <text class="cap" x="14" y="16">LATERAL — 바깥 행마다 안쪽을 다시</text>
  <rect class="rep" x="14" y="26" width="30" height="18" rx="3"/>
  <rect class="rep" x="48" y="26" width="30" height="18" rx="3"/>
  <rect class="rep" x="82" y="26" width="30" height="18" rx="3"/>
  <rect class="rep" x="116" y="26" width="30" height="18" rx="3"/>
  <rect class="rep" x="150" y="26" width="30" height="18" rx="3"/>
  <rect class="rep" x="184" y="26" width="30" height="18" rx="3"/>
  <rect class="rep" x="218" y="26" width="30" height="18" rx="3"/>
  <text class="sub" x="258" y="39">… 바깥 행 수만큼 반복</text>
  <text class="mono" x="14" y="66">Nested Loop Left Join</text>
  <text class="mono" x="14" y="82">  -&gt;  Index Scan on project</text>
  <text class="mono" x="14" y="98">  -&gt;  Aggregate  (loops = N)</text>
  <text class="big" x="470" y="82">O(N × 안쪽비용)</text>

  <line class="rule" x1="14" y1="118" x2="686" y2="118"/>

  <text class="cap" x="14" y="144">de-correlate — GROUP BY로 상관 제거, 안쪽을 한 번만</text>
  <rect class="once" x="14" y="154" width="30" height="18" rx="3"/>
  <text class="sub" x="56" y="167">단 1회 — 그룹 키로 한꺼번에 집계</text>
  <text class="mono" x="14" y="194">Hash Left Join</text>
  <text class="mono" x="14" y="210">  -&gt;  Index Scan on project</text>
  <text class="mono" x="14" y="226">  -&gt;  Hash  -&gt;  HashAggregate  (loops = 1)</text>
  <text class="big" x="470" y="210">O(N + M)</text>
</svg>
</div>

```sql
FROM project p
LEFT JOIN (
    SELECT project_id,
           MAX(CASE WHEN role_type='OWNER' THEN 1 ELSE 0 END) AS has_owner
           -- …
      FROM project_member
     WHERE project_id IN (...)      -- 필터를 안쪽으로 밀어넣는다
     GROUP BY project_id            -- 상관관계를 GROUP BY로 대체
) c ON c.project_id = p.project_id
```

이건 **사람이 직접 해야 하는 리라이팅**이다. PostgreSQL은 단순한 상관 서브쿼리는 자동으로 풀어내지만, **집계가 들어 있는 LATERAL은 스스로 de-correlate 하지 않는다.**

## LEFT의 성격이 뒤집히는 지점

마지막이 가장 미묘하다. 원래 LATERAL 집계에서 `LEFT`는 사실 **의미상 중복**이었다.

```sql
SELECT MAX(...) FROM project_member WHERE <아무것도 매칭 안 됨>
→ 0행이 아니라, NULL 하나를 담은 1행을 반환
```

`GROUP BY` 없는 집계 쿼리는 **입력이 0행이어도 항상 정확히 1행**을 반환한다. 그래서 매칭 여부와 무관하게 늘 1행이 오고, `LEFT`든 `INNER`든 바깥 행이 사라질 일이 없다. 호출부에 `COALESCE(c.has_owner, 0)`가 필요하다는 것 자체가 "행은 오는데 값이 NULL"인 경우를 이미 다루고 있다는 증거다.

그런데 위 리라이팅에서는 `GROUP BY`가 생겼다. **그 순간 매칭 없는 그룹은 서브쿼리 결과에 아예 행이 없다.**

| | 원래 LATERAL 집계 | de-correlate 후 (GROUP BY) |
|---|---|---|
| 매칭 0건일 때 | NULL 한 행이 온다 | **행 자체가 없다** |
| `INNER`로 바꾸면 | 결과 동일 | **바깥 행이 조용히 사라진다** |
| `LEFT`의 성격 | 미래 변경 대비 보험 | **필수** |

> 같은 리팩터링 안에서 `LEFT`의 성격이 "중복"에서 "필수"로 뒤집힌다. 목록에서 항목이 조용히 빠지는 버그는 재현도 어렵고 발견도 늦다.
{: .prompt-warning }

## 운영 함정

**함정 1 — LATERAL을 성능 기능으로 설명하기.** 없으면 에러가 나는 스코프 규칙이다. 성능 이득은 "같은 테이블을 N번 읽던 걸 1번으로 줄였을 때" 따라오는 결과지, 키워드 자체의 속성이 아니다.

**함정 2 — `loops`가 크다고 LATERAL을 걷어내기.** 비용은 `loops`가 아니라 안쪽 노드의 복잡도가 정한다. 안쪽을 인덱스로 O(1)에 가깝게 만드는 게 먼저다.

**함정 3 — `loops`를 안 곱해서 병목을 놓치기.** `loops > 1`인 노드의 `actual time`·`rows`는 1회 평균이다. 곱하지 않으면 전체의 80%를 먹는 노드가 3ms짜리로 보인다. [실행계획 읽는 법](/posts/postgresql-explain-plan-anatomy/)에서 다룬 함정이 여기서 그대로 나온다.

**함정 4 — de-correlate하면서 `LEFT`를 빼기.** `GROUP BY`가 생긴 순간 `LEFT`는 선택이 아니라 필수가 된다.

**함정 5 — 그룹이 아주 많은데 LATERAL + LIMIT을 쓰기.** 그룹별 상위 N건은 그룹이 적고 그룹당 행이 많을 때 유리하다. 그룹이 수만 개면 윈도우 함수 한 번의 스캔이 낫다.

## 면접 한 줄 Q&A

- **Q. LATERAL이 일반 서브쿼리와 결정적으로 다른 점은?** A. `FROM` 절 서브쿼리가 앞선 `FROM` 항목의 컬럼을 참조할 수 있게 하는 **스코프 규칙**이다. 없으면 느려지는 게 아니라 `invalid reference to FROM-clause entry` 에러가 난다.
- **Q. LATERAL은 일반 조인보다 빠른가?** A. 아니다. "바깥 행마다 한 번"이라는 의미가 실행 순서를 고정해서 **Nested Loop에 묶이고** 플래너가 Hash/Merge Join이나 조인 순서 재배치를 못 고른다. 이득이 나는 건 같은 테이블 반복 탐색을 1회로 줄일 때다.
- **Q. LATERAL이 아니면 못 하는 일은?** A. 그룹별 상위 N건(`LIMIT`이 서브쿼리 단위로 걸린다), 그리고 집합 반환 함수에 바깥 컬럼을 인자로 넘기는 것이다.
- **Q. LATERAL이 느릴 때 어디를 보나?** A. `loops`가 아니라 **안쪽 노드**다. 비용은 `O(N × 안쪽 비용)`이라 안쪽이 인덱스 스캔이면 500회 반복도 10ms지만, `Seq Scan`이면 같은 500회가 1.4초가 된다.
- **Q. 바깥 행이 수만 건이면?** A. 상관 조건을 `GROUP BY`로 대체하고 필터를 안쪽으로 밀어 넣어 de-correlate한다. `O(N × 안쪽)`이 `O(N + M)`이 된다. 집계가 든 LATERAL은 플래너가 자동으로 풀어주지 않아서 사람이 다시 써야 한다.
- **Q. de-correlate 후에 주의할 점은?** A. `GROUP BY`가 생기면서 매칭 없는 그룹의 행이 사라진다. 원래는 중복이던 `LEFT`가 이때부터 필수가 된다.

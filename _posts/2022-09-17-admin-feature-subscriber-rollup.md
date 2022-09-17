---
title: "어드민 대시보드 숫자는 어디서 계산되나 — 기능별 집계 카운트"
date: 2022-09-17 10:30:00 +0900
categories: [Database]
tags: [aggregation, group-by, count, admin-dashboard, rollup, mybatis]
mermaid: true
description: "운영 대시보드의 카테고리별 카운트는 화면에서 N번 세지 말고 GROUP BY 한 번으로 묶어라. 롤업 집계와 0건 차원 누락 보정까지 다룬다."
---

운영 어드민에 "기능별 구독자 수" 같은 보드를 올리는 일은 흔하다. 카테고리가 12개라고 화면 코드에서 12번 쿼리를 날리면, 12번의 왕복과 12번의 풀스캔이 생긴다. 핵심은 단순하다. **세는 일은 DB가 GROUP BY 한 번으로 끝내고, 화면은 결과 행만 받는다.**

## 롤업 집계의 원리

집계 카운트는 차원(dimension)별로 행을 묶고, 각 묶음의 크기를 세는 연산이다. DB는 정렬 또는 해시로 같은 키끼리 그룹을 만든 뒤 그룹마다 집계 함수를 적용한다.

```sql
SELECT f.category_id, COUNT(s.user_id) AS subscriber_cnt
FROM feature f
JOIN subscription s ON s.feature_id = f.id
GROUP BY f.category_id;
```

여기에 "전체 합계" 행까지 한 결과에 넣고 싶을 때 쓰는 게 `WITH ROLLUP`이다. ROLLUP은 그룹 키의 상위 소계를 자동으로 만들어 NULL 키 행으로 덧붙인다.

```sql
SELECT f.category_id, COUNT(s.user_id) AS cnt
FROM feature f
JOIN subscription s ON s.feature_id = f.id
GROUP BY f.category_id WITH ROLLUP;
-- category_id = NULL 인 마지막 행이 전체 합계
```

조건부 카운트(`SUM(CASE WHEN ...)`)가 "한 행에 여러 열"을 만드는 피벗이라면, ROLLUP은 "차원별 행 + 소계 행"을 만드는 행 단위 집계다. 보드가 카테고리 목록 형태면 후자가 자연스럽다.

## 0건 카테고리가 사라지는 함정

위 쿼리의 진짜 함정은 ROLLUP이 아니라 **JOIN**이다. `INNER JOIN`으로 묶으면 구독자가 0명인 카테고리는 결합되는 행이 없어 결과에서 통째로 빠진다. 대시보드에 "12개 카테고리"가 떠야 하는데 9개만 뜨는 사고가 여기서 난다.

```mermaid
flowchart LR
  A[feature 카테고리 전체] -->|INNER JOIN| B[구독 있는 것만 남음]
  A -->|LEFT JOIN| C[전부 유지 · 0건은 NULL → 0]
```

해법은 차원 테이블을 기준으로 `LEFT JOIN`하고 `COUNT`로 NULL을 0으로 떨어뜨리는 것이다.

```sql
SELECT f.category_id, COUNT(s.user_id) AS cnt
FROM feature f
LEFT JOIN subscription s ON s.feature_id = f.id
GROUP BY f.category_id;
```

`COUNT(s.user_id)`는 NULL을 세지 않으므로 0건 카테고리는 자연히 0이 된다. 반면 `COUNT(*)`를 쓰면 LEFT JOIN으로 생긴 NULL 행 1개를 세어 1이 나온다 — 이건 흔한 실수다. **차원은 LEFT JOIN의 좌측에, 카운트는 우측 컬럼으로** 외우면 안전하다.

## 핵심 요약

- 보드 카운트는 화면에서 N번 세지 말고 GROUP BY 한 번으로 묶는다.
- 전체 소계가 필요하면 `WITH ROLLUP`, 0건 차원 보존은 차원 테이블 기준 `LEFT JOIN`.
- `COUNT(컬럼)`은 NULL 미포함, `COUNT(*)`는 행 자체를 세므로 LEFT JOIN과 함께 쓰면 0건이 1로 부풀려진다.

> **면접 한 줄**: "LEFT JOIN 후 GROUP BY에서 0건 그룹을 0으로 보이게 하려면?" → 우측 테이블의 NOT NULL 컬럼을 `COUNT()`하면 된다. `COUNT(*)`는 안 된다.

---
title: "집계 쿼리는 왜 느리고 어떻게 빨라지나"
date: 2023-02-19 10:30:00 +0900
categories: [Database]
tags: [group-by, aggregation, index, temp-table, sort]
description: "GROUP BY가 느린 건 정렬·해시·임시테이블 때문이다. 집계의 내부 동작, 인덱스로 정렬을 생략하는 법, 사전집계 테이블 전략을 정리한다."
---

집계·통계 조회를 다루다 보면 평범한 `GROUP BY` 하나가 수 초씩 걸리는 순간을 만난다. 행은 다 인덱스로 잘 찾는데 왜 느릴까. 집계의 비용은 데이터를 찾는 데 있는 게 아니라, 찾은 데이터를 **그룹으로 묶는 과정**에 있다.

## GROUP BY는 내부에서 무엇을 하나

`GROUP BY`로 행을 그룹화하는 방법은 크게 둘이다.

1. **정렬 후 집계(sort + group)**: 그룹 키로 전체를 정렬한 뒤, 같은 키가 연속으로 모인 구간을 훑으며 집계한다. 정렬 비용 `O(n log n)`이 붙고, 메모리를 넘으면 디스크 임시 파일로 쏟아진다.
2. **해시 집계(hash aggregate)**: 그룹 키로 해시 테이블을 만들어 한 번 스캔하며 누적한다. 정렬이 없어 빠르지만, 해시 테이블이 메모리를 넘으면 역시 디스크로 흘러넘친다.

어느 쪽이든 **중간 결과를 담을 임시 공간**이 필요하고, 그게 메모리를 초과해 디스크 임시 테이블로 떨어지는 순간 쿼리가 급격히 느려진다. `EXPLAIN`에서 `Using temporary; Using filesort`가 보이면 바로 이 신호다.

```sql
-- 카테고리별 매출 합계 — 정렬/해시 + 임시테이블이 붙기 쉽다
SELECT category_id, SUM(amount) AS total
FROM orders
WHERE created_at >= '2023-01-01'
GROUP BY category_id;
```

## 인덱스로 정렬을 생략한다

핵심 통찰: **그룹 키가 인덱스 순서와 일치하면, DB는 정렬 단계를 건너뛴다.** 인덱스는 이미 키 순으로 정렬돼 있으므로, 인덱스를 순서대로 읽기만 해도 같은 키가 연속으로 등장한다. 정렬도, 임시테이블도 필요 없다.

```sql
-- (category_id) 또는 (category_id, amount) 인덱스가 있으면
-- 정렬 없이 인덱스 순회만으로 그룹 집계 가능
CREATE INDEX idx_orders_cat ON orders (category_id);
```

`WHERE`와 `GROUP BY`가 함께 있으면 복합 인덱스의 **열 순서**가 중요하다. 등치 필터 컬럼을 앞에, 그룹 키를 뒤에 두면 필터로 좁힌 뒤 그룹 키 순서를 그대로 활용한다.

```sql
-- WHERE status=? 로 좁히고 category_id 로 그룹
CREATE INDEX idx_orders_status_cat ON orders (status, category_id);
```

여기에 집계 대상 컬럼(`amount`)까지 인덱스에 포함하면 **커버링 인덱스**가 되어 테이블 본체 접근(random I/O) 없이 인덱스만으로 답을 낸다.

## 사전집계 — 매번 계산하지 않는다

읽기가 압도적으로 많고 실시간성이 덜 중요한 통계라면, 매 요청마다 원본을 훑는 대신 **미리 집계한 테이블**을 둔다.

```sql
CREATE TABLE daily_category_sales (
  stat_date   DATE,
  category_id BIGINT,
  total       DECIMAL(15,2),
  PRIMARY KEY (stat_date, category_id)
);

-- 배치로 하루 한 번 채운다
INSERT INTO daily_category_sales (stat_date, category_id, total)
SELECT DATE(created_at), category_id, SUM(amount)
FROM orders
WHERE created_at >= CURRENT_DATE - INTERVAL 1 DAY
GROUP BY DATE(created_at), category_id;
```

조회는 `daily_category_sales`에서 단순 합산만 하면 되어, 수백만 행 집계가 수십 행 조회로 바뀐다. 정확도(약간의 지연)와 속도를 맞바꾸는 전형적 트레이드오프다.

## 운영 함정

- **인덱스가 있어도 함수 적용 시 못 탄다**: `GROUP BY DATE(created_at)`처럼 컬럼에 함수를 씌우면 인덱스 정렬을 활용하지 못한다. 날짜 단위 집계가 잦으면 생성 컬럼/별도 날짜 컬럼에 인덱스를 둔다.
- **메모리 한도와 임시테이블 폭발**: 그룹 수가 폭발적으로 많으면 해시·정렬 버퍼가 디스크로 넘쳐 느려진다. `WHERE`로 먼저 범위를 좁혀 집계 대상 행 자체를 줄이는 게 1순위다.

## 핵심 요약

- GROUP BY의 비용은 탐색이 아니라 정렬/해시 + 임시테이블에 있다.
- 그룹 키가 인덱스 순서와 맞으면 정렬을 생략한다. 복합 인덱스는 (필터, 그룹키[, 집계대상]) 순서로.
- 실시간성이 덜한 통계는 배치 사전집계 테이블로 수백만 행을 수십 행 조회로 바꾼다.

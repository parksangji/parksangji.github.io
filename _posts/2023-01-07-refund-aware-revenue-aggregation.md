---
title: "총매출에서 환불을 빼는 집계 — 코드값을 명칭으로 바꾸기"
date: 2023-01-07 10:30:00 +0900
categories: [Database]
tags: [revenue, aggregation, refund, code-mapping, report, case-when]
description: "매출 리포트는 결제액 합이 아니라 '결제 − 환불'의 순액이어야 한다. 환불을 반영한 순매출 집계와 코드값을 사람이 읽는 명칭으로 변환하는 리포트 쿼리를 정리한다."
---

운영 매출 리포트를 짜다 보면 처음엔 모두 같은 실수를 한다. 결제 테이블의 금액을 `SUM` 하면 그게 매출이라고 믿는 것이다. 하지만 그 합은 **거래액(gross)**이지 **순매출(net)**이 아니다. 환불·취소가 한 건이라도 있으면 리포트와 정산이 어긋난다. 이 글은 환불을 반영한 순매출 집계와, DB에 코드값으로 저장된 상태를 사람이 읽는 명칭으로 바꾸는 리포트 변환을 다룬다.

## 핵심: 환불을 어떻게 모델링했느냐가 집계를 정한다

환불을 데이터로 표현하는 방식은 보통 두 가지다.

1. **별도 환불 행을 음수 금액으로 적재** — 결제는 `+10000`, 환불은 `-3000`. 이러면 `SUM(amount)`만으로 순매출이 나온다. 회계 장부의 차변/대변과 같은 발상이다.
2. **거래 타입 컬럼으로 구분** — 같은 양수 금액에 `type`이 `PAYMENT`/`REFUND`로 나뉜다. 이때는 단순 합이 거래액이 되어버리므로, 타입에 따라 부호를 갈라야 한다.

2번 모델에서 순매출은 조건부 집계로 푼다.

```sql
SELECT
  SUM(CASE WHEN tx_type = 'PAYMENT' THEN amount ELSE 0 END) AS gross,
  SUM(CASE WHEN tx_type = 'REFUND'  THEN amount ELSE 0 END) AS refund,
  SUM(CASE WHEN tx_type = 'PAYMENT' THEN amount
           WHEN tx_type = 'REFUND'  THEN -amount
           ELSE 0 END)                                    AS net_revenue
FROM payment_tx
WHERE paid_at >= '2023-01-01' AND paid_at < '2023-02-01';
```

핵심은 `CASE WHEN` 안에서 부호를 뒤집어 한 번의 스캔으로 gross·refund·net을 모두 뽑는다는 점이다. 환불을 따로 조회해서 애플리케이션에서 빼면, 결제 집계 시점과 환불 집계 시점 사이에 데이터가 바뀌어 정합이 어긋날 수 있다. **한 쿼리 한 트랜잭션 시점**에서 같이 집계하는 것이 안전하다.

## 코드값을 명칭으로: CASE vs 조인

상태가 `01`, `02` 같은 코드로 저장되어 있으면 리포트엔 "결제완료", "환불"처럼 보여야 한다. 두 방법이 있다.

```sql
-- (A) CASE 인라인 매핑: 코드 종류가 적고 거의 안 바뀔 때
SELECT
  CASE status_code
    WHEN '01' THEN '결제완료'
    WHEN '02' THEN '부분환불'
    WHEN '03' THEN '전액환불'
    ELSE '기타'
  END AS status_name,
  SUM(amount) AS total
FROM payment_tx
GROUP BY status_code;

-- (B) 코드 마스터 테이블 조인: 코드가 자주 늘거나 다국어가 필요할 때
SELECT c.code_name AS status_name, SUM(p.amount) AS total
FROM payment_tx p
JOIN code_master c
  ON c.code_group = 'PAYMENT_STATUS' AND c.code = p.status_code
GROUP BY c.code_name;
```

(A)는 빠르고 단순하지만 코드가 바뀌면 쿼리를 고쳐 배포해야 한다. (B)는 운영자가 명칭을 데이터로 관리할 수 있어 변경에 강하다. **코드가 안정적이면 CASE, 자주 바뀌면 마스터 조인**이 원칙이다.

## 운영 함정

- **GROUP BY를 코드로 했는데 명칭으로 표시한 경우의 정렬.** 명칭으로 `ORDER BY` 하면 가나다순이 되어 의도한 순서(결제→부분환불→전액환불)가 깨진다. 정렬용 `sort_order` 컬럼을 코드 마스터에 두고 그걸로 정렬하라.
- **환불이 결제보다 늦은 달에 발생.** 1월 결제건이 2월에 환불되면, 1월 리포트엔 gross만 잡히고 2월에 음수 환불이 잡힌다. "발생 기준"으로 볼지 "원거래 귀속"으로 볼지 정책을 먼저 정해야 두 달 합계가 맞는다.

## 핵심 요약

- 매출 리포트의 기본은 `SUM(amount)`가 아니라 **타입별 부호를 가른 조건부 합**이다.
- 결제·환불은 같은 쿼리 한 시점에서 함께 집계해 정합을 맞춘다.
- 코드→명칭 변환은 안정적이면 `CASE`, 가변적이면 코드 마스터 조인. 정렬은 명칭이 아니라 `sort_order`로.

---
title: "상태가 바뀔 때마다 기록을 남기는 설계"
date: 2023-12-17 10:30:00 +0900
categories: [Database]
tags: [history, status-log, append-only, audit, timeline]
description: "현재 상태만 들고 있을 때 잃는 맥락과, append-only 이력 테이블로 상태 타임라인을 복원하는 설계."
---

상태 추적을 손본 주가 있었다. 주문이 결제완료 → 배송중 → 배송완료로 흐르는데, 테이블에는 `status` 컬럼 하나만 있었다. "이 주문이 언제 배송중으로 바뀌었지?", "취소되기 전 상태가 뭐였지?"라는 질문에 답할 수 없었다. 현재 상태만 들고 있으면 **과거가 통째로 사라진다.**

## 현재 상태 컬럼의 한계

`status` 컬럼은 최신 값만 보관한다. UPDATE로 덮어쓰는 순간 직전 값은 소멸한다. 그러면 이런 것들이 불가능해진다.

- **타임라인 복원** — 각 상태에 언제 진입했는지.
- **체류 시간 분석** — "결제완료에서 배송중까지 평균 몇 시간 걸리나."
- **감사(audit)** — 누가/무엇이 상태를 바꿨는지, 비정상 전이가 있었는지.
- **디버깅** — "취소됐는데 왜 배송됐지?" 같은 사고 추적.

## append-only 이력 테이블

해법은 상태를 **덮어쓰지 않고 쌓는 것**이다. 상태가 바뀔 때마다 이력 테이블에 한 줄을 INSERT한다. 행을 수정·삭제하지 않으므로 append-only다.

```sql
CREATE TABLE order_status_history (
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id     BIGINT NOT NULL,
    from_status  VARCHAR(20),         -- 직전 상태 (최초는 NULL)
    to_status    VARCHAR(20) NOT NULL,
    changed_by   VARCHAR(50),         -- 행위자(시스템/사용자 식별)
    changed_at   DATETIME NOT NULL,
    INDEX idx_order_time (order_id, changed_at)
);
```

현재 상태는 두 방식 중 하나로 안다.

- **빠른 조회용으로 본 테이블에 `status` 컬럼을 함께 둔다.** 이력은 진실의 원천(source of truth), `status`는 최신값 캐시다. 둘을 같은 트랜잭션에서 함께 갱신한다.
- 또는 이력만 두고 `to_status`의 최신 행을 현재 상태로 본다(조회는 약간 느려진다).

대부분 전자를 쓴다. 본 테이블 `status`로 빠르게 읽고, 이력으로 과거를 복원한다.

```java
@Transactional
public void changeStatus(long orderId, OrderStatus to, String actor) {
    Order order = orderRepo.findByIdForUpdate(orderId).orElseThrow();
    OrderStatus from = order.getStatus();
    if (!from.canTransitionTo(to)) {            // 허용된 전이만
        throw new IllegalStateTransitionException(from, to);
    }
    order.setStatus(to);                        // 최신값 캐시 갱신
    historyRepo.save(new StatusHistory(orderId, from, to, actor, now()));
}
```

타임라인은 이력을 시간순으로 읽으면 그대로 복원된다.

```sql
SELECT to_status, changed_at, changed_by
FROM order_status_history
WHERE order_id = :id
ORDER BY changed_at, id;
```

## 운영 함정

**1) 본 테이블 status와 이력의 정합성.** 둘을 따로 쓰면 어긋날 수 있다. 반드시 **하나의 트랜잭션**에서 함께 갱신하고, 상태 변경은 직접 UPDATE 대신 위 `changeStatus` 같은 단일 경로로만 통과시킨다. 여러 곳에서 제멋대로 status를 UPDATE하면 이력이 누락된다.

**2) 잘못된 전이를 막지 않으면 이력만으론 못 막는다.** 이력은 "기록"일 뿐 "검증"이 아니다. `배송완료 → 결제대기` 같은 비정상 전이는 상태 머신(`canTransitionTo`)으로 막아야 한다. 이력은 사후 추적, 상태 머신은 사전 방어다.

**3) 이력 테이블은 무한히 자란다.** append-only라 행이 계속 쌓인다. 조회 인덱스(`order_id, changed_at`)를 두고, 오래된 이력은 아카이브 테이블로 분리하는 보관 정책을 미리 정한다.

## 핵심 요약

- 현재 상태 컬럼만 두면 과거·체류시간·감사가 전부 사라진다.
- 상태 변경마다 append-only 이력에 INSERT. 본 테이블 status는 최신값 캐시로 두고 같은 트랜잭션에서 함께 갱신한다.
- 이력은 사후 추적, 상태 머신은 사전 검증. 둘은 다른 역할이다.

> Q. 상태 이력을 append-only로 두는 이유는?
> A. UPDATE로 덮으면 과거가 소멸한다. INSERT로 쌓으면 타임라인 복원·체류시간 분석·감사가 가능하고, 불변 기록이라 신뢰할 수 있다.

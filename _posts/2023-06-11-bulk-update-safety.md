---
title: "WHERE 없는 UPDATE 한 줄의 공포"
date: 2023-06-11 10:30:00 +0900
categories: [Database]
tags: [bulk-update, where, safe-update, transaction, backup]
description: "WHERE 누락으로 전체 행이 갱신되는 사고. 영향 행수 확인, 트랜잭션 내 검증, safe-update 모드로 막는 법을 정리한다."
---

## 들어가며

어느 주, 여러 행을 한 번에 고치는 일괄 수정을 다뤘다. 일괄 수정은 편하지만 위험하다. `UPDATE orders SET status = 'CANCELLED'` — `WHERE` 한 줄을 빠뜨리면 테이블의 **모든 행**이 취소 상태가 된다. 손이 한 번 미끄러지면 복구 불가능한 데이터 사고가 난다. 이 공포를 구조로 막는 법이 있다.

## 핵심 개념: UPDATE의 영향 범위는 WHERE가 결정한다

SQL의 `UPDATE`/`DELETE`는 **WHERE 절이 없으면 전체 행에 적용**된다. 이건 버그가 아니라 명세다. DB 입장에서 "조건 없음"은 "모든 행"과 동의어다. 따라서 안전은 DB가 아니라 **호출하는 쪽의 규율**에서 나온다.

핵심 방어선은 세 가지다.

1. **WHERE를 절대 비우지 않는다** — 그리고 그 WHERE가 인덱스를 타는지도 본다(전체 스캔 락 방지).
2. **영향 행수를 예측하고 확인한다** — "이 조건이면 N건이어야 한다"를 알고, 실제 affected rows와 대조한다.
3. **트랜잭션으로 감싼다** — 예상과 다르면 커밋 전에 롤백한다.

## 트랜잭션 내 검증 패턴

가장 강력한 방어는 **변경하고 → 영향 행수를 확인하고 → 이상하면 롤백**하는 흐름이다.

```java
@Transactional
public void cancelOrders(List<Long> orderIds, int expectedCount) {
    if (orderIds.isEmpty()) {
        throw new IllegalArgumentException("대상 없음 — 전체 갱신 방지");
    }

    int affected = orderMapper.updateStatus(orderIds, "CANCELLED");

    // 예측과 다르면 트랜잭션을 깬다. 커밋 전이라 안전하게 되돌아간다.
    if (affected != expectedCount) {
        throw new IllegalStateException(
            "예상 " + expectedCount + "건, 실제 " + affected + "건 — 롤백");
    }
}
```

```xml
<update id="updateStatus">
  UPDATE orders
     SET status = #{status}, updated_at = NOW()
   WHERE id IN
     <foreach collection="ids" item="id" open="(" separator="," close=")">
       #{id}
     </foreach>
</update>
```

`IN (...)`이 빈 리스트로 들어가면 동적 SQL이 깨지거나 의도치 않게 전 범위를 건드릴 수 있으므로, **빈 컬렉션을 메서드 진입에서 먼저 차단**한다. 이 한 줄이 "전체 갱신" 사고의 큰 줄기를 막는다.

## DB 클라이언트의 safe-update 모드

운영자가 콘솔에서 직접 손댈 때를 위한 안전장치도 있다. MySQL은 `SQL_SAFE_UPDATES`를 켜면, 키 컬럼 조건 없는 `UPDATE`/`DELETE`를 **에러로 거부**한다.

```sql
SET SQL_SAFE_UPDATES = 1;
-- WHERE 없는 UPDATE → Error 1175 로 차단됨
```

운영 DB 세션 기본값으로 켜 두면, 실수로 친 `WHERE` 없는 쿼리가 실행되기 전에 막힌다.

## 운영 함정

**함정 1 — 대량 UPDATE의 락과 복제 지연.** 한 트랜잭션에서 수십만 행을 건드리면 그 행들에 락이 잡혀 다른 요청이 대기하고, 언두 로그가 부풀며, 복제 환경에선 슬레이브가 밀린다. 큰 변경은 **배치(chunk) 단위로 쪼개** 커밋한다.

**함정 2 — "조건은 넣었는데 너무 넓었다."** `WHERE status = 'PENDING'`이 의도보다 많은 행을 잡는 경우다. 실행 전 같은 조건으로 `SELECT COUNT(*)`를 먼저 돌려 **영향 규모를 눈으로 확인**하는 습관이 사고를 줄인다.

## 핵심 요약

- WHERE 없는 UPDATE/DELETE는 전체 행에 적용된다 — 명세이지 버그가 아니다.
- 방어는 코드 규율: **빈 조건 차단 + 영향 행수 검증 + 트랜잭션 롤백 + safe-update 모드.**
- 면접 한 줄 — **"실수로 전체 갱신을 막으려면?"** → 트랜잭션 안에서 affected rows를 예상값과 비교해 다르면 롤백하고, 대상 컬렉션이 비면 진입에서 거부하며, 운영 세션엔 SQL_SAFE_UPDATES를 켠다.

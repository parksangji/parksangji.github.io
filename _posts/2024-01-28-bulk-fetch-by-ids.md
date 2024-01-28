---
title: "여러 상세를 한 번에 불러오는 배치 조회 — N+1을 IN 한 방으로"
date: 2024-01-28 10:30:00 +0900
categories: [Backend]
tags: [batch-fetch, dataloader, n-plus-1, in-clause, aggregation]
description: "개별 조회를 반복하는 N+1 대신, ID를 모아 IN 절로 한 번에 가져와 맵으로 재배치하는 배치 조회 패턴을 정리한다."
---

여러 건의 상세 정보를 한꺼번에 보여주는 화면을 다루다 보면, 코드가 무심코 이렇게 흘러간다. 목록을 돌면서 각 항목마다 상세를 한 번씩 조회한다. 동작은 하지만 쿼리가 항목 수만큼 날아간다. 이것이 그 유명한 **N+1 문제**이고, 해법은 단순하다. **모아서 한 번에.**

## N+1은 왜 생기고 왜 느린가

```java
List<Order> orders = orderRepository.findRecent();   // 쿼리 1번
for (Order o : orders) {
    User u = userRepository.findById(o.getUserId());  // 주문 수만큼 추가 쿼리
    o.setUser(u);
}
```

주문이 100건이면 쿼리는 1 + 100 = 101번이다. 느린 진짜 이유는 SQL 자체가 아니라 **네트워크 왕복(round-trip)** 이다. 쿼리 한 번의 비용 대부분은 애플리케이션과 DB 사이를 오가는 지연시간이다. 100번 왕복하면 그 지연이 100배로 쌓인다. 쿼리당 1ms 왕복이라도 100건이면 100ms가 통째로 날아간다.

## ID를 모아 IN 절로 한 번에

해법은 루프 안에서 조회하지 않고, **필요한 ID를 전부 모은 뒤 한 번의 IN 쿼리**로 가져오는 것이다.

```java
List<Order> orders = orderRepository.findRecent();           // 쿼리 1
Set<Long> userIds = orders.stream()
    .map(Order::getUserId).collect(Collectors.toSet());
List<User> users = userRepository.findByIdIn(userIds);        // 쿼리 1 (IN)
```

```sql
SELECT * FROM users WHERE id IN (3, 7, 12, 15, ...);
```

101번이 2번으로 줄었다. 이제 가져온 `users`를 주문에 다시 붙여야 하는데, 리스트를 매번 순회하면 O(N×M)이 된다. **ID → 객체 맵으로 인덱싱**해 O(1) 조회로 재배치한다.

```java
Map<Long, User> byId = users.stream()
    .collect(Collectors.toMap(User::getId, u -> u));
for (Order o : orders) {
    o.setUser(byId.get(o.getUserId()));   // 맵 조회, 왕복 없음
}
```

이 "모아서 IN 조회 → 맵으로 재배치" 패턴이 DataLoader 류 라이브러리가 내부에서 하는 일의 본질이다. 한 틱 동안 요청된 ID를 모아 한 번에 적재하고, 결과를 키로 분배한다.

## 운영 함정

**IN 절 길이 폭발.** IN에 ID를 수천~수만 개 넣으면 SQL 파싱이 느려지고, DB에 따라 파라미터 개수 상한에 걸린다. 또 매번 다른 개수의 바인딩은 prepared statement 캐시를 무력화한다. **ID를 1000개 단위 등으로 쪼개 여러 번 IN 조회**하고 결과를 합치는 것이 안전하다. MyBatis의 `foreach`로 IN을 만들 때도 이 청크 분할을 함께 적용한다.

**누락 ID 처리.** IN으로 가져온 결과에 일부 ID가 빠질 수 있다(삭제됐거나 권한 밖). 맵에서 `get`이 `null`을 돌려줄 때를 반드시 처리해야 한다. 누락을 그냥 두면 NPE로 터지거나, 화면에서 일부 항목이 조용히 비어 버린다.

## 면접 한 줄 Q&A

- **Q. N+1이 느린 근본 원인은?** 쿼리 횟수만큼 쌓이는 DB 왕복 지연. SQL 자체보다 네트워크 round-trip 누적이 지배적이다.
- **Q. 배치 조회 후 결과를 다시 붙이는 효율적 방법은?** `id → 객체` 맵으로 인덱싱해 O(1)로 재배치한다. 리스트를 매번 순회하면 O(N×M)이 된다.
- **Q. IN 절에 ID가 너무 많으면?** 파싱 비용·파라미터 상한·PSC 무력화 문제가 생기므로 일정 크기로 청크 분할해 여러 번 조회한다.

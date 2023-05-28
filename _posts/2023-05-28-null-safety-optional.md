---
title: "NPE를 설계로 막는 법"
date: 2023-05-28 10:30:00 +0900
categories: [Java]
tags: [optional, null-safety, npe, defensive, api-design]
description: "Optional의 올바른 용처, 컬렉션은 빈 값 반환, 경계에서 null 차단. NPE를 런타임이 아니라 설계로 막는 원칙을 정리한다."
---

## 들어가며

어느 주, NullPointerException 하나를 잡으며 시간을 보냈다. 스택트레이스만 보면 터진 줄은 알지만, **진짜 원인은 그 값이 null일 수 있다는 사실을 타입이 말해주지 않은 것**이다. NPE는 발생한 자리에서 고치면 또 다른 자리에서 터진다. 근본 해결은 "null이 들어올 수 있는 자리"를 설계 단계에서 줄이는 것이다.

## 핵심 개념: null은 "값의 부재"를 표현하는 가장 나쁜 방법

`null`의 문제는 **타입 시스템을 통과한다**는 점이다. `String name`은 "이름 문자열"이라 선언했지만 실제로는 null일 수도 있고, 컴파일러는 둘을 구분하지 못한다. 그래서 호출자는 매번 "이게 null일까?"를 추측해야 한다.

`Optional<T>`는 이 부재 가능성을 **타입에 명시적으로 박는다.** `Optional<User>`를 받은 사람은 "비어 있을 수 있구나"를 타입만 보고 안다. 컴파일러가 `.get()` 전에 `isPresent()`나 `orElse()`를 거치도록 유도하므로, 실수가 런타임이 아니라 코드 작성 시점에 드러난다.

## Optional의 올바른 용처

Optional은 만능이 아니다. **반환 타입에만** 쓰는 게 원칙이다.

- ✅ **메서드 반환값** — "찾을 수도, 못 찾을 수도 있는 조회"에 적합. `findById`가 대표.
- ❌ **필드** — 직렬화 문제, 메모리 오버헤드. 필드는 그냥 null 허용 여부를 문서/검증으로 다룬다.
- ❌ **메서드 파라미터** — 호출부가 `Optional.of(...)`로 감싸야 해 오히려 번거롭다. 오버로딩이나 null 체크가 낫다.
- ❌ **컬렉션 반환** — 빈 리스트로 충분하다. `Optional<List<T>>`는 안티패턴.

## 코드 예시

```java
// 1. 조회는 Optional 반환 — 부재를 타입으로 표현
public Optional<User> findByEmail(String email) {
    return Optional.ofNullable(userMapper.selectByEmail(email));
}

// 호출부: get() 직접 호출 금지. 분기를 강제당한다.
User user = userRepo.findByEmail(email)
        .orElseThrow(() -> new NotFoundException("user"));

// 2. 컬렉션은 절대 null 반환하지 않는다 — 빈 컬렉션
public List<Order> findOrders(Long userId) {
    List<Order> list = orderMapper.selectByUser(userId);
    return list != null ? list : Collections.emptyList();
}

// 호출부가 null 체크 없이 바로 순회 가능
for (Order o : findOrders(userId)) { ... }
```

핵심은 **경계에서 null을 차단**하는 것이다. 외부(DB·API)에서 들어온 값은 진입 지점에서 한 번 정규화한다. 그러면 내부 로직은 "여기는 null이 없다"는 전제 위에서 단순해진다.

## 운영 함정

**함정 1 — `Optional.get()` 남발.** `.get()`은 비어 있으면 `NoSuchElementException`을 던진다. 결국 null 검사를 Optional 검사로 바꿨을 뿐 안전성이 늘지 않는다. `orElse`·`orElseThrow`·`map`·`ifPresent`로 분기를 명시한다.

**함정 2 — `orElse`에 비싼 연산.** `orElse(expensiveCall())`는 값이 있어도 인자를 **항상 평가**한다. 값이 있을 땐 버려지는데도 호출된다. 비싼 기본값은 `orElseGet(() -> ...)`으로 지연 평가한다.

## 핵심 요약

- null의 죄는 "부재 가능성이 타입에 안 보이는 것". Optional은 그걸 타입에 새긴다.
- Optional은 **반환 타입 전용.** 필드·파라미터·컬렉션엔 쓰지 않는다.
- 면접 한 줄 Q&A — **"`orElse`와 `orElseGet` 차이?"** → `orElse`는 인자를 항상 평가, `orElseGet`은 비었을 때만 람다를 호출한다. 기본값 계산이 비싸면 후자.

---
title: "싱글톤 빈에 상태를 두면 안 되는 이유"
date: 2024-07-14 10:30:00 +0900
categories: [Java]
tags: [thread-safety, singleton, shared-state, spring-bean, concurrency]
description: "스프링 빈이 싱글톤이라 인스턴스 필드를 모든 요청 스레드가 공유한다는 사실과, 지역변수·ThreadLocal로 상태를 분리하는 원칙을 설명한다."
---

특정 조건에서만 간헐적으로 값이 섞이는 버그를 잡던 주였다. 재현이 안 되고, 부하가 몰릴 때만 터졌다. 이런 증상의 단골 원인은 하나다. **싱글톤 빈의 인스턴스 필드에 요청별 상태를 담은 것.** 스프링 빈의 기본 스코프가 싱글톤이라는 사실을 잊으면 반드시 만나는 함정이다.

## 왜 위험한가 — 하나의 인스턴스, 여러 스레드

스프링 빈은 기본적으로 **싱글톤 스코프**다. 애플리케이션 컨텍스트당 인스턴스가 단 하나 생성되고, 모든 요청이 그 하나를 공유한다. 웹 서버는 요청마다 별도 스레드를 할당하므로, 수십 개의 요청 스레드가 **같은 빈 인스턴스의 같은 필드**를 동시에 읽고 쓴다.

여기에 가변 인스턴스 필드를 두면 경쟁 상태(race condition)가 생긴다. 스레드 A가 필드에 값을 쓰고 다음 줄을 실행하기 직전, 스레드 B가 같은 필드를 덮어쓴다. A는 자기가 쓴 값을 기대하지만 B의 값을 읽는다. 부하가 낮으면 스레드들이 시간상 겹치지 않아 멀쩡하다가, 트래픽이 몰리면 겹쳐서 터진다. "간헐적"의 정체다.

```java
@Service
public class OrderService {
    private long currentUserId;   // ❌ 모든 스레드가 공유하는 가변 필드

    public Order createOrder(long userId, Cart cart) {
        this.currentUserId = userId;        // 스레드 A가 5번 저장
        validate(cart);                     // 이 사이에 스레드 B가 9번으로 덮어씀
        return new Order(this.currentUserId, cart); // A가 9번 주문을 만든다
    }
}
```

`validate(cart)`가 도는 짧은 순간에 다른 스레드가 `currentUserId`를 바꾸면, 주문이 엉뚱한 사용자에게 붙는다.

## 원칙 — 상태는 스택이나 ThreadLocal에

해법은 단순하다. **요청별 상태를 인스턴스 필드가 아니라 지역변수(메서드 스택)에 둔다.** 스택 프레임은 스레드마다 독립이므로 절대 공유되지 않는다.

```java
@Service
public class OrderService {
    public Order createOrder(long userId, Cart cart) {
        validate(cart);
        return new Order(userId, cart); // 파라미터·지역변수로만 흐른다
    }
}
```

값을 메서드 체인 깊숙이 전달해야 해서 파라미터로 넘기기 번거롭다면 `ThreadLocal`을 쓴다. ThreadLocal은 스레드마다 별도 저장소를 주므로 공유되지 않는다. 단, 스레드 풀 환경에서는 **요청 종료 시 반드시 `remove()`**로 비워야 한다. 안 그러면 풀에 반납된 스레드가 다음 요청에서 이전 값을 그대로 본다(값 누수).

빈에 둬도 되는 필드는 **불변(immutable)이거나 그 자체가 스레드 안전한 것**뿐이다. 주입받은 다른 빈, 설정값(`final`), `ConcurrentHashMap` 같은 스레드 안전 컬렉션이 그 예다.

## 운영 함정

**함정 1 — SimpleDateFormat 같은 비-스레드세이프 객체를 필드로.** `SimpleDateFormat`은 내부에 가변 상태를 가져 스레드 안전하지 않다. 싱글톤 빈의 필드로 두고 여러 스레드가 `format()`을 부르면 깨진 날짜가 나온다. `DateTimeFormatter`(불변)를 쓰거나 매번 지역에서 생성한다.

**함정 2 — 테스트에서 안 잡힌다.** 단위 테스트는 단일 스레드라 경쟁 상태가 재현되지 않는다. 코드 리뷰에서 "이 필드가 요청별 상태인가?"를 눈으로 거르는 게 더 확실하다.

## 핵심 요약

- 스프링 빈은 기본 싱글톤. 인스턴스 필드는 모든 요청 스레드가 공유한다.
- 요청별 상태는 지역변수(스택) 또는 ThreadLocal(반드시 remove)로 분리한다.
- 빈 필드에 둬도 되는 건 불변 객체나 스레드 안전 컬렉션뿐이다.

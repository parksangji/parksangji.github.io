---
title: "DTO를 불변으로 만들면 버그가 줄어든다"
date: 2025-11-09 10:30:00 +0900
categories: [Java]
tags: [dto, immutability, builder, thread-safety, value-object]
description: "setter로 가득한 DTO가 만드는 부분 초기화·동시성 버그를 불변 객체와 빌더, 그리고 값 동등성으로 막는 방법을 정리한다."
---

데이터 전달 객체를 다듬는 주였다. 핵심은 한 가지로 압축된다. **DTO는 만들어진 뒤 바뀌지 않아야 한다.**

## setter가 만드는 부분 초기화 버그

전형적인 DTO는 기본 생성자 + 모든 필드의 setter다. 문제는 객체가 "완성"되는 시점이 코드 어디에도 명시되지 않는다는 것이다.

```java
OrderDto dto = new OrderDto();
dto.setUserId(userId);
dto.setAmount(amount);
// setStatus 를 깜빡함 → status = null 인 채로 흘러간다
service.place(dto);
```

컴파일러는 막지 못한다. `status`가 null이어도 객체는 멀쩡히 생성되고, 한참 떨어진 곳에서 NPE가 터진다. setter는 "객체는 언제든 변할 수 있다"는 신호이므로, 어느 메서드가 이 객체를 몰래 바꿨는지 추적하는 데 시간이 든다.

## 불변 객체가 바꾸는 것

불변 객체는 모든 필드를 `final`로 두고 생성자에서 한 번에 채운다. 그러면 **유효한 상태가 아니면 객체가 아예 생성되지 않는다.**

```java
public final class OrderDto {
    private final Long userId;
    private final long amount;
    private final OrderStatus status;

    public OrderDto(Long userId, long amount, OrderStatus status) {
        this.userId = Objects.requireNonNull(userId);
        if (amount < 0) throw new IllegalArgumentException("amount < 0");
        this.amount = amount;
        this.status = Objects.requireNonNull(status);
    }
    // getter만 존재. setter 없음.
}
```

생성자가 곧 불변식(invariant)을 강제하는 관문이 된다. 일단 생성되면 그 객체는 영원히 유효하다. 이것이 불변의 본질적 이득이다. 검증을 한 곳에 모으고, 그 뒤로는 신뢰한다.

필드가 많으면 생성자 인자 순서가 헷갈리므로 빌더를 얹는다. 빌더는 가독성을 주되, **마지막 `build()`에서 한 번 검증**한다는 규칙을 지켜야 의미가 있다.

```java
OrderDto dto = OrderDto.builder()
        .userId(userId).amount(amount).status(NEW)
        .build();   // 여기서 누락 필드 검증
```

## 왜 스레드 안전한가

불변 객체는 추가 동기화 없이 여러 스레드가 공유해도 안전하다. 이유는 메모리 모델에 있다. `final` 필드는 생성자가 끝나는 시점에 그 값이 다른 스레드에도 정확히 보이도록 보장된다(final field freeze). 즉 객체 참조를 안전하게 넘기기만 하면, 그 안의 `final` 필드는 "초기화 안 된 상태로 보이는" 일이 없다. 가변 객체는 이 보장이 없어 visibility 버그가 난다.

## 값 객체의 동등성

DTO/값 객체는 동일성(`==`)이 아니라 **값이 같으면 같은 객체**로 다뤄야 할 때가 많다. `Map`의 키나 `Set` 원소로 쓰려면 `equals`/`hashCode`를 값 기준으로 재정의해야 한다. 불변이면 이게 안전하다 — 한 번 정해진 `hashCode`가 컬렉션에 들어간 뒤 바뀌지 않기 때문이다.

```java
Money a = new Money(1000, "KRW");
Money b = new Money(1000, "KRW");
a.equals(b);   // true 여야 한다
```

가변 객체를 `HashSet`에 넣고 나서 필드를 바꾸면 `hashCode`가 달라져 영영 찾지 못하는 버그가 난다. 불변이면 이 함정 자체가 사라진다.

## 운영 함정

- **얕은 불변**: 필드가 `List`라면 `final`이어도 내부는 변한다. 생성자에서 `List.copyOf(...)`로 방어 복사하고, getter도 불변 뷰를 반환해야 진짜 불변이다.
- **빌더의 검증 누락**: 빌더만 도입하고 `build()`에서 검증을 안 하면 setter 시절의 부분 초기화 버그가 그대로 돌아온다.

## 핵심 요약

- 불변 DTO는 "유효하지 않으면 생성 불가"를 강제해 부분 초기화 버그를 컴파일·생성 시점으로 당긴다.
- `final` 필드는 안전 발행만 지키면 동기화 없이 스레드 안전하다.
- 값 객체는 `equals`/`hashCode`를 값 기준으로 재정의하되, 불변일 때만 컬렉션에서 안전하다.

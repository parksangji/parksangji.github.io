---
title: "필드 주입을 버리고 생성자 주입으로 가는 이유"
date: 2024-03-16 10:30:00 +0900
categories: [Backend]
tags: [dependency-injection, constructor-injection, spring, testability, immutability, refactoring]
description: "@Autowired 필드 주입을 생성자 주입으로 전환했다. final 불변 의존성, 목 주입의 용이함, 순환 의존성을 기동 시점에 드러내는 효과를 정리한다."
---

그 주엔 여러 모듈의 의존성 주입을 필드 주입에서 생성자 주입으로 바꾸는 리팩토링을 했다. `@Autowired`를 필드에 붙이는 방식은 코드가 가장 짧아 오래된 코드베이스에 흔하다. 잘 돈다. 그런데 스프링 팀이 공식적으로 **생성자 주입을 권장**하고, IDE가 필드 주입에 경고를 띄우는 데는 이유가 있다. 단순한 취향 문제가 아니라 **설계 품질이 갈리는 선택**이다.

## 세 가지 주입 방식

```java
// 1. 필드 주입 — 짧지만 문제가 많다
@Service
public class OrderService {
    @Autowired private PaymentClient paymentClient;
    @Autowired private OrderRepository orderRepository;
}

// 2. 생성자 주입 — 권장
@Service
public class OrderService {
    private final PaymentClient paymentClient;
    private final OrderRepository orderRepository;

    public OrderService(PaymentClient paymentClient,
                        OrderRepository orderRepository) {
        this.paymentClient = paymentClient;
        this.orderRepository = orderRepository;
    }
}
```

생성자가 하나뿐이면 스프링 4.3부터는 `@Autowired`조차 생략할 수 있다. 롬복의 `@RequiredArgsConstructor`를 쓰면 `final` 필드만 선언해도 생성자가 자동 생성된다.

## 생성자 주입이 주는 것

**1. 불변(final) 의존성.** 생성자 주입은 의존성을 `final`로 선언할 수 있다. 객체가 만들어진 뒤엔 의존성이 바뀌지 않는다는 게 컴파일 시점에 보장된다. 필드 주입은 `final`이 불가능해서, 누군가 리플렉션이나 세터로 의존성을 갈아끼울 여지가 남는다.

**2. 객체가 항상 완전한 상태로 태어난다.** 생성자 주입은 의존성이 다 주어져야 객체가 생성된다. 즉 **인스턴스가 존재하면 의존성은 반드시 채워져 있다.** 필드 주입은 일단 객체를 만든 뒤 나중에 필드를 꽂으므로, 주입 전 잠깐 `null`인 시점이 존재한다. 그 사이에 메서드가 불리면 NPE다.

**3. 테스트가 쉬워진다.** 이게 실무에서 가장 크게 체감된다. 생성자 주입은 스프링 컨테이너 없이 그냥 `new`로 목을 넣어 만들 수 있다.

```java
@Test
void 결제_실패시_주문은_생성되지_않는다() {
    PaymentClient mockPayment = mock(PaymentClient.class);
    OrderRepository mockRepo = mock(OrderRepository.class);
    when(mockPayment.charge(any())).thenThrow(new PaymentException());

    OrderService service = new OrderService(mockPayment, mockRepo); // 그냥 new

    assertThrows(PaymentException.class, () -> service.place(order));
    verify(mockRepo, never()).save(any());
}
```

필드 주입은 `private` 필드라 테스트에서 의존성을 넣으려면 리플렉션을 쓰거나 스프링 테스트 컨텍스트를 띄워야 한다. 둘 다 무겁고 번거롭다.

**4. 순환 의존성이 기동 시점에 드러난다.** A가 B를, B가 A를 필요로 하는 순환 참조는 설계가 꼬였다는 신호다. 생성자 주입은 이걸 **애플리케이션 기동 시점에 에러로 터뜨린다** — 서로의 생성자를 만족시킬 수 없기 때문이다. 필드 주입은 일단 객체를 만든 뒤 꽂으므로 순환을 조용히 숨겨 버린다. 문제를 늦게, 운영 중에 발견하게 만든다. **일찍 깨지는 게 좋은 거다.**

## 책임 정렬도 같이 따라온다

생성자 주입으로 바꾸면 생성자 파라미터 목록이 그 클래스의 의존성 전체를 한눈에 보여준다. 파라미터가 7개, 8개로 늘어나면 "이 클래스가 너무 많은 일을 한다"는 게 코드로 드러난다. 컨트롤러는 서비스만, 서비스는 레포지토리와 협력 객체만 — 의존성 목록이 곧 책임의 척도가 된다. 필드 주입은 `@Autowired`가 여기저기 흩어져 이 신호를 가린다.

## 운영 함정

**순환 의존성을 `@Lazy`로 덮지 마라.** 생성자 주입으로 바꿨더니 기동이 안 된다면 진짜 순환 참조가 있는 것이다. `@Lazy`나 세터 주입으로 우회하면 에러는 사라지지만 설계 결함은 그대로 남는다. 공통 로직을 제3의 컴포넌트로 빼서 순환 자체를 끊는 게 맞다.

**전환 중 생성자 폭발.** 리팩토링 중 의존성이 많은 클래스를 생성자 주입으로 바꾸면 파라미터가 우르르 늘어 거북하다. 이건 생성자 주입의 단점이 아니라, 그 클래스가 원래 비대했다는 진단이다. 신호를 무시하지 말고 쪼개라.

## 핵심 요약

- 생성자 주입은 `final` 불변 의존성을 보장하고, 객체를 완전한 상태로 태어나게 한다.
- 스프링 없이 `new`로 목을 넣을 수 있어 테스트가 가볍다.
- 순환 의존성을 기동 시점에 에러로 드러낸다 — 늦게 터지는 것보다 낫다.
- 늘어난 생성자 파라미터는 책임 과다의 신호다.

> **면접 한 줄 Q&A**
> Q. 필드 주입 대신 생성자 주입을 쓰는 가장 큰 이유는?
> A. 불변성·완전한 초기화·테스트 용이성. 특히 순환 의존성을 기동 시점에 터뜨려 설계 결함을 일찍 드러낸다. 필드 주입은 이를 숨긴다.

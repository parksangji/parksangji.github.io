---
title: "외부 API를 갈아끼우는 설계 — 전략과 팩토리로 클라이언트 추상화하기"
date: 2024-06-10 10:30:00 +0900
categories: [Backend]
tags: [strategy-pattern, factory, external-api, rest-client, abstraction, spring]
description: "서로 다른 외부 REST API를 요청 빌드·인증·응답 파싱 전략으로 캡슐화하고 팩토리로 선택하는 구조. OCP를 지키며 새 연동을 무수정으로 추가하는 법."
---

## 도입 — 외부 연동이 늘어날 때 코드가 무너지는 지점

외부 SaaS 한두 개를 붙일 때는 서비스 클래스 안에 `RestTemplate` 호출을 직접 박아도 된다. 문제는 세 번째, 네 번째 연동이 들어올 때다. 결제사가 둘이 되고, 알림 업체가 셋이 되면 `if (provider.equals("A")) ... else if ...` 분기가 서비스 곳곳에 번진다. 인증 방식도 제각각이다. 어떤 곳은 헤더 API 키, 어떤 곳은 OAuth 토큰, 어떤 곳은 요청 본문 서명이다. 응답 포맷도 JSON 구조가 다 다르다.

이 주에 다룬 핵심은 **"외부 API를 호출하는 행위 자체를 하나의 전략으로 캡슐화"** 하는 것이다. 요청을 어떻게 만들고(build), 어떻게 인증하고(auth), 응답을 어떻게 우리 도메인 객체로 파싱(parse)하는지를 한 묶음으로 묶어 인터페이스 뒤로 숨긴다. 그리고 "어떤 전략을 쓸지"는 팩토리가 결정한다.

## 핵심 개념 — 전략 + 팩토리가 OCP를 만드는 원리

OCP(개방-폐쇄 원칙)는 "확장에는 열려 있고 수정에는 닫혀 있다"는 뜻이다. 새 외부 API가 추가될 때 **기존 코드를 한 줄도 고치지 않고** 클래스 하나만 더하면 끝나야 한다. 이걸 가능하게 하는 두 축이 있다.

- **전략(Strategy)**: 변하는 부분(API별 요청/인증/파싱)을 공통 인터페이스로 추상화. 호출부는 인터페이스만 안다.
- **팩토리(Factory)**: 런타임에 어떤 구현체를 쓸지 선택하는 책임을 한 곳에 모은다. 분기가 팩토리 한 곳에만 존재한다.

핵심은 **호출부와 구현체 사이의 의존 방향을 뒤집는 것**이다. 서비스는 구체 클래스(`KakaoPayClient`)가 아니라 추상(`PaymentGateway`)에 의존한다. 스프링이라면 이 전환을 DI 컨테이너가 거의 공짜로 해준다.

## 코드 — 공통 핸들러 인터페이스와 전략 구현

먼저 요청/인증/파싱을 묶은 공통 인터페이스다.

```java
public interface PaymentGateway {
    PaymentResult charge(ChargeRequest req);
    GatewayType type();   // 자기 식별
}
```

각 외부 API는 자신의 요청 빌드·인증·파싱을 이 안에 가둔다.

```java
@Component
public class StripeGateway implements PaymentGateway {
    private final RestClient client;

    public StripeGateway(RestClient.Builder builder) {
        this.client = builder.baseUrl("https://api.stripe.example").build();
    }

    @Override
    public PaymentResult charge(ChargeRequest req) {
        // 1) 요청 빌드: 이 업체는 form-encoded를 받는다
        var body = "amount=" + req.amount() + "&currency=" + req.currency();
        // 2) 인증: Bearer 시크릿 키
        var raw = client.post()
            .header("Authorization", "Bearer " + secretKey)
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .body(body)
            .retrieve()
            .body(StripeResponse.class);
        // 3) 파싱: 업체 응답 → 우리 도메인 결과
        return new PaymentResult(raw.id(), raw.status().equals("succeeded"));
    }

    @Override public GatewayType type() { return GatewayType.STRIPE; }
}
```

다른 업체는 인증이 헤더 API 키이고 응답 필드명이 다를 뿐, **같은 인터페이스**를 구현한다. 호출부는 이 차이를 전혀 모른다.

## 팩토리 — 선택의 책임을 한 곳에

스프링은 같은 타입의 빈을 `List`나 `Map`으로 주입해준다. 이걸 이용하면 팩토리에서 if 분기조차 없앨 수 있다.

```java
@Component
public class PaymentGatewayFactory {
    private final Map<GatewayType, PaymentGateway> registry;

    // 스프링이 모든 PaymentGateway 구현체를 주입
    public PaymentGatewayFactory(List<PaymentGateway> gateways) {
        this.registry = gateways.stream()
            .collect(Collectors.toMap(PaymentGateway::type, g -> g));
    }

    public PaymentGateway resolve(GatewayType type) {
        var gw = registry.get(type);
        if (gw == null) throw new IllegalArgumentException("unsupported: " + type);
        return gw;
    }
}
```

이제 새 업체(`TossGateway`)를 추가하면 클래스 하나만 만들면 된다. 스프링이 자동으로 주입하고, 팩토리 맵에 자동 등록된다. **팩토리 코드도, 서비스 코드도 손대지 않는다.** 이것이 OCP가 실제로 작동하는 모습이다.

호출부는 이렇게 깔끔해진다.

```java
PaymentResult r = factory.resolve(order.gatewayType()).charge(req);
```

## 운영 함정

**1) 인터페이스가 최소공배수로 비대해진다.** 어떤 업체는 부분 취소를 지원하고 어떤 업체는 안 한다. 모든 메서드를 `PaymentGateway` 한 인터페이스에 욱여넣으면, 지원 안 하는 구현체가 `UnsupportedOperationException`을 던지는 지뢰가 된다. 이건 ISP(인터페이스 분리 원칙) 위반이다. **공통 동작과 선택적 동작을 별도 인터페이스로 쪼개라**(`PaymentGateway`, `Refundable`). 팩토리는 필요 시 `instanceof Refundable`로 능력을 질의한다.

**2) 타임아웃/재시도를 전략 안에 흩뿌린다.** 각 구현체가 제각각 타임아웃을 설정하면 한 업체가 느려질 때 전체가 흔들린다. 커넥션 타임아웃·읽기 타임아웃·재시도·서킷브레이커는 **공통 데코레이터나 `RestClient` 공통 설정으로 한 겹 더 추상화**해 전략 바깥에서 강제하는 편이 안전하다.

## 핵심 요약 / 면접 Q&A

- **Q. 전략 패턴과 팩토리 패턴의 역할 분담은?** A. 전략은 *행위의 교체 가능성*(요청/인증/파싱을 인터페이스 뒤로 숨김), 팩토리는 *어떤 전략을 쓸지 선택하는 책임*을 한 곳에 모은다. 둘을 합치면 호출부에서 분기가 사라진다.
- **Q. 스프링에서 새 연동을 무수정으로 추가하려면?** A. 공통 인터페이스를 구현한 빈을 추가하면 `List`/`Map` 주입으로 팩토리에 자동 등록되게 한다. 호출부와 팩토리 모두 변경 불필요.
- **한 줄 정리:** 변하는 것(API별 차이)은 전략으로 가두고, 선택은 팩토리로 모으면, 확장은 클래스 추가만으로 끝난다.

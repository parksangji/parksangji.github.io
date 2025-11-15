---
title: "record DTO와 검증 어노테이션을 제대로 쓰기"
date: 2025-11-15 10:30:00 +0900
categories: [Backend]
tags: [record, dto, bean-validation, notblank, immutability, java]
description: "요청 DTO를 Java record로 전환하면 불변·간결해진다. @NotNull과 @NotBlank의 차이, 컴팩트 생성자 정규화, 역직렬화와의 궁합까지 정밀하게 다룬다."
---

그 주엔 요청 DTO 한 무더기를 Java `record`로 갈아엎고, 손대는 김에 검증 어노테이션도 다시 점검했다. 작업을 한 문장으로 추상화하면 "가변 클래스 DTO를 불변 record로 바꾸고, `@NotNull`로 뭉뚱그렸던 검증을 `@NotBlank`·`@Size`로 정밀화한다"가 된다. 여기서 알아야 할 핵심은 두 가지다. record가 무엇을 보장하고 무엇을 보장하지 않는지, 그리고 검증 어노테이션들이 각자 정확히 무엇을 막는지.

## record가 DTO에 주는 것

`record`는 final 필드 + 전 인자 생성자 + 접근자 + `equals`/`hashCode`/`toString`을 컴파일러가 생성하는 불변 데이터 운반체다. DTO의 본질이 "요청을 한 번 받아 서비스로 넘기는 운반"이라면 가변일 이유가 없다. setter가 없으니 컨트롤러와 서비스 사이에서 누가 몰래 필드를 바꿔치기할 여지도 사라진다.

```java
public record CreateOrderRequest(
        @NotNull Long productId,
        @NotBlank String receiverName,
        @Min(1) int quantity,
        @Email String contactEmail
) {}
```

주의할 점은 record가 "얕은 불변"이라는 것이다. 위 필드는 모두 값/문자열이라 안전하지만, `List<String> items` 같은 참조를 받으면 그 리스트 자체는 여전히 가변이다. 진짜 불변을 원하면 컴팩트 생성자에서 방어적 복사를 해야 한다.

## @NotNull vs @NotBlank — 어디서 무엇을 막나

가장 흔한 실수가 모든 문자열에 `@NotNull`만 붙이는 것이다. 세 어노테이션은 막는 범위가 다르다.

| 어노테이션 | `null` | `""` (빈 문자열) | `" "` (공백) |
|---|---|---|---|
| `@NotNull` | 막음 | 통과 | 통과 |
| `@NotEmpty` | 막음 | 막음 | 통과 |
| `@NotBlank` | 막음 | 막음 | 막음 |

이름 같은 필수 문자열에 `@NotNull`만 쓰면 빈 문자열 `""`이 그대로 통과한다. 클라이언트가 빈 input을 보내면 DB에 빈 문자열이 박힌다. 사람이 채워야 하는 문자열은 거의 항상 `@NotBlank`가 맞다. `@NotNull`은 숫자·boolean·날짜처럼 "값이 없으면 안 되는" 비문자열에 쓴다.

## 컴팩트 생성자에서 정규화

record는 컴팩트 생성자로 입력을 다듬을 수 있다. 검증 통과 직후 트림·정규화를 한곳에서 처리하면 서비스 계층이 깨끗해진다.

```java
public record CreateOrderRequest(Long productId, String receiverName, int quantity) {
    public CreateOrderRequest {            // 컴팩트 생성자
        receiverName = receiverName == null ? null : receiverName.strip();
        if (quantity < 1) {
            throw new IllegalArgumentException("quantity must be >= 1");
        }
    }
}
```

다만 Bean Validation은 생성자 실행 *이후* 필드 값에 동작한다. 즉 `@NotBlank`는 트림된 값을 본다(트림으로 빈 문자열이 되면 잡힌다). 반대로 컴팩트 생성자에서 던진 예외는 검증 프레임워크가 아니라 역직렬화 단계에서 터지므로, 같은 규칙을 양쪽에 중복으로 넣지 말고 책임을 하나로 정한다.

## 운영 함정

**역직렬화와 생성자.** Jackson은 record를 전 인자 생성자로 역직렬화한다. 필드가 누락된 JSON이면 객체 타입은 `null`, 기본형(`int`)은 0이 들어간다. `@NotNull`을 안 붙인 `Long`은 조용히 `null`로 만들어진 뒤 NPE로 이어지기 쉽다. 검증은 역직렬화 *후*에 돌므로 어노테이션을 빠뜨리면 방어선이 통째로 비는 셈이다.

**`@Valid` 누락.** 컨트롤러 파라미터에 `@Valid`(또는 `@Validated`)를 안 붙이면 어노테이션은 장식일 뿐 아무것도 검증하지 않는다.

```java
@PostMapping("/orders")
public OrderResponse create(@Valid @RequestBody CreateOrderRequest req) { ... }
```

## 핵심 요약

- record DTO는 불변·간결하지만 참조 필드는 얕은 불변이다. 깊은 불변은 방어적 복사로.
- 필수 문자열은 `@NotBlank`, 필수 비문자열은 `@NotNull`. `""`을 막고 싶으면 `@NotNull`로는 부족하다.
- 정규화는 컴팩트 생성자에 한 번. 검증은 `@Valid`가 있어야 비로소 동작한다.

> **면접 한 줄:** "`@NotNull`과 `@NotBlank` 차이는?" → "`@NotNull`은 null만 막고 빈/공백 문자열은 통과시킨다. `@NotBlank`는 null·빈 문자열·공백 문자열을 모두 막으며 문자열 전용이다."

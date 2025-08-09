---
title: "엔드포인트마다 요청 DTO를 따로 두는 리팩토링"
date: 2025-08-09 10:30:00 +0900
categories: [Backend]
tags: [request-dto, binding, validation, api-design, refactoring, type-safety]
description: "여러 엔드포인트가 공유하던 거대 파라미터 객체를 엔드포인트별 요청 DTO로 쪼개, 바인딩 범위를 좁히고 과다 게시를 막는 설계."
---

그 주엔 여러 작업이 같은 거대 파라미터 객체를 공유하던 컨트롤러를 손봤다. 한 객체에 필드가 수십 개고, 어떤 필드는 검색에서, 어떤 필드는 등록에서, 또 어떤 필드는 수정에서만 쓰였다. 이렇게 되면 **어떤 필드가 어디서 유효한지 코드만 봐선 알 수 없다.** 핵심 지식은 "엔드포인트별로 요청 DTO를 나눠 바인딩 대상과 검증 범위를 좁히는" API 경계 설계다.

## 공유 파라미터 객체가 흐려놓는 것

거대한 공유 객체에는 세 가지 문제가 얽혀 있다.

**첫째, 바인딩 범위가 너무 넓다.** Spring MVC는 요청 파라미터를 객체 필드에 자동 바인딩한다. 객체에 `role`, `status`, `internalFlag` 같은 필드가 있으면, 사용자가 등록 폼에서 의도적으로 `role=ADMIN` 파라미터를 끼워 보내도 **그대로 바인딩된다.** 이것이 **과다 게시(over-posting / mass assignment)** 취약점이다. 객체가 모든 엔드포인트의 필드를 다 들고 있으니, 모든 엔드포인트가 모든 필드의 바인딩 위험에 노출된다.

**둘째, 검증을 분기할 수 없다.** 등록 시엔 `name`이 필수지만 검색 시엔 선택이다. 한 객체에 `@NotBlank`를 박으면 검색에서도 강제되고, 안 박으면 등록에서 샌다.

**셋째, 의도가 사라진다.** "이 엔드포인트는 무엇을 입력받는가"가 메서드 시그니처에 드러나지 않는다.

## 엔드포인트별 DTO로 쪼갠다

해법은 단순하다. 각 엔드포인트가 **실제로 받는 필드만** 가진 전용 DTO를 정의한다.

```java
// 검색: 모든 필드 선택적
public record ProductSearchRequest(
    String keyword,
    String category,
    @Min(1) int page,
    @Max(100) int size
) {}

// 등록: 필수 검증, 서버 결정 필드 없음
public record ProductCreateRequest(
    @NotBlank String name,
    @NotNull @Positive BigDecimal price,
    String category
) {}

// 수정: 식별자는 경로에서, 본문은 변경 가능한 필드만
public record ProductUpdateRequest(
    @NotBlank String name,
    @NotNull @Positive BigDecimal price
) {}
```

```java
@RestController
@RequestMapping("/products")
public class ProductController {

    @GetMapping
    public Page<ProductView> search(@Valid ProductSearchRequest req) { ... }

    @PostMapping
    public ProductView create(@Valid @RequestBody ProductCreateRequest req) { ... }

    @PutMapping("/{id}")
    public ProductView update(@PathVariable Long id,
                              @Valid @RequestBody ProductUpdateRequest req) { ... }
}
```

핵심은 **DTO에 없는 필드는 애초에 바인딩될 수 없다**는 점이다. `ProductCreateRequest`에 `status`가 없으면, 사용자가 `status=APPROVED`를 보내도 받아줄 그릇이 없어 그냥 무시된다. 바인딩 표면을 줄이는 것이 곧 과다 게시 방어다. 서버가 결정해야 할 값(상태, 소유자, 생성시각)은 DTO에 두지 않고 서비스 계층에서 채운다.

## 같은 모델, 다른 검증 — validation groups와의 차이

"필드는 같은데 검증만 다르다"면 검증 그룹(`@Validated(OnCreate.class)`)으로 한 객체를 재사용할 수도 있다. 하지만 그건 **바인딩 표면은 그대로 넓은 채** 검증만 분기하는 것이라 과다 게시는 못 막는다. 엔드포인트별 DTO 분리는 검증뿐 아니라 **바인딩 가능한 필드 집합 자체를 좁힌다**는 점에서 더 강한 경계다. 보안 측면에서 후자가 우월하다.

## 운영 함정

DTO가 늘어나면 "엔티티로 변환하는 매핑 코드가 폭발한다"는 반론이 나온다. 그래서 DTO를 엔티티로 직접 쓰고 싶은 유혹이 생기는데, 그러면 다시 과다 게시 위험으로 돌아간다. 매핑은 명시적 변환 메서드나 매핑 라이브러리로 한곳에 모으고, **엔티티를 요청 바인딩 대상으로 절대 노출하지 않는다.** 엔티티는 영속 모델이고 DTO는 API 계약이다. 둘이 우연히 같은 필드를 가질 수는 있어도 같은 타입이어선 안 된다.

## 핵심 요약

- 공유 거대 파라미터 객체는 바인딩 표면을 넓혀 과다 게시 위험을 키우고, 검증 분기를 막고, 의도를 흐린다.
- 엔드포인트별 DTO는 받을 필드만 정의해 바인딩 표면 자체를 좁힌다 — 검증 그룹보다 강한 경계다.
- 서버 결정 필드는 DTO에서 빼고 서비스에서 채운다. 엔티티를 바인딩 대상으로 노출하지 않는다.
- Q: "검증 그룹으로 한 객체 재사용하면 되지 않나?" → A: 검증은 분기되지만 바인딩 표면은 그대로 넓다. 과다 게시를 막으려면 필드 집합 자체를 좁히는 DTO 분리가 낫다.

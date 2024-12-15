---
title: "한 필드만 봐선 모르는 검증 규칙 — 클래스 레벨 상호 검증"
date: 2024-12-15 10:30:00 +0900
categories: [Backend]
tags: [validation, cross-field, class-level-constraint, bean-validation, dto, custom-validator]
description: "시작일이 종료일보다 늦으면 안 된다 같은 규칙은 필드 하나만 봐선 못 잡는다. 필드 간 상호 검증을 클래스 레벨 제약으로 구현하고 메시지를 매핑하는 법을 정리한다."
---

## 한 필드로는 판단할 수 없는 규칙

기간이나 조건부 입력을 검증하는 작업을 다룬 주가 있었다. 핵심은 이것이다. **어떤 규칙은 필드 하나만 봐선 판단할 수 없다.** "시작일은 종료일보다 빨라야 한다", "할인율이 0보다 크면 쿠폰 코드가 필수다" 같은 규칙은 두 개 이상의 필드를 함께 봐야 옳고 그름이 정해진다.

`@NotNull`, `@Min`, `@Size` 같은 필드 단위 제약으로는 이를 표현할 수 없다. 이런 규칙을 컨트롤러나 서비스에 `if`문으로 흩뿌리면, 같은 규칙이 여러 곳에 중복되고 어디선가 빠진다. 검증 규칙은 한곳에 선언적으로 모아야 한다.

## 핵심 개념 — 클래스 레벨 제약

Bean Validation은 두 종류의 제약을 지원한다. 필드에 붙는 제약과, **타입(클래스) 전체에 붙는 제약**이다. 후자가 상호 검증의 자리다. 검증 시점에 객체 전체가 검증기에 전달되므로, 여러 필드를 동시에 들여다볼 수 있다.

왜 클래스 레벨이어야 하나. 필드 제약은 그 필드 값 하나만 인자로 받는다. `endDate`를 검증하는 시점에 `startDate`에 접근할 방법이 없다. 반면 클래스 레벨 검증기는 객체 인스턴스 전체(`@interface`로 정의한 제약이 붙은 클래스)를 받으므로 `obj.getStartDate()`와 `obj.getEndDate()`를 함께 비교할 수 있다.

## 코드 예시

먼저 클래스 레벨 커스텀 제약을 정의한다.

```java
@Target(ElementType.TYPE)              // 클래스에 붙는 제약
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = PeriodValidator.class)
public @interface ValidPeriod {
    String message() default "시작일은 종료일보다 빠르거나 같아야 합니다.";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

```java
public class PeriodValidator implements ConstraintValidator<ValidPeriod, ReservationRequest> {
    @Override
    public boolean isValid(ReservationRequest req, ConstraintValidatorContext ctx) {
        if (req.startDate() == null || req.endDate() == null) {
            return true;   // null 여부는 @NotNull이 담당. 여기선 관계만 본다
        }
        boolean valid = !req.startDate().isAfter(req.endDate());
        if (!valid) {
            ctx.disableDefaultConstraintViolation();
            ctx.buildConstraintViolationWithTemplate(ctx.getDefaultConstraintMessageTemplate())
               .addPropertyNode("endDate")   // 에러를 endDate 필드에 매핑
               .addConstraintViolation();
        }
        return valid;
    }
}
```

DTO와 컨트롤러:

```java
@ValidPeriod
public record ReservationRequest(
        @NotNull LocalDate startDate,
        @NotNull LocalDate endDate
) {}

@PostMapping("/reservations")
public ResponseEntity<?> create(@Valid @RequestBody ReservationRequest req) {
    // @Valid가 필드 제약 + 클래스 레벨 제약을 모두 평가한다
}
```

`addPropertyNode`로 에러를 특정 필드에 매핑하면, 프론트엔드가 어느 입력칸에 메시지를 붙일지 알 수 있다.

## 운영 함정

**책임 분리를 어긴 검증기.** 클래스 레벨 검증기 안에서 null 체크까지 다 하려 들면 책임이 뒤섞인다. null/필수 여부는 `@NotNull`에 맡기고, 클래스 레벨 검증기는 **필드 간 관계**만 본다. 위 코드처럼 null이면 `true`를 반환해 관계 검증을 건너뛰는 게 표준이다.

**검증 순서 의존.** 클래스 레벨 제약은 필드 제약과 동시에 평가되며 순서가 보장되지 않는다. "startDate가 null이 아닐 때만 비교"를 검증기 안에서 방어하지 않으면, null 입력에서 NPE가 난다. 검증기는 어떤 입력에도 예외를 던지지 않아야 한다.

## 핵심 요약

- 필드 하나로 판단 못 하는 규칙은 **클래스 레벨 제약**으로 선언한다. 검증기가 객체 전체를 받는다.
- 단일 필드의 null/필수는 필드 제약에, 필드 간 관계는 클래스 레벨에 — 책임을 나눈다.
- `addPropertyNode`로 에러를 특정 필드에 매핑해 UI가 메시지를 붙일 위치를 알게 한다.

> **면접 한 줄**: "시작일<종료일 같은 규칙은 왜 필드 검증으로 안 되나?" → 필드 제약은 그 필드 값 하나만 받기 때문이다. 두 필드를 함께 봐야 하는 규칙은 객체 전체를 받는 클래스 레벨 제약으로 표현한다.

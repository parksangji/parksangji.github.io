---
title: "@Valid 검증: 어디까지 컨트롤러에서 막을까"
date: 2023-02-05 10:30:00 +0900
categories: [Backend]
tags: [validation, bean-validation, valid, binding-result, dto]
description: "형식 검증은 진입부에서 @Valid로, 비즈니스 규칙은 서비스에서. Bean Validation의 동작 원리와 검증 책임 분리, 메시지 표준화를 정리한다."
---

요청 파라미터 검증을 강화하다 보면 늘 같은 질문에 부딪힌다. "이 검증, 컨트롤러에서 막을까 서비스에서 막을까?" 답은 **검증의 성격**에 달렸다. 형식인지 규칙인지에 따라 살아야 할 계층이 다르다.

## Bean Validation은 어떻게 동작하나

`@NotBlank`, `@Size`, `@Email` 같은 제약 애너테이션을 DTO 필드에 붙이고, 컨트롤러 파라미터에 `@Valid`를 붙이면 Spring이 바인딩 직후 검증기를 돌린다. 내부적으로는 `LocalValidatorFactoryBean`이 JSR-380(Hibernate Validator) 구현을 호출해, 각 제약마다 등록된 `ConstraintValidator`로 필드를 검사한다.

```java
public class SignUpRequest {
    @NotBlank @Size(max = 30)
    private String name;

    @NotBlank @Email
    private String email;

    @Min(0) @Max(150)
    private Integer age;
    // getters/setters
}
```

검증 실패 시 동작은 두 갈래다. 파라미터 바로 뒤에 `BindingResult`가 **있으면** 예외 대신 결과에 에러가 담겨 흐름이 이어지고, **없으면** `MethodArgumentNotValidException`이 던져져 전역 핸들러로 간다.

```java
@PostMapping("/users")
public ResponseEntity<?> signUp(@Valid @RequestBody SignUpRequest req,
                                BindingResult binding) {
    if (binding.hasErrors()) {
        return ResponseEntity.badRequest().body(toErrors(binding));
    }
    userService.register(req);
    return ResponseEntity.ok().build();
}
```

## 형식은 진입부, 규칙은 서비스

검증을 두 종류로 나눈다.

- **형식·구문 검증(syntactic)**: 필수값, 길이, 타입, 패턴. 요청 그 자체만 보면 판단 가능. → **컨트롤러 진입부**에서 `@Valid`로 막는다. 잘못된 요청은 DB까지 갈 필요 없이 즉시 400으로 돌린다.
- **비즈니스 규칙 검증(semantic)**: "이메일 중복", "재고 부족", "이미 취소된 주문". DB·다른 상태를 조회해야 판단 가능. → **서비스 계층**에서 처리하고, 위반 시 도메인 예외를 던진다.

```java
@Transactional
public void register(SignUpRequest req) {
    if (userRepository.existsByEmail(req.getEmail())) {
        throw new DuplicateEmailException(req.getEmail()); // 비즈니스 규칙
    }
    userRepository.save(User.from(req));
}
```

이 분리의 이유는 명확하다. 형식 검증을 서비스까지 끌고 가면 불필요한 로직과 자원이 낭비되고, 비즈니스 규칙을 컨트롤러에 두면 트랜잭션·도메인 상태에 접근 못 해 어차피 불완전해진다.

## 메시지 표준화

검증 에러 응답은 클라이언트가 파싱할 수 있게 **일관된 구조**여야 한다. 필드별 에러를 한 형식으로 모아 내려준다.

```java
private List<FieldErrorDto> toErrors(BindingResult b) {
    return b.getFieldErrors().stream()
        .map(e -> new FieldErrorDto(e.getField(), e.getDefaultMessage()))
        .toList();
}
```

전역으로는 `@RestControllerAdvice`에서 `MethodArgumentNotValidException`을 받아 같은 포맷으로 변환하면, 컨트롤러마다 분기를 두지 않아도 된다.

## 운영 함정

- **그룹 검증 누락**: 생성과 수정의 검증 규칙이 다른데 같은 DTO를 쓰면 충돌한다. `@Validated(OnCreate.class)`처럼 검증 그룹으로 분리하거나 DTO를 나눈다.
- **`@Valid` vs `@Validated`**: 메서드 파라미터의 중첩 객체·그룹 검증엔 Spring의 `@Validated`가 필요하다. 단순 `@Valid`만 붙이고 그룹이 안 먹는다고 헤매는 경우가 흔하다.
- **컬렉션·중첩 객체**: 리스트나 중첩 DTO는 `@Valid`를 필드에 한 번 더 붙여야 내부까지 검증된다. 안 붙이면 껍데기만 검사하고 통과한다.

## 핵심 요약

- 형식 검증(필수·길이·패턴)은 컨트롤러 진입부 `@Valid`로 즉시 차단.
- 비즈니스 규칙(중복·재고·상태)은 DB/상태가 필요하므로 서비스 계층에서 도메인 예외로.
- `BindingResult` 유무가 예외 vs 결과 분기를 가른다. 응답 메시지는 전역 핸들러로 표준화한다.

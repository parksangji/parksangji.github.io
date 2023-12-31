---
title: "에러를 하나씩 말고 한꺼번에 돌려주기 — 검증 오류 누적"
date: 2023-12-31 10:30:00 +0900
categories: [Backend]
tags: [validation, error-aggregation, field-errors, ux, binding-result]
description: "첫 오류에서 멈추는 불친절한 폼 검증 대신, 모든 필드 오류를 수집해 필드별 메시지로 한꺼번에 돌려주는 응답 설계를 정리한다."
---

폼 검증 UX를 손보다 보면 한 가지 불만이 늘 나온다. 사용자가 빈칸을 다 채워 제출했는데, 서버는 첫 번째 오류 하나만 던지고 끝낸다. 고치고 다시 제출하면 그제서야 두 번째 오류가 나온다. 핑퐁이 반복된다. 좋은 검증은 **모든 오류를 한 번에** 모아 돌려준다.

## 왜 한꺼번에 모아야 하는가

코드를 단순하게 짜면 검증은 자연스럽게 "fail-fast"가 된다.

```java
if (req.getName() == null) throw new BadRequest("이름 필수");
if (req.getEmail() == null) throw new BadRequest("이메일 필수");
if (req.getAge() < 0)       throw new BadRequest("나이 오류");
```

첫 `throw`에서 메서드가 종료되므로 이후 검증은 실행조차 안 된다. 사용자는 오류를 한 개씩만 본다. 핵심 전환은 **검증과 응답을 분리**하는 것이다. 모든 규칙을 끝까지 돌리며 오류를 **누적**하고, 누적된 게 하나라도 있으면 그제서야 던진다.

```java
List<FieldError> errors = new ArrayList<>();
if (req.getName() == null)  errors.add(new FieldError("name", "이름은 필수입니다"));
if (req.getEmail() == null) errors.add(new FieldError("email", "이메일은 필수입니다"));
if (req.getAge() < 0)       errors.add(new FieldError("age", "나이는 0 이상이어야 합니다"));
if (!errors.isEmpty()) throw new ValidationException(errors);
```

## Bean Validation은 원래 누적이 기본이다

Spring의 Bean Validation(`@Valid`)은 설계부터 오류를 모은다. 한 객체의 모든 제약을 평가한 뒤, 위반들을 `BindingResult`(또는 `ConstraintViolation` 집합)에 담는다. fail-fast는 오히려 옵션이다.

```java
public class SignupRequest {
    @NotBlank(message = "이름은 필수입니다")
    private String name;

    @Email(message = "이메일 형식이 올바르지 않습니다")
    @NotBlank(message = "이메일은 필수입니다")
    private String email;

    @Min(value = 0, message = "나이는 0 이상이어야 합니다")
    private int age;
}
```

컨트롤러에서 `BindingResult`를 받으면 위반 목록 전체에 접근할 수 있다. 이를 **필드별 메시지 맵**으로 정규화해 응답하는 것이 클라이언트가 다루기 가장 쉽다.

```java
@PostMapping("/signup")
public ResponseEntity<?> signup(@Valid @RequestBody SignupRequest req,
                                BindingResult binding) {
    if (binding.hasErrors()) {
        Map<String, String> fieldErrors = binding.getFieldErrors().stream()
            .collect(Collectors.toMap(
                FieldError::getField,
                FieldError::getDefaultMessage,
                (a, b) -> a));   // 한 필드 다중 오류 시 첫 메시지
        return ResponseEntity.badRequest().body(Map.of("errors", fieldErrors));
    }
    // ...
}
```

응답은 `{ "errors": { "name": "...", "email": "..." } }` 형태가 된다. 프론트는 각 입력 칸 옆에 메시지를 그대로 꽂으면 된다.

## 운영 함정

**전역 핸들러로 일관성을 강제하라.** 컨트롤러마다 `BindingResult`를 직접 검사하면 응답 포맷이 제각각이 된다. `@RestControllerAdvice`에서 `MethodArgumentNotValidException`을 잡아 한 곳에서 동일한 구조로 변환하면, 모든 API가 같은 오류 포맷을 갖는다.

**한 필드 다중 위반에 주의하라.** 위 `@Email` + `@NotBlank`처럼 한 필드에 제약이 여럿이면 위반도 여럿 나온다. `toMap`의 병합 함수(`(a,b)->a`)가 없으면 키 충돌로 예외가 난다. 또한 어떤 메시지가 먼저 잡힐지는 보장되지 않으니, 메시지 우선순위가 중요하면 필드별로 정렬·선별하는 로직이 필요하다.

## 면접 한 줄 Q&A

- **Q. fail-fast 검증의 UX 문제는?** 사용자가 오류를 하나씩만 확인하게 되어 제출-수정을 반복하게 된다. 검증을 끝까지 돌려 오류를 누적하고 한 번에 응답해야 한다.
- **Q. 필드별 오류 응답의 표준 포맷은?** `field → message` 맵이 클라이언트가 입력 칸에 매핑하기 가장 쉽고, 전역 예외 핸들러로 모든 API에 일관 적용한다.

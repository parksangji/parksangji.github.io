---
title: "요청 검증(Bean Validation): @Valid, @Validated, 커스텀 제약"
date: 2025-10-16 13:20:00 +0900
series: "Spring Boot"
categories: [Backend, Spring Boot]
tags: [spring-boot, validation, bean-validation, jakarta]
image:
  path: /assets/img/posts/springboot-bean-validation.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnjEzkkDvTHiZR06U4zOhIU8VE7sxyTQiRACSAOpq/LpFzHbeey/JjNUFYqwI6itO4124nsxbNgLjBpO9wM5/vmmGiimgEooopjP/Z"
  alt: Bean Validation 요청 검증
---

## 검증 코드를 if문으로 도배하던 시절

컨트롤러에서 요청을 받으면 "이름은 비었나? 이메일 형식 맞나? 나이는 음수 아닌가?"를 일일이 `if`로 검사했습니다. 검증 로직이 비즈니스 로직과 뒤섞이고, API마다 중복됐죠. **Bean Validation(Jakarta Validation)** 을 쓰면 이걸 애너테이션으로 선언적으로 처리할 수 있습니다.

## 기본 사용법: @Valid + 제약 애너테이션

요청 DTO 필드에 제약을 선언하고, 컨트롤러 파라미터에 `@Valid`를 붙입니다.

```java
public record SignupRequest(
        @NotBlank String name,
        @Email String email,
        @Min(0) @Max(150) int age,
        @Size(min = 8, message = "비밀번호는 8자 이상이어야 합니다") String password
) {}
```

```java
@PostMapping("/users")
public ResponseEntity<Void> signup(@Valid @RequestBody SignupRequest req) {
    userService.signup(req);
    return ResponseEntity.status(HttpStatus.CREATED).build();
}
```

검증에 실패하면 `MethodArgumentNotValidException`이 발생합니다. 이 예외를 [앞서 다룬 @RestControllerAdvice](/posts/springboot-rest-api-exception-handling/)에서 잡아 필드별 메시지로 내려주면 끝입니다.

> 참고: `spring-boot-starter-validation` 의존성이 있어야 동작합니다. (Jakarta 네임스페이스: `jakarta.validation.constraints.*`)
{: .prompt-tip }

## @Valid vs @Validated

- **`@Valid`** (Jakarta 표준): 가장 일반적. `@RequestBody`, 중첩 객체 검증에 사용.
- **`@Validated`** (Spring): **검증 그룹(groups)** 을 지정하거나, 클래스 레벨에 붙여 메서드 파라미터(`@PathVariable`, `@RequestParam`) 검증을 켤 때 사용.

```java
@Validated   // 메서드 레벨 파라미터 검증 활성화
@RestController
public class ProductController {

    @GetMapping("/products")
    public List<Product> list(@RequestParam @Min(1) int page) { ... }
}
```

## 중첩 객체 검증

객체 안의 객체도 검증하려면 필드에 `@Valid`를 붙여야 안쪽까지 내려갑니다.

```java
public record OrderRequest(
        @NotNull @Valid Address address,   // Address 내부 제약까지 검증
        @NotEmpty List<@Valid OrderLine> lines
) {}
```

## 커스텀 제약 만들기

기본 제약으로 부족하면 직접 만들 수 있습니다. 예를 들어 "휴대폰 번호 형식" 제약:

```java
@Target(ElementType.FIELD)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = PhoneValidator.class)
public @interface Phone {
    String message() default "올바른 휴대폰 번호가 아닙니다";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

public class PhoneValidator implements ConstraintValidator<Phone, String> {
    @Override
    public boolean isValid(String value, ConstraintValidatorContext ctx) {
        return value == null || value.matches("01[0-9]-\\d{3,4}-\\d{4}");
    }
}
```

이제 `@Phone String phone`처럼 쓰면 됩니다. (null 허용 여부는 `@NotNull`과 조합으로 결정하는 게 깔끔합니다.)

## 정리

- 검증은 `if` 도배 대신 **Bean Validation 애너테이션**으로 선언적으로.
- `@Valid`(표준, 바디·중첩) vs `@Validated`(그룹, 메서드 파라미터 검증).
- 중첩 객체는 필드에 `@Valid`를 붙여야 안까지 검증된다.
- 부족하면 `ConstraintValidator`로 **커스텀 제약**을 만들자.
- 검증 실패 응답은 전역 예외 핸들러에서 일관되게 처리.

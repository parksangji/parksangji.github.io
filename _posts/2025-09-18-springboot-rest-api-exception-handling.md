---
title: "REST API 예외 처리: @RestControllerAdvice로 일관된 응답 만들기"
date: 2025-09-18 10:00:00 +0900
series: "Spring Boot"
categories: [Backend, Spring Boot]
tags: [spring-boot, rest-api, exception-handling, problemdetail]
image:
  path: /assets/img/posts/springboot-rest-api-exception-handling.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnjEzEkDvTTC3pSmZ1JAPFMeV2HJoRI3ad23vV6XSLmO289l+TGaoBirBh1FadxrtxPZi2bAXGDSd76AZz/fNMNFFNAJRRRTGf/9k="
  alt: REST API 예외 처리
---

## 에러 응답이 제각각이면 클라이언트가 괴롭다

API를 만들다 보면 예외 상황이 끝도 없습니다. 없는 리소스 조회, 검증 실패, 권한 없음… 처음엔 컨트롤러마다 `try-catch`로 막고 그때그때 다른 JSON을 내려줬는데, 프론트엔드 입장에선 **에러 응답 형식이 API마다 달라서** 처리하기가 고역이었습니다. 😵

해법은 **예외 처리를 한 곳으로 모으고, 응답 형식을 통일**하는 것입니다.

## @RestControllerAdvice로 한곳에서 처리

`@RestControllerAdvice` + `@ExceptionHandler`를 쓰면, 컨트롤러 전역에서 발생하는 예외를 한 클래스에서 가로채 처리할 수 있습니다.

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(EntityNotFoundException.class)
    public ResponseEntity<ProblemDetail> handleNotFound(EntityNotFoundException e) {
        ProblemDetail body = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, e.getMessage());
        body.setTitle("Resource Not Found");
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body);
    }
}
```

컨트롤러는 비즈니스 로직에만 집중하고, 예외가 터지면 알아서 이 핸들러로 모입니다.

## ProblemDetail (RFC 7807)

Spring 6 / Spring Boot 3부터는 표준 에러 응답 포맷인 **ProblemDetail(RFC 7807)** 이 기본 지원됩니다. 응답이 표준화돼 있어 클라이언트가 다루기 좋습니다.

```json
{
  "type": "about:blank",
  "title": "Resource Not Found",
  "status": 404,
  "detail": "id=42 인 주문을 찾을 수 없습니다",
  "instance": "/api/orders/42"
}
```

직접 만들지 않아도, `application.yml`에서 켜면 Spring MVC의 기본 예외(404, 405 등)도 ProblemDetail로 내려줍니다.

```yaml
spring:
  mvc:
    problemdetails:
      enabled: true
```

## 검증 실패 응답 다듬기

`@Valid` 검증이 실패하면 `MethodArgumentNotValidException`이 발생합니다. 이걸 잡아서 **어떤 필드가 왜 틀렸는지** 친절하게 내려주면 프론트가 폼 에러를 표시하기 쉬워집니다.

```java
@ExceptionHandler(MethodArgumentNotValidException.class)
public ResponseEntity<ProblemDetail> handleValidation(MethodArgumentNotValidException e) {
    ProblemDetail body = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
    body.setTitle("Validation Failed");
    Map<String, String> errors = new HashMap<>();
    e.getBindingResult().getFieldErrors()
        .forEach(fe -> errors.put(fe.getField(), fe.getDefaultMessage()));
    body.setProperty("errors", errors);
    return ResponseEntity.badRequest().body(body);
}
```

## 주의점

- **예외를 삼키지 말자.** 로그도 안 남기고 `catch (Exception e) {}` 하면 장애를 못 잡습니다. 핸들러에서 적절히 로깅하세요.
- **내부 정보 노출 주의.** 스택 트레이스나 SQL 에러 원문을 그대로 `detail`에 담으면 보안 위험입니다. 사용자에겐 일반화된 메시지를, 로그엔 상세를.
- 마지막 안전망으로 `@ExceptionHandler(Exception.class)`를 두되 500으로 처리하고 상세는 로그로만.

## 정리

- 예외 처리는 컨트롤러마다 흩지 말고 **`@RestControllerAdvice`로 집중**.
- 응답 포맷은 **`ProblemDetail`(RFC 7807)** 로 표준화.
- 검증 실패는 필드별 메시지로 친절하게.
- 예외를 삼키지 말고, 내부 정보는 노출하지 말 것.

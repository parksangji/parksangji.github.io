---
title: "에러를 분류해 코드로 말하게 하기"
date: 2024-05-26 10:30:00 +0900
categories: [Backend]
tags: [error-code, api, contract, i18n, client-handling]
description: "메시지 문자열에 의존한 에러 처리의 취약함, 그리고 도메인 에러 코드 카탈로그로 클라이언트 분기와 다국어를 안정화하는 설계."
---

API 에러 응답을 체계화한 적이 있다. 처음엔 사람이 읽을 메시지만 내려주면 충분해 보이지만, 클라이언트가 그 에러에 따라 *다르게 동작*해야 하는 순간 문자열은 무너진다. 에러는 사람의 말이 아니라 **기계가 분기할 코드**로 말해야 한다.

## 메시지 의존이 깨지는 이유

이런 응답을 생각해 보자.

```json
{ "message": "이미 사용 중인 이메일입니다." }
```

클라이언트가 "이메일 중복일 때 로그인 화면으로 보내기"를 구현하려면 이 문자열을 비교하는 수밖에 없다. 그 순간 다음이 전부 깨진다.

- 메시지를 **다국어로 번역**하거나 카피를 다듬으면 비교가 어긋난다.
- 오타 수정 한 번에 클라이언트 분기가 죽는다.
- 같은 의미의 에러가 여러 화면에서 미묘하게 다른 문구로 나간다.

문자열은 **사람을 위한 표현**이고, 표현은 자주 바뀐다. 자주 바뀌는 걸 계약(contract)으로 삼으면 안 된다.

## 에러 코드 카탈로그

해법은 **불변의 기계용 식별자(에러 코드)와 가변의 사람용 메시지를 분리**하는 것이다. 코드는 계약이라 안 바뀌고, 메시지는 자유롭게 바뀐다.

```json
{
  "code": "USER_EMAIL_DUPLICATED",
  "message": "이미 사용 중인 이메일입니다.",
  "status": 409
}
```

코드를 한곳에 모아 카탈로그로 관리한다. enum이 자연스럽다.

```java
public enum ErrorCode {
    USER_NOT_FOUND      (HttpStatus.NOT_FOUND,  "user.not_found"),
    USER_EMAIL_DUPLICATED(HttpStatus.CONFLICT,  "user.email_duplicated"),
    ORDER_ALREADY_PAID  (HttpStatus.CONFLICT,   "order.already_paid"),
    VALIDATION_FAILED   (HttpStatus.BAD_REQUEST,"common.validation");

    private final HttpStatus status;
    private final String messageKey;   // i18n 메시지 번들 키
    ErrorCode(HttpStatus s, String k) { this.status = s; this.messageKey = k; }
    public HttpStatus status()     { return status; }
    public String messageKey()     { return messageKey; }
}
```

```java
@ExceptionHandler(DomainException.class)
public ResponseEntity<ErrorResponse> handle(DomainException e, Locale locale) {
    ErrorCode ec = e.getErrorCode();
    String msg = messageSource.getMessage(ec.messageKey(), e.args(), locale);
    return ResponseEntity.status(ec.status())
            .body(new ErrorResponse(ec.name(), msg, ec.status().value()));
}
```

메시지는 i18n 번들에서 로케일별로 꺼낸다. 코드(`USER_EMAIL_DUPLICATED`)는 영어든 한국어든 동일하므로 클라이언트는 **코드로만 분기**하면 된다.

```javascript
// 클라이언트: 코드로 분기, 메시지는 그대로 표시
switch (err.code) {
  case "USER_EMAIL_DUPLICATED": goToLogin(); break;
  case "VALIDATION_FAILED":     highlightFields(err.fields); break;
  default:                       toast(err.message);
}
```

## 운영 함정

**HTTP 상태 코드만으로는 부족하다.** `409 Conflict` 하나에 "이메일 중복", "이미 결제됨", "동시 수정 충돌"이 전부 섞인다. 상태 코드는 거친 분류고, 세밀한 분기는 도메인 코드가 맡는다. 둘은 보완 관계다.

**코드를 한 번 공개하면 그 자체가 계약이다.** 의미를 바꾸거나 이름을 재활용하면 구버전 클라이언트가 오작동한다. 코드는 **추가만 하고 의미를 보존**한다. 폐기할 땐 새 코드를 발급한다.

## 핵심 요약

- 메시지 문자열은 표현이라 자주 바뀐다 — 계약으로 삼지 말 것.
- 불변의 에러 코드(기계용)와 가변 메시지(i18n, 사람용)를 분리한다.
- HTTP 상태는 거친 분류, 도메인 코드는 세밀한 분기. 코드는 추가만 하고 의미를 보존한다.

---
title: "200으로 에러를 숨기지 마라: 상태코드의 의미"
date: 2024-07-21 10:30:00 +0900
categories: [Network]
tags: [http, status-code, error, rest, semantics]
description: "클라이언트 잘못은 4xx, 서버 잘못은 5xx로 구분하는 HTTP 상태코드 의미론과, 모든 응답을 200에 담는 안티패턴의 비용을 설명한다."
---

API 응답 규격을 정리하던 주였다. 가장 먼저 부딪힌 건 "에러를 어떻게 표현할 것인가"였다. 흔한 안티패턴 하나는 **모든 응답을 200 OK로 내리고 body의 `success: false`로 에러를 표현하는 것**이다. 편해 보이지만 HTTP가 제공하는 의미론을 통째로 버리는 선택이다.

## 상태코드는 응답의 분류 체계다

HTTP 상태코드는 응답을 **누구의 책임인지**로 분류하는 표준 체계다. 첫 자리가 부류를 결정한다.

- **2xx 성공** — 요청이 정상 처리됐다. 200(OK), 201(Created, 생성), 204(No Content, 본문 없는 성공).
- **3xx 리다이렉션** — 추가 동작이 필요하다. 301/302(이동), 304(Not Modified, 캐시 유효).
- **4xx 클라이언트 오류** — 요청이 잘못됐다. 책임은 클라이언트에 있고, 같은 요청을 그대로 재시도해도 똑같이 실패한다.
- **5xx 서버 오류** — 서버가 처리에 실패했다. 책임은 서버에 있고, 잠시 후 재시도하면 성공할 수 있다.

이 분류가 중요한 이유는 **수많은 인프라가 상태코드만 보고 동작하기 때문**이다. 로드밸런서의 헬스체크, 모니터링의 에러율 집계, 클라이언트 HTTP 라이브러리의 재시도 정책, 캐시·프록시 모두 상태코드로 판단한다. 모든 응답을 200으로 내리면 이 계층들이 전부 "정상"으로 본다. 서버 장애로 5xx가 쏟아져야 할 상황에서도 알람이 안 울린다.

## 자주 쓰는 4xx/5xx 구분

같은 4xx 안에서도 의미가 다르다.

- **400 Bad Request** — 요청 형식·검증 실패(필수값 누락, 타입 오류).
- **401 Unauthorized** — 인증 안 됨(로그인 필요). 이름과 달리 "인증"이다.
- **403 Forbidden** — 인증은 됐으나 **권한** 없음.
- **404 Not Found** — 리소스 없음.
- **409 Conflict** — 상태 충돌(중복 생성, 동시 수정 충돌).
- **422 Unprocessable Entity** — 형식은 맞지만 의미상 처리 불가.

5xx는 500(서버 내부 오류), 502(게이트웨이 오류), 503(일시적 과부하·점검), 504(업스트림 타임아웃)를 구분해 쓴다.

## 코드와 일관성

상태코드를 제대로 쓰되, body에는 **기계가 분기할 코드와 사람이 읽을 메시지**를 일관된 스키마로 담는다.

```java
@ExceptionHandler(EntityNotFoundException.class)
public ResponseEntity<ApiError> handleNotFound(EntityNotFoundException e) {
    var body = new ApiError("USER_NOT_FOUND", e.getMessage());
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body); // 404
}

@ExceptionHandler(MethodArgumentNotValidException.class)
public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException e) {
    var body = new ApiError("VALIDATION_FAILED", "필수값을 확인하세요");
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body); // 400
}
```

핵심은 **상태코드와 body 코드를 어긋나지 않게** 두는 것이다. 상태는 200인데 body는 에러, 같은 모순을 만들지 않는다.

## 운영 함정

**함정 1 — 모든 예외를 500으로 뭉뚱그리기.** 검증 실패(클라이언트 잘못)까지 500으로 내리면 서버 에러율이 부풀고, 진짜 장애가 노이즈에 묻힌다. 검증·권한 실패는 4xx로 정확히 분류한다.

**함정 2 — 404를 200으로 내리기.** "데이터가 없으면 빈 객체에 200"으로 처리하면 클라이언트가 존재/부재를 구분 못 한다. 단건 조회 실패는 404, 컬렉션 조회 결과 0건은 200에 빈 배열로 구분한다.

## 핵심 요약

- 4xx는 클라이언트 책임, 5xx는 서버 책임. 인프라가 이 분류로 동작한다.
- 모든 응답을 200으로 내리면 헬스체크·모니터링·재시도가 전부 무력화된다.
- 상태코드(부류)와 body 에러코드(세부)를 어긋남 없이 일관되게 둔다.

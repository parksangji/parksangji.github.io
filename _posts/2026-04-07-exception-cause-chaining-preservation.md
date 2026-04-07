---
title: "예외를 다시 던지면서 원인을 잃어버리는 실수 — cause 체이닝 보존"
date: 2026-04-07 10:30:00 +0900
categories: [Java]
tags: [exception-chaining, cause, stacktrace, wrapping, third-party-sdk, diagnostics]
description: "하위 예외를 도메인 예외로 감싸 다시 던질 때 원래 예외를 cause로 전달해 근본 원인 스택트레이스를 보존하는 원칙."
---

그 주엔 외부 클라이언트 모듈에서 던지는 하위 예외를 잡아 우리 도메인 예외로 바꿔 던지는 코드를 다뤘다. 의도는 옳다. 외부 라이브러리의 예외 타입이 도메인 코드까지 새어 나가지 않게 경계에서 우리 예외로 변환하는 것. 그런데 변환 과정에서 흔히 **원래 예외를 버린다.** 그 순간 "진짜 무엇이 잘못됐는지"를 담은 스택트레이스가 통째로 사라진다. 로그에는 우리 도메인 예외만 남고, 근본 원인은 영영 알 수 없게 된다.

## 두 줄의 차이가 디버깅을 가른다

```java
try {
    thirdPartyClient.call();
} catch (ThirdPartyException e) {
    // 안티패턴: 원래 예외를 버린다
    throw new DomainException("외부 호출 실패");
}
```

vs

```java
try {
    thirdPartyClient.call();
} catch (ThirdPartyException e) {
    // 올바름: 원래 예외를 cause로 전달
    throw new DomainException("외부 호출 실패", e);
}
```

차이는 생성자 두 번째 인자 `e` 하나다. 하지만 결과는 완전히 다르다.

## getCause 체인과 "Caused by:"

`Throwable`은 내부에 `cause` 필드를 가진다. 생성자에 `cause`를 넘기면 `getCause()`로 원래 예외를 따라갈 수 있는 **체인**이 만들어진다. JVM이 스택트레이스를 출력할 때 이 체인을 따라가며 `Caused by:` 절을 이어 붙인다.

cause를 넘긴 경우:

```
com.example.DomainException: 외부 호출 실패
    at com.example.OrderService.place(OrderService.java:42)
    ...
Caused by: com.thirdparty.ThirdPartyException: connection reset
    at com.thirdparty.Client.call(Client.java:88)   <-- 진짜 원인이 보인다
    ...
```

cause를 버린 경우:

```
com.example.DomainException: 외부 호출 실패
    at com.example.OrderService.place(OrderService.java:42)
    ...
```

두 번째는 "외부 호출이 실패했다"만 알려준다. **연결이 끊겼는지, 타임아웃인지, 인증 실패인지** — 행동을 결정짓는 정보가 전부 사라졌다. 운영 장애에서 이 차이가 원인 파악 5분과 5시간을 가른다.

## 도메인 예외는 cause를 받도록 설계한다

도메인 예외 클래스는 처음부터 `cause`를 받는 생성자를 갖춰야 한다. `RuntimeException`의 생성자에 그대로 위임하면 된다.

```java
public class DomainException extends RuntimeException {
    public DomainException(String message) {
        super(message);
    }
    // cause를 받는 생성자를 반드시 둔다
    public DomainException(String message, Throwable cause) {
        super(message, cause);   // super가 cause 필드를 세팅한다
    }
}
```

`super(message, cause)`가 핵심이다. `super(message)`만 호출하고 `this.cause = cause` 같은 처리를 잊으면, 인자로 받아도 체인은 안 만들어진다. 표준 생성자에 위임하는 게 가장 안전하다.

## cause 전달을 단위 테스트로 못 박는다

cause 누락은 컴파일러가 잡아주지 못한다. 그래서 "원래 예외가 cause로 전달되는가"를 테스트로 검증해 회귀를 막는다.

```java
@Test
void wraps_thirdparty_exception_preserving_cause() {
    ThirdPartyException original = new ThirdPartyException("connection reset");
    // given: 외부 클라이언트가 예외를 던지도록 구성
    when(client.call()).thenThrow(original);

    DomainException thrown = assertThrows(
        DomainException.class, () -> service.place());

    // then: cause 체인이 원래 예외를 가리킨다
    assertThat(thrown.getCause()).isSameAs(original);
}
```

`getCause()`가 원래 인스턴스를 가리키는지를 단언한다. 누군가 나중에 cause 인자를 떨어뜨리면 이 테스트가 즉시 실패한다.

## 운영 함정

- **로그 시그니처를 헷갈리지 마라.** `log.error("실패: " + e)`는 cause 체인을 출력하지 않는다. `log.error("실패", e)`처럼 `Throwable`을 **마지막 인자**로 넘겨야 SLF4J가 전체 스택트레이스(`Caused by:` 포함)를 찍는다. 문자열 연결로 합치면 메시지 한 줄만 남는다.
- **메시지에 원인을 손으로 베껴 넣지 마라.** `new DomainException("실패: " + e.getMessage())`는 메시지 문자열만 복사할 뿐 스택트레이스는 잃는다. cause는 객체로 넘겨야 한다 — 문자열로 요약하면 의미가 없다.

## 핵심 요약

- 예외를 감싸 다시 던질 때 **원래 예외를 생성자 두 번째 인자(`cause`)로 전달**해야 근본 원인 스택트레이스가 보존된다.
- 도메인 예외는 `cause`를 받는 생성자를 갖추고, cause 전달을 **단위 테스트로 못 박는다**.
- **면접 Q.** `throw new DomainException(msg)`와 `throw new DomainException(msg, e)`의 차이는? **A.** 후자는 `getCause()` 체인을 만들어 로그에 `Caused by:`로 근본 원인을 남긴다. 전자는 원인 스택트레이스를 통째로 버린다.

---
title: "외부 연동 설정값이 비어 있을 때 — null 안전 기본값과 생성자 방어"
date: 2025-11-04 10:30:00 +0900
categories: [Backend]
tags: [config-binding, default-value, null-safety, constructor-validation, external-api, fail-fast]
description: "설정 바인딩 객체의 누락 필드를 기본값으로 메우거나 생성 시점에 검증해 불완전 상태를 경계에서 막는 패턴."
---

그 주엔 외부 연동에 필요한 설정값(엔드포인트, 타임아웃, 재시도 횟수 등)을 코드 밖 설정 파일에서 읽어 객체로 바인딩하는 작업을 다뤘다. 여기서 반복적으로 사고가 나는 지점이 있다. **설정이 비어 있을 때**다. 운영 환경마다 설정 키가 빠지거나, 오타로 바인딩이 안 되거나, 빈 문자열이 들어온다. 그러면 객체는 만들어지지만 일부 필드가 `null`인 **불완전 상태**가 된다. 이 객체가 한참 흘러가다 호출 시점에 NPE로 터진다. 진짜 원인(설정 누락)에서 한참 떨어진 곳에서.

## 불완전 상태를 경계에서 막는다

설정을 코드 밖으로 빼는 것과, **바인딩된 객체가 완전한 상태인지 보장**하는 것은 다른 문제다. 후자가 이 글의 핵심이다. 객체가 생성되는 **경계(생성자)** 에서 두 가지 중 하나를 한다.

1. **기본값으로 메운다** — 누락돼도 합리적 기본값이 있는 선택적 필드(타임아웃, 재시도 횟수).
2. **즉시 실패시킨다(fail-fast)** — 기본값이 있을 수 없는 필수 필드(엔드포인트, 인증 자격).

조용한 `null`을 흘려보내는 대신, "어느 필드가 비었는지"를 생성 시점에 드러낸다.

## 바인딩 후 기본값 채움 + 생성자 검증

스프링 계열의 설정 바인딩은 보통 setter 또는 생성자 바인딩으로 들어온다. 바인딩 직후가 방어 지점이다.

```java
@ConfigurationProperties(prefix = "external.api")
public class ExternalApiProperties {

    private final String endpoint;
    private final int connectTimeoutMs;
    private final int maxRetries;

    // 생성자 바인딩: 누락 필드는 여기서 메우거나 막는다
    public ExternalApiProperties(String endpoint,
                                 Integer connectTimeoutMs,
                                 Integer maxRetries) {
        // 1) 필수값 — 없으면 즉시 실패 (fail-fast)
        if (endpoint == null || endpoint.isBlank()) {
            throw new IllegalStateException(
                "external.api.endpoint 설정이 비어 있다");
        }
        this.endpoint = endpoint;

        // 2) 선택값 — null이면 기본값으로 메운다
        this.connectTimeoutMs = (connectTimeoutMs != null) ? connectTimeoutMs : 3000;
        this.maxRetries       = (maxRetries != null)       ? maxRetries       : 2;

        // 3) 의미 검증 — 값이 있어도 무의미하면 막는다
        if (this.maxRetries < 0) {
            throw new IllegalStateException("maxRetries는 음수일 수 없다");
        }
    }
    // getter 생략
}
```

핵심은 `Integer`(박싱 타입)로 받는 점이다. `int`로 받으면 바인딩 실패 시 기본값 `0`이 자동으로 들어가 "사용자가 0으로 설정한 것"과 "설정이 누락된 것"을 구분할 수 없다. `Integer`로 받아 `null` 여부로 누락을 판별한 뒤, 우리가 정한 기본값을 명시적으로 넣는다.

## 불변 객체 vs 기본값 채움의 트레이드오프

위처럼 생성자에서 모든 검증·기본값 채움을 끝내면 객체는 **불변(immutable)** 이 되고, 생성 직후부터 항상 완전한 상태가 보장된다. 이후 어떤 코드도 이 객체를 반쯤 비워진 상태로 만들 수 없다.

반면 setter 바인딩 + `@PostConstruct` 검증 방식은 유연하지만, **바인딩 완료와 검증 사이의 짧은 창**에서 객체가 불완전 상태로 존재한다. 그 사이 다른 빈이 참조하면 여전히 사고가 난다. 가능하면 생성자에서 모든 것을 끝내 불변으로 만드는 쪽이 안전하다.

```java
// 안티패턴: setter 바인딩 — 검증 전까지 불완전 상태가 노출된다
public class LooseProperties {
    private String endpoint;   // 바인딩 직후 여전히 null일 수 있다
    public void setEndpoint(String e) { this.endpoint = e; }
    @PostConstruct
    void validate() { /* 너무 늦을 수 있다 */ }
}
```

## 운영 함정

- **빈 문자열은 `null`이 아니다.** 설정 파일에서 키는 있는데 값이 비면 `""`가 바인딩된다. `null` 체크만 하면 통과해버린다. 반드시 `isBlank()`로 함께 막는다.
- **기본값을 검증 안에 숨기지 마라.** 기본값 `3000ms`가 코드 깊숙이 박혀 있으면 운영자가 "왜 타임아웃이 3초지?"를 추적하기 어렵다. 설정 문서나 상수에 기본값을 명시해 두고, 채워질 때 로그로 한 줄 남겨 추적 가능하게 한다.

## 핵심 요약

- 설정 바인딩 객체의 **불완전 상태**를 생성 경계에서 막는다: 선택값은 기본값으로 메우고, 필수값은 fail-fast.
- 누락과 "사용자가 0/빈 값을 지정한 것"을 구분하려면 박싱 타입(`Integer`)으로 받아 `null` 여부로 판별한다.
- **면접 Q.** 설정값 누락을 NPE 대신 일찍 잡으려면? **A.** 생성자에서 필수값을 검증해 즉시 실패시키고, 선택값은 명시적 기본값으로 채워 불변 객체로 만든다. 객체가 항상 완전한 상태로만 존재하도록 보장한다.

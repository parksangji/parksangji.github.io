---
title: "Spring Boot 4 · Spring Framework 7, 무엇이 바뀌었나"
date: 2025-11-06 10:00:00 +0900
categories: [Backend, Spring Boot]
tags: [spring-boot, spring-framework, spring-boot-4, jspecify]
image:
  path: /assets/img/posts/springboot4-spring-framework7-whats-new.svg
  alt: Spring Boot 4와 Spring Framework 7의 새로운 점
---

## 메이저 버전이 올라갔다

2025년 11월, **Spring Boot 4.0**과 그 기반인 **Spring Framework 7.0**이 GA로 나왔습니다(이 글을 쓰는 시점의 최신은 Boot 4.1 / Framework 7.0.8). 메이저 버전 점프인 만큼 바뀐 게 많아서, 이번 글에서 큰 그림을 잡고 세부 주제는 이어지는 글들에서 하나씩 다루겠습니다.

## 베이스라인: Java 17, 그리고 Java 25

- **최소 Java 17** (Boot 3과 동일선상에서 올라옴)
- **Java 25 first-class 지원** — 가상 스레드 등 최신 런타임 기능을 정식으로 활용
- **Jakarta EE 11** 채택 (Servlet 6.1, JPA 3.2, Bean Validation 3.1)

## 1. JSpecify 기반 널 안전성

Spring 7은 **JSpecify** 애너테이션으로 컴파일 타임 널 안전성을 1급으로 지원합니다. 패키지에 `@NullMarked`를 선언하면 그 안의 타입은 **기본적으로 non-null**이 되고, 예외적으로 null이 가능한 곳에만 `@Nullable`을 붙입니다.

```java
// package-info.java
@NullMarked
package com.example.demo;

import org.jspecify.annotations.NullMarked;
```

IDE·빌드 도구가 이 정보를 읽어 런타임 NPE를 컴파일 단계에서 잡아줍니다. (기존 Spring 자체 `@Nullable`/`@NonNull`을 JSpecify로 정리)

## 2. HTTP API 버저닝 (내장)

그동안 직접 구현하던 API 버저닝이 프레임워크 기본 기능이 됐습니다. `@GetMapping(..., version = "1")`처럼 선언할 수 있습니다. → [별도 글에서 자세히](/posts/springboot-api-versioning/)

## 3. 선언적 HTTP 클라이언트 강화

`@HttpExchange` 인터페이스 + `@ImportHttpServices`로 Feign처럼 **인터페이스만 정의하면 HTTP 클라이언트가 생성**됩니다. 기본 구현은 `RestClient`. → [별도 글에서 자세히](/posts/springboot-declarative-http-client/)

## 4. 코어에 들어온 회복탄력성(Resilience)

`@Retryable`, `RetryTemplate`, `@ConcurrencyLimit` 같은 재시도·동시성 제한 기능이 **별도 라이브러리 없이** 코어에 포함됐습니다.

```java
@Retryable(maxAttempts = 3)
public PaymentResult pay(Order order) { ... }
```

## 5. 프로그래밍 방식 Bean 등록

`BeanRegistrar` 계약으로 Bean을 코드로 유연하게 등록할 수 있게 됐습니다. 조건부·동적 Bean 구성에 유용합니다.

## 6. 모듈화

거대했던 `spring-boot-autoconfigure` 등이 **기능별 작은 모듈(jar)** 로 분리됐습니다. 필요한 것만 가져와 더 가볍고 경계가 명확해졌습니다. (대부분 Starter가 흡수하므로 체감 변화는 적음)

## 업그레이드 시 유의점

- Java 17+ 필수, 가능하면 21/25 권장(가상 스레드 등).
- `javax.*` → `jakarta.*` 는 이미 Boot 3에서 끝났어야 할 작업.
- 의존성 버전은 BOM(`spring-boot-dependencies`)을 따르되, 서드파티 호환 버전 확인.
- 마이그레이션은 항상 **테스트를 든든히 갖춘 상태**에서.

## 정리

- Boot 4 / Framework 7 = Java 17+ 베이스, Jakarta EE 11.
- 핵심 키워드: **JSpecify 널 안전성, API 버저닝, 선언적 HTTP 클라이언트, 코어 회복탄력성, BeanRegistrar, 모듈화**.
- 다음 글들에서 가상 스레드·선언적 클라이언트·API 버저닝·Observability·네이티브 이미지를 하나씩 깊게 다룹니다.

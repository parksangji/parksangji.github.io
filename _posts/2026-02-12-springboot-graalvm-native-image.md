---
title: "GraalVM 네이티브 이미지와 AOT"
date: 2026-02-12 13:40:00 +0900
categories: [Backend, Spring Boot]
tags: [spring-boot, graalvm, native-image, aot]
image:
  path: /assets/img/posts/springboot-graalvm-native-image.svg
  alt: GraalVM 네이티브 이미지와 AOT
---

## 서버리스에서 JVM 시작이 너무 느리다

JVM 앱은 시작할 때 클래스 로딩·JIT 워밍업 때문에 수 초가 걸립니다. 평소엔 괜찮지만, **서버리스(짧게 떴다 사라짐)** 나 **빠른 오토스케일링**, **CLI 도구**에선 이 시작 지연과 메모리 사용량이 부담입니다. 이때 답이 **GraalVM 네이티브 이미지**입니다.

## 네이티브 이미지란

GraalVM이 애플리케이션을 **사전 컴파일(AOT, Ahead-Of-Time)** 해서 OS 네이티브 실행 파일로 만든 것입니다. JVM 없이 바로 실행되고:

- **시작 시간**: 수 초 → **수십 밀리초**
- **메모리**: 대폭 감소
- 단, **빌드 시간이 길고**, 빌드 후 동작은 JIT의 피크 성능엔 못 미칠 수 있습니다.

## Spring AOT

문제는 Spring이 런타임 리플렉션·동적 프록시를 많이 쓴다는 점입니다. 네이티브 이미지는 빌드 시점에 "무엇이 쓰일지"를 알아야 하므로, Spring은 **Spring AOT** 처리를 통해 빌드 타임에 Bean 정의·프록시·리플렉션 힌트를 미리 생성합니다.

## 빌드하기

`spring-boot-starter`와 네이티브 빌드 도구만 있으면 됩니다.

```bash
# GraalVM로 직접 컴파일 (Gradle)
./gradlew nativeCompile

# 또는 Buildpacks로 컨테이너 이미지 생성 (GraalVM 설치 불필요)
./gradlew bootBuildImage
```

생성된 바이너리는 `build/native/nativeCompile/`에 떨어지고, 실행하면 거의 즉시 뜹니다.

```bash
./build/native/nativeCompile/demo
# Started DemoApplication in 0.05 seconds
```

## 리플렉션 힌트

라이브러리가 리플렉션으로 접근하는 클래스는 AOT가 자동으로 못 잡을 수 있습니다. 그럴 땐 힌트를 직접 등록합니다.

```java
@Configuration
@RegisterReflectionForBinding(ExternalDto.class)
public class NativeHintsConfig { }
```

더 복잡하면 `RuntimeHintsRegistrar`를 구현해 리플렉션/리소스/프록시 힌트를 명시합니다.

## 트레이드오프 — 언제 쓸까

| 장점 | 단점 |
|------|------|
| 매우 빠른 시작, 적은 메모리 | 빌드 시간이 길다 (수 분~) |
| 즉시 스케일링/서버리스 적합 | 리플렉션 힌트 등 추가 작업 |
| 작은 컨테이너 이미지 | 장시간 고부하의 피크 처리량은 JIT만 못할 수 있음 |

**서버리스·짧은 수명·CLI·빠른 스케일**이면 네이티브가 유리하고, **장시간 고처리량 서버**라면 기존 JVM(+가상 스레드)이 여전히 좋은 선택입니다.

## 정리

- 네이티브 이미지 = GraalVM AOT 컴파일로 만든 OS 실행 파일. **시작 빠름·메모리 적음**.
- Spring은 **Spring AOT**로 리플렉션·프록시를 빌드 타임에 준비.
- `nativeCompile` 또는 `bootBuildImage`로 빌드, 필요 시 **리플렉션 힌트** 추가.
- 서버리스/CLI엔 강력하지만, 빌드 비용·피크 성능 트레이드오프를 고려해 선택.

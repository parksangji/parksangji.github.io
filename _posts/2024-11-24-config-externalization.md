---
title: "설정값을 코드에 박지 마라 — 프로파일과 비밀 분리"
date: 2024-11-24 10:30:00 +0900
categories: [Infra]
tags: [configuration, externalize, spring-profile, secret-management, environment, twelve-factor]
description: "DB 주소, API 키, 타임아웃을 코드에 하드코딩하면 환경마다 빌드가 달라진다. 설정 외부화, 프로파일 분리, 비밀값 관리의 원리와 우선순위를 정리한다."
---

## 한 번 빌드해서 어디든 배포한다

환경별 설정을 정리한 주가 있었다. 핵심은 **같은 빌드 산출물을 개발/스테이징/운영 어디에 올려도 동작해야 한다**는 것이다. 환경에 따라 달라지는 값(DB 주소, 외부 API 키, 타임아웃, 기능 토글)을 코드 안에 박으면, 환경마다 다시 빌드해야 하고 그 순간 "테스트한 산출물"과 "배포한 산출물"이 달라진다.

이건 12-Factor App의 세 번째 원칙, "설정을 환경에 저장하라"의 핵심이다. 코드는 환경과 무관해야 하고, 환경 차이는 **외부에서 주입**되어야 한다.

## 핵심 개념 — 설정의 우선순위와 프로파일

Spring Boot는 여러 출처에서 설정을 읽고, 정해진 우선순위로 덮어쓴다. 대략 (높음→낮음):

1. 커맨드라인 인자 (`--server.port=9090`)
2. OS 환경변수 (`SERVER_PORT=9090`)
3. 외부 `application-{profile}.yml`
4. 패키지 내부 `application.yml`

이 우선순위 덕분에 **공통 기본값은 jar 안에 두고, 환경 고유값은 환경변수나 외부 파일로 덮어쓴다**는 전략이 성립한다. 프로파일(`spring.profiles.active`)은 이 분기를 깔끔하게 만든다.

```yaml
# application.yml (공통 기본값)
app:
  page-size: 20
  external-api:
    timeout-ms: 3000

---
spring:
  config.activate.on-profile: prod
app:
  external-api:
    base-url: https://api.example.com
```

왜 환경변수가 강력한가. 컨테이너 오케스트레이터, CI, 시크릿 매니저 등 거의 모든 배포 도구가 환경변수 주입을 1급으로 지원한다. 키 이름은 `app.external-api.timeout-ms` → `APP_EXTERNALAPI_TIMEOUTMS`처럼 relaxed binding으로 자동 매핑된다.

## 코드 예시 — 타입 안전한 바인딩

설정을 `@Value`로 흩뿌리는 대신 `@ConfigurationProperties`로 묶으면, 타입 검증과 IDE 자동완성이 붙는다.

```java
@ConfigurationProperties(prefix = "app.external-api")
@Validated
public record ExternalApiProperties(
        @NotBlank String baseUrl,
        @Min(100) int timeoutMs
) {}
```

```java
@Service
public class PaymentClient {
    private final ExternalApiProperties props;

    public PaymentClient(ExternalApiProperties props) {
        this.props = props;   // 코드 어디에도 URL/타임아웃 상수가 없다
    }
}
```

`@Validated`가 붙으면 잘못된 설정으로 뜬 애플리케이션은 **시작 시점에** 실패한다. 런타임 한참 뒤에 NPE로 터지는 것보다 훨씬 낫다.

## 운영 함정

**비밀값을 yml에 평문으로 커밋한다.** DB 비밀번호, API 키 같은 secret은 일반 설정과 분리해야 한다. git 히스토리에 한 번 올라간 비밀은 영원히 남는다. 비밀은 환경변수나 전용 시크릿 매니저(Vault, 클라우드 KMS 기반 시크릿 서비스)로 주입하고, 설정 파일에는 절대 넣지 않는다. 실수로 커밋되었다면 파일 삭제만으로 끝나지 않으며 **반드시 키를 폐기·재발급**해야 한다.

**프로파일 미지정으로 운영에 default가 뜬다.** `spring.profiles.active`를 배포 환경에서 강제하지 않으면, 실수로 개발 설정으로 운영 서버가 뜬다. 운영 컨테이너에는 환경변수로 활성 프로파일을 반드시 못박는다.

## 핵심 요약

- 환경에 따라 달라지는 값은 코드가 아니라 **환경에서 주입**한다. 한 번 빌드, 어디든 배포.
- 설정 우선순위(커맨드라인 > 환경변수 > 외부파일 > 내부파일)를 알면 덮어쓰기 전략이 명확해진다.
- 비밀값은 일반 설정과 분리하고, 절대 저장소에 커밋하지 않는다.

> **면접 한 줄**: "왜 설정을 외부화하나?" → 같은 산출물을 모든 환경에 배포하기 위해서다. 환경 차이를 코드에서 제거해야 테스트한 것과 배포한 것이 동일해진다.

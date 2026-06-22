---
title: "Spring Boot Actuator로 운영 모니터링하기"
date: 2026-03-12 10:00:00 +0900
series: "Spring Boot"
categories: [Backend, Spring Boot]
tags: [spring-boot, actuator, monitoring, health]
image:
  path: /assets/img/posts/springboot-actuator.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnTEzEkDjNNMLdhSvIwyoPGaiJPrQiRSp3be9XpdIuY7bz2X5MZqgGIYN3FadxrtxPZi2bAXGDSd76AZz/AHzTDRRTQCUUUUxn/9k="
  alt: Spring Boot Actuator
---

## 배포는 했는데, 잘 돌고 있는지 어떻게 알지

로컬에선 잘 되던 게 운영에선 조용히 죽어 있기도 합니다. "지금 살아 있나? DB 연결은 정상인가? 메모리는 괜찮나?"를 들여다볼 창구가 필요하죠. **Spring Boot Actuator**가 바로 그 창구입니다.

## 시작하기

의존성만 추가하면 운영용 엔드포인트가 생깁니다.

```gradle
implementation 'org.springframework.boot:spring-boot-starter-actuator'
```

기본적으로 `/actuator/health`만 노출되고, 나머지는 명시적으로 열어야 합니다(보안 때문).

```yaml
management:
  endpoints:
    web:
      exposure:
        include: [health, info, metrics, loggers]
  endpoint:
    health:
      show-details: when-authorized
```

## 자주 쓰는 엔드포인트

- `/actuator/health`: 살아 있는지 + 구성요소(DB, Redis 등) 상태. 로드밸런서/쿠버네티스 헬스체크에 사용.
- `/actuator/metrics`: JVM·HTTP·커넥션풀 등 메트릭. ([Observability 글](/posts/springboot-observability/)에서 Prometheus 연동)
- `/actuator/loggers`: **재배포 없이** 로그 레벨을 런타임에 변경. 장애 분석 시 특정 패키지만 DEBUG로 올릴 수 있어 유용.
- `/actuator/info`: 빌드 버전 등 임의 정보.

## 헬스체크와 쿠버네티스

쿠버네티스를 쓴다면 **liveness/readiness** 프로브를 Actuator가 제공합니다.

```yaml
management:
  endpoint:
    health:
      probes:
        enabled: true
```

- `/actuator/health/liveness`: 죽었으면 재시작
- `/actuator/health/readiness`: 트래픽 받을 준비됐는지

## 커스텀 HealthIndicator

외부 의존성(예: 결제 게이트웨이)의 상태도 헬스체크에 포함시킬 수 있습니다.

```java
@Component
public class PaymentHealthIndicator implements HealthIndicator {
    private final PaymentClient client;

    @Override
    public Health health() {
        try {
            client.ping();
            return Health.up().build();
        } catch (Exception e) {
            return Health.down(e).build();
        }
    }
}
```

이러면 `/actuator/health`에 `payment` 상태가 함께 표시되고, 하나라도 DOWN이면 전체가 DOWN으로 떨어집니다.

## 보안 주의

Actuator 엔드포인트에는 민감 정보가 많습니다(`env`, `heapdump`, `loggers` 등). 운영에선:

- 꼭 필요한 엔드포인트만 `include`로 노출.
- 별도 관리 포트(`management.server.port`)로 분리하거나, Spring Security로 보호.
- `env`, `heapdump` 같은 위험한 엔드포인트는 외부에 절대 열지 말 것.

## 정리

- Actuator = 운영 상태를 들여다보는 창구. `starter-actuator`만 추가.
- `health`(+probes), `metrics`, `loggers`(런타임 로그레벨)가 특히 유용.
- 외부 의존성은 **커스텀 HealthIndicator**로 헬스체크에 포함.
- 민감 엔드포인트는 **반드시 보호/제한**하자.

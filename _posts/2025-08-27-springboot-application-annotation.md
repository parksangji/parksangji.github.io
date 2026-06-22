---
title: "@SpringBootApplication 한 줄 뜯어보기"
date: 2025-08-27 09:30:00 +0900
series: "Spring Boot"
categories: [Backend, Spring Boot]
tags: [spring-boot, annotation, component-scan, internals]
image:
  path: /assets/img/posts/springboot-application-annotation.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnjCzkkDPNI0DjtR5zoSFPFMeZ2HJoRIhjYEAjrV2XSLmO289l+TGaoByGBzyK07jXbiezFs2AuMGk730Azn++aYaKKaASiiimM//Z"
  alt: "@SpringBootApplication 분석"
---

## 메인 클래스의 그 한 줄

Spring Boot 프로젝트를 만들면 항상 이 코드가 있습니다.

```java
@SpringBootApplication
public class DemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}
```

너무 당연하게 써왔는데, `@SpringBootApplication`이 실제로 뭘 하는지 들여다본 적은 없었습니다. 알고 보니 이 한 줄은 **세 개의 애너테이션을 합친 메타 애너테이션**이었습니다.

## 셋이 합쳐진 애너테이션

```java
@SpringBootConfiguration
@EnableAutoConfiguration
@ComponentScan
public @interface SpringBootApplication { ... }
```

### 1. @SpringBootConfiguration

`@Configuration`의 특수한 버전입니다. 이 클래스가 **Bean을 정의하는 설정 클래스**임을 나타냅니다. 즉 메인 클래스 안에서도 `@Bean` 메서드를 정의할 수 있습니다.

### 2. @EnableAutoConfiguration

앞 글에서 다룬 **자동 구성**의 스위치입니다. 클래스패스와 설정을 보고 필요한 Bean들을 조건부로 등록해줍니다.

### 3. @ComponentScan

`@Component`, `@Service`, `@Repository`, `@Controller` 등이 붙은 클래스를 **스캔해서 Bean으로 등록**합니다. 여기서 가장 중요한 포인트가 **스캔 기준 패키지**입니다.

## "Bean이 안 잡혀요"의 90%는 패키지 문제

`@ComponentScan`은 별도 설정이 없으면 **메인 클래스가 위치한 패키지와 그 하위**를 스캔합니다. 그래서 메인 클래스는 보통 최상위 패키지에 둬야 합니다.

```text
com.example.demo            ← DemoApplication (여기 두면 하위 전부 스캔)
├── controller
├── service
└── repository

com.another.pkg             ← 여기는 스캔 안 됨! Bean 등록 실패
```

"분명 `@Service`를 붙였는데 주입이 안 된다"는 문제의 상당수가, 컴포넌트가 메인 클래스 패키지 **바깥**에 있어서입니다. 위치를 옮기거나, 스캔 범위를 명시해야 합니다.

```java
@SpringBootApplication(scanBasePackages = {"com.example.demo", "com.another.pkg"})
public class DemoApplication { }
```

## SpringApplication.run은 무슨 일을 하나

`main`의 `SpringApplication.run(...)`도 적지 않은 일을 합니다. 대략:

1. `ApplicationContext` 생성 (웹이면 내장 톰캣 포함)
2. 환경(Environment)·설정 로딩, 프로파일 결정
3. 컴포넌트 스캔 + 자동 구성으로 Bean 등록
4. 내장 웹 서버 기동
5. `ApplicationRunner` / `CommandLineRunner` 실행

그래서 우리는 서버 설정 코드를 한 줄도 안 짜도 애플리케이션이 뜨는 겁니다.

## 정리

- `@SpringBootApplication` = `@SpringBootConfiguration` + `@EnableAutoConfiguration` + `@ComponentScan`.
- 컴포넌트 스캔은 **메인 클래스 패키지 기준 하위**만 본다 → 메인 클래스는 최상위 패키지에.
- "Bean이 안 잡힌다"면 먼저 패키지 위치부터 의심하자.
- `SpringApplication.run`이 컨텍스트 생성·설정 로딩·서버 기동까지 다 해준다.

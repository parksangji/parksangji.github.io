---
title: "선언적 HTTP 클라이언트: @HttpExchange와 RestClient"
date: 2025-12-04 14:30:00 +0900
series: "Spring Boot"
categories: [Backend, Spring Boot]
tags: [spring-boot, restclient, http-interface, httpexchange]
image:
  path: /assets/img/posts/springboot-declarative-http-client.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnTEzkkDimSIUxmnmZ1JUHjNRO7OctSRIgBJAHU1fl0i5jtvPZfkxmqCsVYEdRWnca7cT2YtmwFxg0O9wM5/vmmGiimgEooopjP//Z"
  alt: 선언적 HTTP 클라이언트
---

## RestTemplate에서 여기까지 온 길

외부 API 호출 코드는 계속 진화했습니다.

- `RestTemplate`: 오래 썼지만 이제 유지보수 모드(신규 기능 없음).
- `WebClient`: 논블로킹·리액티브. 강력하지만 MVC 앱에선 다소 과합니다.
- **`RestClient`** (Spring 6.1+): `WebClient`의 친숙한 플루언트 API를 **동기**로 쓰는 클라이언트. MVC 앱의 새 기본값.

그리고 Spring Framework 7 / Boot 4에서는 **선언적 HTTP 클라이언트**가 한층 매끄러워졌습니다.

## RestClient: 명령형 호출

```java
RestClient client = RestClient.create("https://api.example.com");

Brewery brewery = client.get()
        .uri("/breweries/{id}", id)
        .retrieve()
        .body(Brewery.class);
```

플루언트하고 읽기 좋습니다. 그런데 호출이 많아지면 URL·매핑이 코드 곳곳에 흩어지죠. 그래서 **인터페이스로 선언**하는 방식이 등장합니다.

## @HttpExchange: 인터페이스로 선언

호출 스펙을 인터페이스에 애너테이션으로 적어두면, Spring이 구현체를 만들어줍니다(마치 Feign처럼).

```java
@HttpExchange("/breweries")
public interface BreweryClient {

    @GetExchange("/{id}")
    Brewery getById(@PathVariable Long id);

    @PostExchange
    Brewery create(@RequestBody BreweryRequest request);
}
```

## Spring Boot 4: 자동 등록

기존에는 `HttpServiceProxyFactory`로 직접 프록시를 만들어 Bean으로 등록해야 했습니다. **Spring Framework 7**부터는 `@ImportHttpServices`로 그룹을 선언하면 **자동 등록**됩니다.

```java
@Configuration
@ImportHttpServices(group = "brewery", types = BreweryClient.class)
public class HttpClientConfig {

    @Bean
    RestClient breweryRestClient(RestClient.Builder builder) {
        return builder.baseUrl("https://api.example.com").build();
    }
}
```

이제 `BreweryClient`를 그냥 주입받아 쓰면 됩니다. 구현체는 런타임에 생성되고, URL 빌드·호출·JSON 매핑을 전부 알아서 합니다.

```java
@Service
@RequiredArgsConstructor
public class BreweryService {
    private final BreweryClient breweryClient;

    public Brewery find(Long id) {
        return breweryClient.getById(id);   // 선언만 했는데 호출됨
    }
}
```

> HTTP 서비스 그룹은 기본적으로 `RestClient`를 쓰지만, 필요하면 `WebClient`로 바꿀 수도 있습니다(논블로킹이 필요할 때).
{: .prompt-tip }

## 무엇을 언제

- 단발성·간단 호출: **RestClient** 직접 사용.
- 특정 API를 여러 번 호출 / 클라이언트를 모듈화: **@HttpExchange 인터페이스 + 자동 등록**.
- 전 구간 논블로킹: **WebClient** 기반.

## 정리

- `RestTemplate`은 졸업하고, MVC에선 **RestClient**가 기본.
- 반복 호출은 **`@HttpExchange` 인터페이스**로 선언 → 구현체 자동 생성.
- Spring Boot 4의 **`@ImportHttpServices`** 로 Feign 같은 자동 등록이 가능.

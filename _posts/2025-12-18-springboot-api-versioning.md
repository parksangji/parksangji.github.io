---
title: "Spring Framework 7의 HTTP API 버저닝"
date: 2025-12-18 10:30:00 +0900
series: "Spring Boot"
categories: [Backend, Spring Boot]
tags: [spring-boot, api-versioning, rest-api, spring-framework-7]
image:
  path: /assets/img/posts/springboot-api-versioning.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnGUliQD1prIQM4NDMwY4NIXfGCaESNAJIA6mr8ukXMdt57L8mM1QVirAjqK07jXbiezFs2AuMGk73Azn++aYaKKaASiiimM//2Q=="
  alt: HTTP API 버저닝
---

## API를 고치고 싶은데 기존 클라이언트가 무섭다

운영 중인 API의 응답 구조를 바꿔야 할 때가 옵니다. 그런데 이미 그 API를 쓰는 앱·외부 연동이 있으면, 함부로 바꿨다간 다 깨지죠. 그래서 **버전을 나눠서** `/v1`은 그대로 두고 `/v2`를 새로 제공하는 전략을 씁니다.

예전엔 이걸 직접(경로 분기, 인터셉터 등) 구현했는데, **Spring Framework 7**부터 **프레임워크 기본 기능**이 됐습니다.

## version 속성

`@RequestMapping`과 그 변형들(`@GetMapping` 등)에 **`version`** 속성이 생겼습니다. 같은 경로라도 버전별로 다른 핸들러를 둘 수 있습니다.

```java
@RestController
@RequestMapping("/products")
public class ProductController {

    @GetMapping(version = "1")
    public ProductV1 getV1(@PathVariable Long id) {
        return service.findV1(id);
    }

    @GetMapping(version = "2")
    public ProductV2 getV2(@PathVariable Long id) {
        return service.findV2(id);   // 새 응답 구조
    }
}
```

## 버전을 어디서 읽을지: 전략 설정

클라이언트가 버전을 어떻게 전달하는지를 정해야 합니다. 선택지는 보통 네 가지입니다.

- **경로(Path)**: `/v1/products`
- **쿼리 파라미터**: `/products?version=1`
- **헤더**: `X-API-Version: 1`
- **미디어 타입**: `Accept: application/json;version=1`

WebMvc 설정에서 어떤 전략을 쓸지 등록합니다(예: 헤더 방식).

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void configureApiVersioning(ApiVersionConfigurer configurer) {
        configurer.useRequestHeader("X-API-Version");
        // 또는 .usePathSegment(0) / .useQueryParam("version")
        //      / .useMediaTypeParameter(MediaType.APPLICATION_JSON, "version")
    }
}
```

이제 클라이언트가 `X-API-Version: 2` 헤더를 보내면 `getV2`가, `1`이면 `getV1`이 호출됩니다.

## 어떤 전략이 좋을까

- **경로 버전(`/v1`)**: 가장 직관적이고 캐싱·로깅에 유리. URL이 지저분해질 수 있음.
- **헤더 버전**: URL이 깔끔하고 리소스 식별자가 버전과 분리됨. 대신 눈에 안 보여서 디버깅이 조금 번거로움.

정답은 없고 팀·클라이언트 상황에 맞추면 됩니다. 중요한 건 **하나로 일관되게** 가는 것.

## 운영 팁

- 새 버전을 낼 때 **구버전은 한동안 유지**하고, 사용량을 모니터링하며 단계적으로 폐기(deprecate)하세요.
- 응답에 deprecation 안내 헤더를 넣어 클라이언트에 이전을 유도할 수 있습니다.

## 정리

- Spring Framework 7부터 `@GetMapping(version = "...")` 으로 **버저닝이 내장**.
- 버전 전달 방식(경로/쿼리/헤더/미디어타입)은 `ApiVersionConfigurer`로 선택.
- 전략은 일관되게, 구버전은 모니터링하며 단계적으로 폐기.

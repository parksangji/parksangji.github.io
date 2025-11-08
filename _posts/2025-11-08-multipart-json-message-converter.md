---
title: "한 요청에 파일과 JSON을 함께 받는 법"
date: 2025-11-08 10:30:00 +0900
categories: [Backend]
tags: [multipart, json, message-converter, file-upload, request-binding, spring]
description: "파일과 구조화된 JSON을 한 멀티파트 요청에 함께 보낼 때 기본 바인딩이 깨지는 이유와, 커스텀 메시지 컨버터로 JSON 파트를 객체로 바인딩하는 설계."
---

파일 업로드와 구조화된 데이터를 한 요청에 같이 받아야 했던 주가 있었다. 클라이언트는 이미지 한 장과 그 메타데이터(JSON)를 함께 보낸다. 순진하게 `@RequestBody`로 받으려 하면 "본문이 JSON이 아니다"라며 깨지고, `@RequestParam`으로 받으면 JSON이 그냥 문자열로 들어온다. 핵심은 **멀티파트 안의 한 파트가 JSON일 때, 그 파트를 객체로 바인딩하도록 컨버터를 끼우는 것**이다.

## 왜 기본 바인딩이 안 맞는가

HTTP 요청 본문은 하나의 Content-Type을 가진다. `@RequestBody`는 본문 전체를 그 타입(`application/json`)으로 보고 역직렬화한다. 그런데 파일+JSON 요청의 본문 전체 타입은 `multipart/form-data`다. 본문은 경계(boundary)로 나뉜 **여러 파트의 묶음**이고, 각 파트가 **자기만의 Content-Type**을 가진다.

```
Content-Type: multipart/form-data; boundary=----X

------X
Content-Disposition: form-data; name="meta"
Content-Type: application/json        <- 이 파트는 JSON

{"title":"hello","tags":["a","b"]}
------X
Content-Disposition: form-data; name="file"; filename="a.png"
Content-Type: image/png               <- 이 파트는 바이너리
...
------X--
```

`@RequestBody`는 본문 전체가 JSON이라고 가정하므로 멀티파트에선 동작하지 않는다. 그래서 파트 단위로 접근하는 `@RequestPart`가 필요하다.

## @RequestPart와 그 한계

`@RequestPart`는 파트 하나를 꺼내 처리한다. 파트에 `Content-Type: application/json`이 **명시돼 있으면** Spring은 JSON 메시지 컨버터로 그 파트를 객체로 역직렬화한다.

```java
@PostMapping(path = "/items", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
public ResponseEntity<Void> create(
        @RequestPart("meta") ItemMeta meta,          // JSON 파트 → 객체
        @RequestPart("file") MultipartFile file) {   // 바이너리 파트
    service.save(meta, file);
    return ResponseEntity.ok().build();
}
```

함정은 여기다. **클라이언트가 JSON 파트에 Content-Type을 안 붙이면** 그 파트는 기본적으로 `text/plain`(또는 미지정)으로 취급되고, `ItemMeta`로 바인딩할 컨버터를 못 찾아 `415 Unsupported Media Type`이 난다. 브라우저 `FormData`로 일반 객체를 append하면 Content-Type 없는 파트가 만들어지기 쉽다.

## 커스텀 컨버터로 메우기

클라이언트를 통제할 수 없어 파트 Content-Type을 보장 못 한다면, **Content-Type이 없거나 text여도 JSON으로 읽어주는 메시지 컨버터**를 추가한다. 핵심은 JSON 컨버터가 지원하는 미디어 타입에 `text/plain`/`application/octet-stream`을 더해, 그런 파트도 JSON으로 역직렬화하게 만드는 것이다.

```java
@Bean
public MappingJackson2HttpMessageConverter lenientJsonConverter(ObjectMapper mapper) {
    var converter = new MappingJackson2HttpMessageConverter(mapper);
    converter.setSupportedMediaTypes(List.of(
        MediaType.APPLICATION_JSON,
        MediaType.TEXT_PLAIN,                 // Content-Type 없는 파트 흡수
        MediaType.APPLICATION_OCTET_STREAM
    ));
    return converter;
}

@Configuration
class WebConfig implements WebMvcConfigurer {
    private final MappingJackson2HttpMessageConverter lenient;
    WebConfig(MappingJackson2HttpMessageConverter lenient) { this.lenient = lenient; }

    @Override
    public void extendMessageConverters(List<HttpMessageConverter<?>> converters) {
        converters.add(0, lenient); // 우선순위 높여 먼저 시도
    }
}
```

이렇게 하면 JSON 파트가 Content-Type을 빠뜨려도 객체로 바인딩된다. 더 깔끔한 길은 클라이언트가 JSON 파트에 `Content-Type: application/json`을 정확히 실어 보내도록 계약을 맞추는 것이다. 컨버터 완화는 그게 불가능할 때의 차선이다.

## 운영 함정

**컨버터를 너무 넓게 열면 다른 엔드포인트가 영향받는다.** `text/plain`을 JSON 컨버터가 통째로 가져가게 만들면, 진짜 평문을 받던 다른 API의 바인딩이 바뀌어 의도치 않은 역직렬화나 오류가 생길 수 있다. 가능하면 완화 컨버터의 적용 범위를 좁히거나, 해당 컨트롤러 전용으로 한정하는 게 안전하다.

**멀티파트 크기 한도.** 파일이 끼면 요청 크기가 커진다. `max-file-size`/`max-request-size`를 넘기면 바인딩 이전 단계에서 잘려 `MaxUploadSizeExceededException`이 난다. JSON 파트가 멀쩡해도 파일 때문에 요청 전체가 거부될 수 있으니 한도와 예외 처리를 함께 둔다.

## 핵심 요약

- 파일+JSON은 본문 전체가 `multipart/form-data`라 `@RequestBody`로 못 받는다. 파트 단위 `@RequestPart`를 쓴다.
- JSON 파트에 `Content-Type: application/json`이 있어야 객체로 바인딩된다. 없으면 `415`.
- 클라이언트가 Content-Type을 못 붙이면, JSON 컨버터의 지원 미디어 타입을 넓힌 **완화 컨버터**로 흡수한다.
- 완화 컨버터는 적용 범위를 좁혀 다른 평문 API에 새어 나가지 않게 한다.

> **면접 Q.** 멀티파트로 보낸 JSON 파트가 `415 Unsupported Media Type`으로 거부된다. 원인과 해법은?
> **A.** 그 파트에 `Content-Type: application/json`이 없어 바인딩할 컨버터를 못 찾은 것이다. 클라이언트가 파트 Content-Type을 정확히 싣게 하거나, 서버에 해당 타입도 JSON으로 읽는 컨버터를 추가한다.

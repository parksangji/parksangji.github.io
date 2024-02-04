---
title: "다운로드 파일명이 깨지는 진짜 이유"
date: 2024-02-04 10:30:00 +0900
categories: [Network]
tags: [download, content-disposition, encoding, filename, http-header]
description: "한글 파일명이 다운로드 시 깨지는 원인은 Content-Disposition 헤더의 인코딩에 있다. RFC 5987의 filename* 파라미터로 브라우저별 차이를 정공법으로 해결한다."
---

파일 다운로드 기능을 손보다 보면 어김없이 만나는 버그가 있다. "리포트_2024년.xlsx" 같은 한글 파일명이 브라우저에서 `_____2024__.xlsx`나 깨진 글자로 저장되는 현상이다. 이건 인코딩 변환을 어디선가 빠뜨린 게 아니라, HTTP 헤더가 본질적으로 ASCII만 안전하게 담을 수 있는 구조이기 때문이다.

## 핵심 개념 — 헤더는 ASCII 채널이다

브라우저에 "이 응답을 화면에 그리지 말고 파일로 저장하라"고 지시하는 건 `Content-Disposition: attachment` 헤더다. 저장될 이름은 `filename` 파라미터로 전달한다.

```
Content-Disposition: attachment; filename="report.xlsx"
```

문제는 HTTP/1.1 헤더 값이 원칙적으로 ISO-8859-1(Latin-1) 범위만 안전하게 표현하도록 정의돼 있다는 점이다. UTF-8로 인코딩된 한글 바이트를 그대로 헤더에 넣으면, 서버 프레임워크가 이를 Latin-1로 재해석하면서 멀쩡한 바이트가 다른 문자로 둔갑한다. 브라우저마다 헤더 디코딩 규칙이 달라 결과도 제각각이다.

이를 해결하려고 나온 표준이 **RFC 5987**이다. 핵심은 `filename*` 파라미터다. 별표가 붙은 파라미터는 `인코딩'언어'퍼센트인코딩된값` 형식을 따른다.

```
Content-Disposition: attachment; filename*=UTF-8''%EB%A6%AC%ED%8F%AC%ED%8A%B8.xlsx
```

`%EB%A6%AC`는 "리"를 UTF-8로 인코딩한 바이트를 퍼센트 인코딩한 값이다. 이렇게 하면 헤더 자체는 순수 ASCII로만 구성되므로 어떤 중간 프록시나 프레임워크를 거쳐도 바이트가 손상되지 않는다. 브라우저는 `filename*`을 발견하면 UTF-8로 디코딩해 올바른 이름을 복원한다.

## 코드 예시 — 두 파라미터를 함께 보낸다

구형 클라이언트는 `filename*`을 모른다. 그래서 표준 권고는 ASCII fallback인 `filename`과 UTF-8 정공법인 `filename*`을 둘 다 보내는 것이다. 신형 브라우저는 `filename*`을 우선하고, 구형은 `filename`을 쓴다.

```java
@GetMapping("/files/{id}/download")
public ResponseEntity<Resource> download(@PathVariable Long id) {
    FileMeta meta = fileService.find(id);
    Resource body = fileService.load(meta);

    String name = meta.getOriginalName();           // "리포트_2024년.xlsx"
    String encoded = URLEncoder.encode(name, StandardCharsets.UTF_8)
                               .replace("+", "%20"); // 공백을 + 가 아닌 %20 으로

    String disposition = "attachment; "
            + "filename=\"" + toAsciiFallback(name) + "\"; "
            + "filename*=UTF-8''" + encoded;

    return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, disposition)
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .body(body);
}
```

주의할 디테일이 두 가지다. 첫째, `URLEncoder.encode`는 공백을 `+`로 바꾸는데 RFC 5987 토큰에서 `+`는 리터럴 플러스로 해석되므로 반드시 `%20`으로 치환한다. 둘째, fallback `filename`에는 ASCII로 변환할 수 없는 문자를 `_` 등으로 치환한 안전한 이름을 넣어야 한다.

## 운영 함정

가장 흔한 사고는 **헤더 인젝션**이다. 사용자가 업로드 시 지정한 원본 파일명을 그대로 헤더에 넣으면, 파일명에 개행 문자(`\r\n`)나 따옴표가 섞여 있을 때 헤더가 조작되거나 응답이 깨진다. 헤더에 싣기 전 개행과 제어문자를 제거하고, 따옴표는 이스케이프한다.

두 번째는 **콘텐츠 타입**이다. `Content-Type`을 실제 파일과 다르게(예: 모두 `text/html`) 내려주면 일부 브라우저가 `attachment` 지시를 무시하고 인라인 렌더링을 시도하다 깨진 화면을 보여준다. 알 수 없으면 `application/octet-stream`이 가장 안전하다.

## 핵심 요약

- HTTP 헤더는 ASCII 채널이다. 한글 파일명을 raw UTF-8로 넣으면 Latin-1 재해석으로 깨진다.
- 정답은 RFC 5987의 `filename*=UTF-8''<percent-encoded>`. 헤더를 순수 ASCII로 유지한다.
- 호환성을 위해 `filename`(ASCII fallback)과 `filename*`을 함께 보낸다.
- 사용자 입력 파일명은 개행/제어문자를 제거해 헤더 인젝션을 막는다.

> **면접 한 줄 Q&A**
> Q. 다운로드 한글 파일명이 깨진다. 왜이며 어떻게 고치나?
> A. HTTP 헤더가 ASCII 기반이라 UTF-8 바이트가 Latin-1로 재해석돼 깨진다. RFC 5987의 `filename*=UTF-8''` 파라미터로 퍼센트 인코딩해 보내고, 구형 호환을 위해 ASCII `filename`을 함께 둔다.

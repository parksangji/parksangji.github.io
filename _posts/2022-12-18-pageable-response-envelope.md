---
title: "목록 응답을 감싸는 표준 봉투 설계"
date: 2022-12-18 10:30:00 +0900
categories: [Backend]
tags: [api, response-envelope, pagination, metadata, api-contract]
description: "데이터와 페이지 메타를 함께 담는 응답 envelope 설계. 빈 목록의 일관성과 클라이언트 파싱 안정성을 보장하는 계약을 정리한다."
---

목록 API를 만들다 보면 결국 같은 질문에 부딪힌다. "데이터 배열만 줄 것인가, 아니면 전체 개수와 페이지 정보를 함께 줄 것인가." 페이징이 있는 한 답은 정해져 있다. 클라이언트는 "다음 페이지가 있는지", "전체가 몇 개인지"를 알아야 UI를 그린다. 이 메타데이터를 담는 표준 구조가 **응답 봉투(response envelope)** 다.

## 배열을 그냥 던지지 않는 이유

가장 단순한 응답은 JSON 배열이다.

```json
[ { "id": 1, "name": "A" }, { "id": 2, "name": "B" } ]
```

이건 두 가지 문제를 낳는다. 첫째, **메타데이터를 끼워 넣을 자리가 없다.** total, page, size를 어디에 둘 것인가. 둘째, **확장 불가능하다.** 나중에 응답 최상위에 필드 하나(예: 경고 메시지) 추가하려면 배열을 객체로 바꿔야 하고, 이는 클라이언트 전체를 깨뜨리는 호환성 파괴다. 그래서 목록 응답은 처음부터 객체로 감싼다.

## 봉투 구조 설계

데이터와 페이지 메타를 분리해 담는다.

```java
public class PageResponse<T> {
    private List<T> content;       // 항상 배열, null 금지
    private PageMeta page;

    public static <T> PageResponse<T> of(List<T> content, long total, int page, int size) {
        return new PageResponse<>(content, new PageMeta(page, size, total));
    }
}

public class PageMeta {
    private int  page;             // 0-based 또는 1-based 중 하나로 문서화
    private int  size;
    private long totalElements;
    private int  totalPages;       // ceil(total / size)
    private boolean hasNext;       // page < totalPages - 1
}
```

```json
{
  "content": [ { "id": 1, "name": "A" } ],
  "page": { "page": 0, "size": 20, "totalElements": 137, "totalPages": 7, "hasNext": true }
}
```

`hasNext`나 `totalPages`처럼 **클라이언트가 매번 계산해야 할 값을 서버가 미리 계산해 내려주는 것**이 좋은 계약이다. 계산 로직이 서버 한 곳에 모이면 클라이언트마다 다르게 구현되어 생기는 버그를 막는다.

## 빈 목록의 일관성

가장 흔한 클라이언트 크래시 원인은 "결과가 없을 때 `content`가 `null`로 오는 것"이다. 결과가 없으면 `null`이 아니라 **빈 배열**을 보낸다.

```java
// 나쁨: 조건 분기로 null이 샐 수 있음
return result.isEmpty() ? null : PageResponse.of(result, ...);

// 좋음: 항상 동일 구조, content는 빈 배열
return PageResponse.of(result, total, page, size);  // result가 [] 여도 OK
```

`null`과 `[]`를 섞으면 클라이언트는 매번 `if (content != null)` 방어를 해야 한다. 구조를 항상 동일하게 유지하면 클라이언트는 무조건 배열을 순회하면 된다. **일관성이 곧 안정성이다.**

## 운영 함정

**total 계산을 매 요청마다 하는 비용.** 봉투에 `totalElements`를 넣으려면 별도 count 쿼리가 필요하다. 데이터가 크면 이 count가 본 쿼리보다 무거울 수 있다. 무한 스크롤처럼 전체 개수가 필요 없는 화면이라면 `hasNext`만 내려주는 별도 응답(다음 페이지 존재 여부는 `size+1`개를 조회해 판단)을 두는 편이 낫다. 모든 목록에 total을 강제하지 않는다.

## 핵심 요약

- 목록은 배열이 아니라 객체로 감싼다 — 메타데이터 자리와 확장성을 위해.
- `hasNext`, `totalPages` 등 파생 값은 서버가 계산해 내려 클라이언트 중복 로직을 없앤다.
- 결과가 없어도 `content`는 항상 빈 배열. `null`을 섞지 않는다.
- total이 무거우면 무한 스크롤용 `hasNext`-only 응답으로 분리한다.

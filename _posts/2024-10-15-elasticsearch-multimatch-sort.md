---
title: "MultiMatch와 다중 정렬, Query String (feat. Java)"
date: 2024-10-15 13:20:00 +0900
series: "Elasticsearch"
categories: [Search]
tags: [elasticsearch, multi-match, sort, query-string, java]
mermaid: true
image:
  path: /assets/img/posts/elasticsearch-multimatch-sort.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnjEzEkDimmFuwoaVwCgPGajJPrVGa2HRRmSZY84JOK2LjQPKt3kWcMVGSKxoZPKmV8Z2nNbM+uRyQSIkJUuMdaTuUYz/eNMNFFMS2EooooGf/2Q=="
  alt: "Elasticsearch MultiMatch와 다중 정렬"
---

## 검색창 하나로 여러 필드를 뒤지고 싶다

실제 검색창은 보통 하나입니다. 그런데 사용자가 입력한 키워드는 **제목·본문·태그** 어디에 있든 잡혀야 하죠. 필드마다 `match`를 따로 거는 건 번거롭습니다. 이때 쓰는 게 **MultiMatch** 입니다.

## MultiMatch: 여러 필드 동시 매칭

```mermaid
flowchart LR
    Q["검색어: 'spring'"] --> M["multi_match"]
    M --> F1["title (가중치 x3)"]
    M --> F2["body"]
    M --> F3["tags (가중치 x2)"]
    F1 & F2 & F3 --> S["필드별 점수 합산 → 관련도 정렬"]
```

```json
GET /posts/_search
{
  "query": {
    "multi_match": {
      "query": "spring",
      "fields": ["title^3", "body", "tags^2"]
    }
  }
}
```

`title^3`처럼 **`^숫자`로 가중치(boost)** 를 줍니다. 제목에 있는 게 본문에 있는 것보다 더 중요하다고 알려주는 거죠. `type`(best_fields, cross_fields 등)으로 점수 계산 방식도 바꿀 수 있습니다.

## 다중 정렬

관련도 점수 외에, 여러 기준으로 정렬해야 할 때가 있습니다. `sort`에 배열로 나열하면 **앞에서부터 우선순위**로 적용됩니다.

```json
GET /posts/_search
{
  "query": { "match": { "title": "spring" } },
  "sort": [
    { "pinned": "desc" },      // 1순위: 고정글 먼저
    { "_score": "desc" },      // 2순위: 관련도
    { "created_at": "desc" }   // 3순위: 최신순
  ]
}
```

정렬 대상 필드는 [doc_values가 있는 keyword/숫자/날짜](/posts/elasticsearch-doc-values-wildcard/)여야 한다는 점, 잊지 마세요.

## Query String — 한 문자열로 표현하는 검색

`query_string`은 `spring AND (boot OR mvc) -deprecated` 같은 **연산자 문법**을 한 문자열로 받습니다. 강력하지만, 사용자 입력에 그대로 노출하면 문법 오류로 검색이 깨질 수 있어 주의가 필요합니다(그런 경우 `simple_query_string`이 더 안전).

```json
{ "query": { "query_string": { "query": "spring AND boot", "fields": ["title", "body"] } } }
```

## Java에서 쓰기

Java에서는 **Elasticsearch Java API Client**로 동일한 쿼리를 타입 안전하게 작성합니다.

```java
SearchResponse<Post> response = client.search(s -> s
    .index("posts")
    .query(q -> q
        .multiMatch(mm -> mm
            .query("spring")
            .fields("title^3", "body", "tags^2")
        )
    )
    .sort(so -> so.field(f -> f.field("created_at").order(SortOrder.Desc))),
    Post.class
);

response.hits().hits().forEach(hit -> System.out.println(hit.source()));
```

람다(빌더) 스타일이라 JSON DSL과 구조가 거의 1:1로 대응됩니다. JSON으로 먼저 검증하고 Java로 옮기면 편합니다.

## 정리

- **multi_match**: 하나의 검색어로 여러 필드 동시 검색, `field^n`으로 가중치.
- **다중 정렬**: `sort` 배열로 우선순위 정렬(정렬 필드는 doc_values 필요).
- **query_string**: 연산자 문법 검색(사용자 입력엔 `simple_query_string` 권장).
- Java는 **Java API Client**의 빌더로 JSON DSL과 1:1 매핑해 작성.

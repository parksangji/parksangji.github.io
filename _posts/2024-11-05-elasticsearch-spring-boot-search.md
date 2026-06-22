---
title: "Docker · Elasticsearch · Spring Boot로 검색 기능 구현하기"
date: 2024-11-05 10:30:00 +0900
series: "Elasticsearch"
categories: [Search, Elasticsearch]
tags: [elasticsearch, spring-boot, docker, search]
mermaid: true
image:
  path: /assets/img/posts/elasticsearch-spring-boot-search.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnTEzEkDikMLdhQ0jDKg8ZqMk+tUZpaDoozJMsecEnFbFxoHlW7yLOGKjJFY0MnlTK+M7TmtmfXI5IJESEqXGOtJ3KMZ/vGmGiimJbCUUUUDP/2Q=="
  alt: "Spring Boot와 Elasticsearch로 검색 구현"
---

## 개념은 알겠고, 이제 붙여보자

[역색인](/posts/elasticsearch-inverted-index/)부터 [집계](/posts/elasticsearch-aggregations/), [MultiMatch](/posts/elasticsearch-multimatch-sort/)까지 봤으니, 실제로 **Spring Boot 애플리케이션 + Docker Elasticsearch**로 검색 기능을 붙여봅니다.

## 전체 구조

```mermaid
flowchart LR
    C[클라이언트] -->|검색 요청| A["Spring Boot<br/>(REST API)"]
    A -->|Query DSL| E["Elasticsearch<br/>(Docker)"]
    E -->|역색인 검색 결과| A
    A -->|JSON 응답| C
```

## 1. Docker로 Elasticsearch 띄우기

로컬 개발용으로는 단일 노드면 충분합니다.

```yaml
# docker-compose.yml
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.15.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false   # 로컬 개발 한정! 운영은 보안 켜기
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    ports:
      - "9200:9200"
```

```bash
docker compose up -d
curl localhost:9200   # 응답 오면 OK
```

> `xpack.security.enabled=false`는 **로컬 개발 전용**입니다. 운영에서는 보안을 반드시 켜고 인증을 설정하세요.
{: .prompt-warning }

## 2. Spring Data Elasticsearch 설정

```gradle
implementation 'org.springframework.boot:spring-boot-starter-data-elasticsearch'
```

```yaml
spring:
  elasticsearch:
    uris: http://localhost:9200
```

## 3. 문서 매핑 (엔티티)

```java
@Document(indexName = "posts")
public class Post {
    @Id
    private String id;

    @Field(type = FieldType.Text)        // 전문 검색
    private String title;

    @Field(type = FieldType.Keyword)     // 필터/집계/정렬
    private String status;

    @Field(type = FieldType.Date)
    private Instant createdAt;
    // getters/setters
}
```

`@Field`의 타입이 [text/keyword 선택](/posts/elasticsearch-inverted-index/)과 직결됩니다.

## 4. Repository와 검색

간단한 검색은 Spring Data Repository로 충분합니다.

```java
public interface PostRepository extends ElasticsearchRepository<Post, String> {
    List<Post> findByTitle(String title);   // match 쿼리로 변환됨
}
```

복잡한 쿼리(MultiMatch, 정렬, 집계)는 `ElasticsearchOperations`로 직접 작성합니다.

```java
@Service
@RequiredArgsConstructor
public class PostSearchService {
    private final ElasticsearchOperations operations;

    public List<Post> search(String keyword) {
        var query = NativeQuery.builder()
            .withQuery(q -> q.multiMatch(mm -> mm
                .query(keyword)
                .fields("title^3", "body")))
            .withSort(so -> so.field(f -> f.field("createdAt").order(SortOrder.Desc)))
            .build();

        return operations.search(query, Post.class)
            .stream().map(SearchHit::getContent).toList();
    }
}
```

## 5. 컨트롤러

```java
@RestController
@RequiredArgsConstructor
public class SearchController {
    private final PostSearchService searchService;

    @GetMapping("/search")
    public List<Post> search(@RequestParam String q) {
        return searchService.search(q);
    }
}
```

이제 `GET /search?q=spring` 으로 전문 검색이 동작합니다.

## 정리

- 구조: 클라이언트 → Spring Boot(REST) → Elasticsearch(Docker) → 결과.
- 로컬은 `single-node` + 보안 off(운영은 보안 필수).
- 매핑은 `@Document` + `@Field`(text/keyword 구분이 핵심).
- 간단 검색은 **Repository**, 복잡 검색은 **ElasticsearchOperations + NativeQuery**.

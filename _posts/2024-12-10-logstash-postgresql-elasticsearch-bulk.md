---
title: "Logstash를 활용한 PostgreSQL 데이터 Elasticsearch Bulk Insert"
date: 2024-12-10 11:20:00 +0900
series: "Logstash"
categories: [Search]
tags: [logstash, postgresql, elasticsearch, jdbc, etl]
mermaid: true
image:
  path: /assets/img/posts/logstash-postgresql-elasticsearch-bulk.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnvKZySBUTKQcYqTznQkKeKaZnzk4qjNbCRoZJVTpuOK2brw60Fk1x5wIUZxWMkxWZZDztOa1rjXFltXhVGG4dzSd7ldDIf7xphoopiWwlFFFAz//Z"
  alt: "Logstash로 PostgreSQL 데이터 Elasticsearch 적재"
---

## DB 데이터를 검색 엔진으로 옮겨야 할 때

[PostgreSQL](/posts/postgresql-btree-index/)에 쌓인 데이터를 [Elasticsearch](/posts/elasticsearch-inverted-index/)로 검색하려면, 먼저 데이터를 ES로 옮겨야 합니다. 애플리케이션 코드로 한 건씩 색인할 수도 있지만, **대량 초기 적재**나 **주기적 동기화**라면 **Logstash**가 깔끔합니다.

## Logstash 파이프라인 구조

Logstash는 **input → filter → output** 3단계 파이프라인입니다.

```mermaid
flowchart LR
    I["input<br/>jdbc (PostgreSQL 조회)"] --> F["filter<br/>데이터 가공/변환"]
    F --> O["output<br/>elasticsearch (bulk 색인)"]
```

- **input**: JDBC 플러그인으로 PostgreSQL을 쿼리
- **filter**: 필드 변환·정제(선택)
- **output**: Elasticsearch로 **bulk** 색인(자동으로 묶어서 효율적으로 전송)

## 파이프라인 설정

```ruby
# pipeline/postgres-to-es.conf
input {
  jdbc {
    jdbc_driver_library => "/usr/share/logstash/drivers/postgresql.jar"
    jdbc_driver_class => "org.postgresql.Driver"
    jdbc_connection_string => "jdbc:postgresql://postgres:5432/mydb"
    jdbc_user => "postgres"
    jdbc_password => "${PG_PASSWORD}"

    statement => "SELECT id, title, body, updated_at FROM posts WHERE updated_at > :sql_last_value"
    use_column_value => true
    tracking_column => "updated_at"
    tracking_column_type => "timestamp"

    schedule => "*/5 * * * *"   # 5분마다 증분 동기화
  }
}

filter {
  mutate { remove_field => ["@version", "@timestamp"] }
}

output {
  elasticsearch {
    hosts => ["http://elasticsearch:9200"]
    index => "posts"
    document_id => "%{id}"      # PK를 문서 ID로 → 같은 행은 갱신(중복 방지)
    action => "index"
  }
}
```

## 핵심 포인트

### 1. 증분 동기화 (sql_last_value)

`tracking_column`과 `:sql_last_value`를 쓰면, **마지막으로 가져온 시점 이후 변경분만** 조회합니다. 매번 전체를 다시 긁지 않아 효율적입니다. 그래서 쿼리에 `WHERE updated_at > :sql_last_value`를 넣습니다.

### 2. document_id로 중복 방지

`document_id => "%{id}"`로 PostgreSQL의 PK를 ES 문서 ID로 지정하면, 같은 행이 다시 들어와도 **새로 추가가 아니라 갱신**됩니다. 이게 없으면 동기화할 때마다 중복 문서가 쌓입니다.

### 3. Bulk는 자동

Elasticsearch output 플러그인은 들어오는 이벤트를 **자동으로 묶어 Bulk API**로 전송합니다. 한 건씩 보내는 것보다 훨씬 빠릅니다.

## 매핑은 미리 잡아두자

Logstash가 자동 생성하는 매핑은 의도와 다를 수 있습니다([text/keyword](/posts/elasticsearch-inverted-index/) 등). 검색 품질이 중요하면 **인덱스 매핑을 먼저 정의**하고 Logstash로 적재하세요.

## 정리

- Logstash 파이프라인: **input(jdbc) → filter → output(elasticsearch)**.
- **`sql_last_value`** 로 증분 동기화, **`schedule`** 로 주기 실행.
- **`document_id`에 PK**를 주어 중복 없이 갱신.
- Output 플러그인이 **Bulk 색인**을 자동 처리. 매핑은 미리 정의하는 게 안전.

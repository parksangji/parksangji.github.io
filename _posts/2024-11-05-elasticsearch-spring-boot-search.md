---
title: "Docker · Elasticsearch · Spring Boot로 검색 기능 구현하기"
date: 2024-11-05 10:30:00 +0900
series: "Elasticsearch"
categories: [Search]
tags: [elasticsearch, spring-boot, docker, search, inverted-index, analyzer]
mermaid: true
image:
  path: /assets/img/posts/elasticsearch-spring-boot-search.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnTEzEkDikMLdhQ0jDKg8ZqMk+tUZpaDoozJMsecEnFbFxoHlW7yLOGKjJFY0MnlTK+M7TmtmfXI5IJESEqXGOtJ3KMZ/vGmGiimJbCUUUUDP/2Q=="
  alt: "Spring Boot와 Elasticsearch로 검색 구현"
---

## 개념은 알겠고, 이제 붙여보자

[역색인](/posts/elasticsearch-inverted-index/)부터 [집계](/posts/elasticsearch-aggregations/), [MultiMatch](/posts/elasticsearch-multimatch-sort/)까지 봤으니, 실제로 **Spring Boot + Docker Elasticsearch**로 검색을 붙여봅니다.

그런데 이 글의 목표는 "동작하는 코드"가 아닙니다. 검색은 *돌아가게 만들기*는 쉽고 *원하는 결과가 나오게 만들기*가 어렵습니다. 대부분의 "왜 검색이 안 잡히지?"는 RDB 감각으로 Elasticsearch를 다뤄서 생기는 문제 — **분석기(analyzer)와 역색인(inverted index)이 색인·검색 양쪽에서 무슨 일을 하는지**를 모르면 평생 헤맵니다. 그래서 코드보다 그 원리를 먼저 깔고 갑니다.

## 핵심 원리: 색인할 때와 검색할 때 "같은 분석기"가 돈다

RDB의 `LIKE '%spring%'`는 저장된 문자열을 그대로 훑습니다. Elasticsearch는 다릅니다. `text` 필드는 **색인 시점에** 분석기를 거쳐 토큰(term)으로 쪼개져 **역색인**(term → 그 term을 가진 문서 목록)에 저장됩니다. 그리고 `match` 쿼리는 **검색어도 같은 분석기로** 쪼갠 뒤, 그 term들을 역색인에서 찾습니다.

이 "양쪽에서 같은 분석"이 모든 것의 핵심입니다. 아래 흐름을 움직임으로 먼저 보세요 — <span style="color:#2f9e44;font-weight:600">초록</span>은 색인되는 문서, <span style="color:#1971c2;font-weight:600">파랑</span>은 검색어, <span style="color:#f08c00;font-weight:600">주황</span>은 매칭 결과입니다.

<div class="es-search" markdown="0">
<style>
.es-search{margin:1.4rem 0;overflow-x:auto}
.es-search svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.es-search .lbl{fill:currentColor;font-size:13px;font-weight:600}
.es-search .sub{fill:currentColor;font-size:9.5px;opacity:.55}
.es-search .arr{stroke:currentColor;opacity:.32;stroke-width:1.5;fill:none}
.es-search rect.box{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.35}
.es-search rect.p1{animation:espulse 6s ease-in-out infinite}
.es-search rect.p2{animation:espulse 6s ease-in-out infinite 1s}
.es-search rect.p3{animation:espulse 6s ease-in-out infinite 2s}
.es-search .doc{fill:#2f9e44;animation:esdoc 6s linear infinite}
.es-search .term{fill:#2f9e44}
.es-search .term.m1{animation:esterm 6s linear infinite}
.es-search .term.m2{animation:esterm 6s linear infinite .12s}
.es-search .term.m3{animation:esterm 6s linear infinite .24s}
.es-search .qry{fill:#1971c2;animation:esquery 6s linear infinite}
.es-search .match{fill:#f08c00;animation:esmatch 6s linear infinite}
@keyframes espulse{0%,100%{opacity:.3}50%{opacity:.85}}
@keyframes esdoc{0%{transform:translateX(0);opacity:0}4%{opacity:1}22%{transform:translateX(230px);opacity:1}30%{transform:translateX(230px);opacity:0}100%{opacity:0}}
@keyframes esterm{0%,18%{transform:translateX(0);opacity:0}24%{opacity:1}44%{transform:translateX(192px);opacity:1}52%{transform:translateX(192px);opacity:0}100%{opacity:0}}
@keyframes esquery{0%,46%{transform:translateX(0);opacity:0}50%{opacity:1}70%{transform:translateX(420px);opacity:1}77%{transform:translateX(420px);opacity:0}100%{opacity:0}}
@keyframes esmatch{0%,69%{transform:translateX(0);opacity:0}73%{opacity:1}93%{transform:translateX(196px);opacity:1}99%{opacity:0}100%{opacity:0}}
</style>
<svg viewBox="0 0 720 175" role="img" aria-label="문서와 검색어가 같은 분석기를 거쳐 토큰으로 쪼개지고 역색인에서 매칭되어 결과가 나오는 흐름 애니메이션">
  <rect class="box p1" x="8"   y="38" width="120" height="64" rx="8"/>
  <rect class="box p2" x="180" y="38" width="140" height="64" rx="8"/>
  <rect class="box p3" x="372" y="38" width="150" height="64" rx="8"/>
  <rect class="box"    x="574" y="38" width="138" height="64" rx="8"/>
  <text class="lbl" x="68"  y="66" text-anchor="middle">문서 · 검색어</text>
  <text class="sub" x="68"  y="82" text-anchor="middle">text 입력</text>
  <text class="lbl" x="250" y="66" text-anchor="middle">분석기</text>
  <text class="sub" x="250" y="82" text-anchor="middle">tokenizer + filter</text>
  <text class="lbl" x="447" y="66" text-anchor="middle">역색인</text>
  <text class="sub" x="447" y="82" text-anchor="middle">term → 문서들</text>
  <text class="lbl" x="643" y="70" text-anchor="middle">매칭 결과</text>
  <line class="arr" x1="128" y1="70" x2="180" y2="70"/>
  <line class="arr" x1="320" y1="70" x2="372" y2="70"/>
  <line class="arr" x1="522" y1="70" x2="574" y2="70"/>
  <circle class="doc" cx="20" cy="70" r="7"/>
  <rect class="term m1" x="250" y="48" width="16" height="9" rx="2"/>
  <rect class="term m2" x="250" y="65" width="16" height="9" rx="2"/>
  <rect class="term m3" x="250" y="82" width="16" height="9" rx="2"/>
  <circle class="qry" cx="20" cy="70" r="7"/>
  <circle class="match" cx="447" cy="70" r="7"/>
</svg>
</div>

여기서 단번에 풀리는 함정 하나: **`text` 필드에 `term`(정확 매칭) 쿼리를 날리면 거의 안 잡힙니다.** `term`은 검색어를 분석하지 않는데, 색인된 값은 이미 소문자·토큰으로 쪼개져 있기 때문입니다. `"Spring Boot"`를 색인하면 역색인엔 `spring`, `boot`가 들어가는데 `term: "Spring Boot"`로 찾으니 매칭 0. 이게 입문자 검색 버그 1위입니다.

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

> `xpack.security.enabled=false`는 **로컬 개발 전용**입니다. 운영에서는 보안을 켜고 인증(API key/TLS)을 설정하세요.
{: .prompt-warning }

## 2. 의존성과 클라이언트 — 무엇이 실제로 호출되나

```gradle
implementation 'org.springframework.boot:spring-boot-starter-data-elasticsearch'
```

```yaml
spring:
  elasticsearch:
    uris: http://localhost:9200
```

여기서 버전 정합이 중요합니다. **Spring Data Elasticsearch 5.x(Spring Boot 3.x)부터는 내부 전송 계층이 새 Elasticsearch Java API Client(`co.elastic.clients.elasticsearch.ElasticsearchClient`)로 교체**됐습니다. 예전 글에서 보던 `RestHighLevelClient`/`TransportClient`는 **제거**됐으니, 옛 예제의 `QueryBuilders.matchQuery(...)` 같은 코드는 그대로 복붙하면 컴파일조차 안 됩니다.

우리가 직접 다루는 추상화 계층은 두 개입니다.

| 계층 | 타입 | 언제 쓰나 |
|------|------|----------|
| 선언적 리포지토리 | `ElasticsearchRepository<T, ID>` | 단순 CRUD·파생 쿼리 |
| 템플릿(명령형) | `ElasticsearchOperations` (구현 `ElasticsearchTemplate`) | 복잡 쿼리·집계·하이라이트 |
| 저수준 클라이언트 | `ElasticsearchClient` | 매핑/인덱스 관리 등 직접 호출 |

`ElasticsearchRepository`는 우리가 인터페이스만 선언하면 **런타임 프록시**(`RepositoryFactorySupport` → `SimpleElasticsearchRepository`)로 구현체가 만들어집니다. Spring Data JPA 리포지토리가 프록시로 동작하는 것과 **완전히 같은 메커니즘**입니다(자세한 프록시 원리는 [Spring Data JPA 글]({% post_url 2025-10-02-springboot-data-jpa-basics %}) 참고).

## 3. 문서 매핑 — `text` vs `keyword`가 전부다

```java
@Document(indexName = "posts")
public class Post {
    @Id
    private String id;

    @Field(type = FieldType.Text, analyzer = "standard")  // 전문 검색(분석됨)
    private String title;

    @MultiField(                                           // 한 필드를 두 방식으로
        mainField = @Field(type = FieldType.Text),
        otherFields = @InnerField(suffix = "raw", type = FieldType.Keyword)
    )
    private String name;        // name → match, name.raw → 정렬/집계

    @Field(type = FieldType.Keyword)                       // 정확매칭/필터/집계/정렬
    private String status;

    @Field(type = FieldType.Date)
    private Instant createdAt;
    // getters/setters
}
```

두 타입의 차이가 검색 동작을 가릅니다.

| | `text` | `keyword` |
|---|--------|-----------|
| 분석 | O (토큰화) | X (값 그대로) |
| 쿼리 | `match`(전문) | `term`(정확) |
| 정렬·집계 | **기본 불가** | 가능 |
| 용도 | 본문·제목 검색 | 상태·코드·태그·정렬키 |

`@MultiField`로 한 필드를 `text`(검색용) + `keyword`(정렬/집계용)로 동시에 색인하는 패턴이 실무 표준입니다.

## 4. Repository와 명령형 검색

```java
public interface PostRepository extends ElasticsearchRepository<Post, String> {
    List<Post> findByTitle(String title);   // 내부적으로 match 쿼리로 변환
}
```

복잡한 검색(다중 필드·정렬·하이라이트)은 `ElasticsearchOperations` + `NativeQuery`로 작성합니다. 새 클라이언트는 **람다 빌더 DSL**입니다.

```java
@Service
@RequiredArgsConstructor
public class PostSearchService {
    private final ElasticsearchOperations operations;

    public SearchHits<Post> search(String keyword) {
        var query = NativeQuery.builder()
            .withQuery(q -> q.multiMatch(mm -> mm
                .query(keyword)
                .fields("title^3", "body")))          // title에 가중치 3배
            .withSort(so -> so.field(f -> f.field("createdAt").order(SortOrder.Desc)))
            .withHighlightQuery(new HighlightQuery(    // 매칭 구간 하이라이트
                new Highlight(List.of(new HighlightField("title"))), Post.class))
            .withPageable(PageRequest.of(0, 20))
            .build();

        return operations.search(query, Post.class);
    }
}
```

`SearchHits`를 그대로 반환하면 점수(`score`)·하이라이트 조각까지 꺼낼 수 있습니다. `SearchHit::getContent`로 본문만 뽑는 건 그 정보를 버리는 것이니, 검색 UI라면 `SearchHits`를 살려 쓰세요.

## 프로덕션 함정 4가지

**① `text` 필드 정렬/집계 → `fielddata` 폭탄**
`text` 필드로 정렬하거나 집계하면 `Fielddata is disabled` 에러가 납니다. 굳이 켜면(`fielddata=true`) **힙 메모리를 통째로 먹어** 노드가 죽습니다. 정답은 `keyword` 서브필드(`name.raw`)로 정렬·집계하는 것.

**② 매핑은 한 번 정해지면 못 바꾼다 → reindex**
이미 있는 필드의 타입(예: `text`→`keyword`)은 변경 불가입니다. 새 인덱스를 만들고 `_reindex` API로 옮긴 뒤 **별칭(alias)을 교체**하는 게 무중단 마이그레이션 패턴입니다. 운영 인덱스는 처음부터 `posts` 대신 별칭 `posts`(→ `posts-v1`)로 시작하세요.

**③ 색인 직후 검색이 안 됨 → near-real-time**
Elasticsearch는 색인 즉시 검색되지 않습니다. **refresh**(기본 1초)가 일어나야 보입니다. 테스트에서 저장 직후 검색이 0건이면 버그가 아니라 정상 — `operations.indexOps(Post.class).refresh()`로 강제하거나 잠깐 기다리면 됩니다. 반대로 **대량 색인 시엔 `refresh_interval`을 -1로 껐다가** 끝나고 되돌려야 throughput이 수 배 오릅니다.

**④ 한글이 통째로 한 토큰이 됨 → 분석기**
기본 `standard` 분석기는 한글을 형태소로 못 쪼갭니다. "검색엔진을"이 한 토큰이 되어 "검색"으로 안 잡히죠. **nori 플러그인**(`analysis-nori`)을 이미지에 설치하고 인덱스 분석기로 지정해야 합니다.

```java
@Document(indexName = "posts")
@Setting(settingPath = "es/nori-settings.json")   // nori analyzer 정의
public class Post {
    @Field(type = FieldType.Text, analyzer = "korean")
    private String title;
}
```

```dockerfile
# nori는 기본 미포함 → 이미지에 설치
RUN bin/elasticsearch-plugin install --batch analysis-nori
```

## 디버깅: 분석 결과를 직접 눈으로 확인

"왜 안 잡히지?"의 99%는 `_analyze`로 끝납니다. 색인된 term이 무엇인지 직접 봅니다.

```bash
curl -X POST "localhost:9200/posts/_analyze" -H 'Content-Type: application/json' -d'
{ "analyzer": "korean", "text": "스프링 부트 검색엔진" }'
# → 토큰들이 나옴: 색인된 term과 검색어 term이 일치하는지 비교
```

매핑이 의도대로 됐는지는 `GET /posts/_mapping`, 어떤 쿼리가 매칭했는지는 검색에 `"explain": true`.

## 면접/리뷰 단골 질문

- **Q. `match`와 `term`의 차이는?** → `match`는 검색어를 **분석기로 토큰화**해 역색인과 비교(전문 검색), `term`은 분석 없이 **정확히** 비교. `text` 필드에 `term`을 쓰면 보통 안 잡힌다.
- **Q. `text`로 정렬이 안 되는 이유는?** → `text`는 토큰화되어 역색인에만 들어가고 원본 정렬 자료구조(doc values)가 없다. 정렬·집계는 `keyword`(doc values)로 해야 한다.
- **Q. 색인 직후 검색이 0건인데 버그인가?** → 아니다. NRT라 refresh(기본 1s) 전엔 안 보인다. 대량 색인은 refresh를 끄고 throughput을 올린다.

## 정리

- `text`는 **색인·검색 양쪽에서 같은 분석기**로 토큰화되어 역색인에 들어간다 → `match`로 검색. `keyword`는 분석 없이 정확 매칭·정렬·집계용.
- Spring Data Elasticsearch 5.x는 새 **`ElasticsearchClient`** 기반. 리포지토리는 JPA와 같은 **프록시**, 복잡 쿼리는 `ElasticsearchOperations` + `NativeQuery` 람다 DSL.
- 함정: `text` 정렬/집계(`fielddata`)·매핑 변경 불가(reindex+alias)·NRT(refresh)·한글(nori).
- 막히면 코드 말고 **`_analyze`로 토큰을 직접 확인**하라.

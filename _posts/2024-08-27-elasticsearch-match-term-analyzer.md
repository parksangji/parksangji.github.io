---
title: "검색의 핵심: match vs term, 그리고 분석기(Analyzer)"
date: 2024-08-27 11:00:00 +0900
series: "Elasticsearch"
categories: [Search, Elasticsearch]
tags: [elasticsearch, analyzer, match, term, query-dsl]
mermaid: true
image:
  path: /assets/img/posts/elasticsearch-match-term-analyzer.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnTGzEkDimMhUZxTmlcZUHioiT3NUZpaD4U82VUzjccVsXGgeVbvIs4YqMkVjQyeVMj4ztOa2Z9cjkgkRISpcY60ncZjP940w0UUwWwlFFFAz/2Q=="
  alt: "Elasticsearch match vs term과 분석기"
---

## "분명 있는데 검색이 안 돼요"

Elasticsearch를 처음 쓸 때 가장 헷갈렸던 건, **`term` 쿼리로 검색했는데 결과가 안 나오는** 현상이었습니다. 분명 그 단어가 문서에 있는데도요. 원인은 **분석기(analyzer)** 와 **match/term의 차이**를 몰라서였습니다.

## 분석기: text를 토큰으로 쪼개는 과정

`text` 필드는 색인될 때 **분석기**를 거칩니다. 분석기는 보통 세 단계입니다.

```mermaid
flowchart LR
    A["원문<br/>'Spring Boot 입니다!'"] --> B["문자 필터<br/>(특수문자 등 정리)"]
    B --> C["토크나이저<br/>공백/규칙으로 분리"]
    C --> D["토큰 필터<br/>소문자화 등"]
    D --> E["색인 토큰<br/>[spring, boot, 입니다]"]
```

기본 분석기(standard)는 소문자화까지 합니다. 그래서 원문이 `"Spring"`이어도 색인엔 `"spring"`(소문자)으로 들어갑니다. **이게 핵심입니다.**

## match vs term

- **match**: 검색어도 **분석기를 거친 뒤** 매칭. 전문 검색용.
- **term**: 검색어를 **분석하지 않고 그대로** 색인된 토큰과 비교. 정확 일치용.

이제 아까의 미스터리가 풀립니다.

```json
// 색인엔 'spring'(소문자)로 저장됨

// match: 'Spring' → 분석 → 'spring' → 매칭 O
GET /posts/_search
{ "query": { "match": { "title": "Spring" } } }

// term: 'Spring'(대문자 그대로)을 색인의 'spring'과 비교 → 매칭 X !!
GET /posts/_search
{ "query": { "term": { "title": "Spring" } } }
```

`term`이 안 먹은 이유는, 검색어 `"Spring"`은 분석되지 않은 채로 색인된 `"spring"`과 글자 그대로 비교됐기 때문입니다.

## 그래서 규칙

- **text 필드 전문 검색 → `match`** (검색어도 분석되어야 일치)
- **keyword 필드 정확 일치/필터 → `term`** (분석 안 된 값끼리 비교)

```json
// 권장 조합
{ "query": { "match": { "title": "spring boot" } } }   // text 검색
{ "query": { "term":  { "status": "PUBLISHED" } } }     // keyword 필터
```

`term`을 `text` 필드에 쓰면 십중팔구 의도와 다르게 동작합니다.

## 분석 결과를 직접 확인하기

"이 텍스트가 어떤 토큰으로 쪼개지나"는 `_analyze` API로 바로 볼 수 있습니다. 디버깅의 핵심 도구입니다.

```json
GET /posts/_analyze
{
  "field": "title",
  "text": "Spring Boot 입니다!"
}
// → 토큰: spring, boot, 입니다
```

> 한국어는 standard 분석기로는 형태소 분리가 약합니다. 실서비스 한글 검색엔 **Nori** 같은 한국어 형태소 분석기 플러그인을 쓰는 게 좋습니다.
{: .prompt-tip }

## 정리

- `text`는 색인 시 **분석기**로 토큰화(소문자화 등)된다.
- **match**: 검색어도 분석 후 비교(전문 검색). **term**: 분석 없이 그대로 비교(정확 일치).
- `term`이 안 먹으면 십중팔구 분석기/대소문자 때문 → `_analyze`로 확인.
- 한글은 **Nori** 분석기 고려.

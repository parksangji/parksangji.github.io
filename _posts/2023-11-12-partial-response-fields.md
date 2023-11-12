---
title: "필요한 필드만 골라 응답하기 — Sparse Fieldset"
date: 2023-11-12 10:30:00 +0900
categories: [Backend]
tags: [api, field-selection, sparse-fieldset, payload, bandwidth]
description: "과대 페이로드의 비용과 클라이언트별 필드 선택(sparse fieldset) 설계. 모바일 대역폭을 줄이는 부분 응답을 다룬다."
---

목록 화면을 가볍게 만들려고 응답 구조를 손본 주가 있었다. 핵심은 단순하다. **모든 화면이 같은 양의 데이터를 필요로 하지 않는다.** 그런데 우리는 보통 하나의 DTO를 만들어 모든 엔드포인트에서 똑같이 내려준다. 모바일 리스트에는 이름과 썸네일만 필요한데, 상세 화면용 30개 필드가 통째로 따라간다. 이 낭비를 줄이는 기법이 부분 응답, 즉 sparse fieldset이다.

## 과대 페이로드의 진짜 비용

응답이 크면 단지 바이트가 늘어나는 것이 아니다. 세 군데에서 동시에 비용이 발생한다.

1. **직렬화 비용** — 서버가 객체를 JSON으로 변환하는 CPU. 필드가 많을수록 Jackson이 더 많은 getter를 호출하고 더 많은 문자열을 만든다.
2. **전송 비용** — 모바일·저대역폭 환경에서 페이로드 크기는 곧 응답 지연이다. 특히 lazy-loaded 연관을 직렬화하다 N+1 쿼리까지 끌려가면 DB 부하로 번진다.
3. **역직렬화 비용** — 클라이언트가 안 쓸 필드까지 파싱한다.

리스트 응답이 항목당 2KB에서 0.3KB로 줄면, 50개 목록에서 100KB가 15KB가 된다. 모바일 3G/혼잡 네트워크에서 체감 차이는 크다.

## 필드 선택의 동작 원리

클라이언트가 `?fields=id,name,thumbnailUrl`처럼 원하는 필드를 명시하면, 서버는 그 필드만 골라 응답한다. 핵심은 **어느 계층에서 잘라내느냐**다.

- **직렬화 단계에서 자르기** — DB는 전부 조회하고 JSON 변환 시점에만 제외. 구현이 쉽지만 DB 부하는 그대로다.
- **쿼리 단계에서 자르기** — 요청한 필드만 SELECT. 진짜 절감이지만 쿼리 빌더가 필요하고 동적 SQL이 복잡해진다.

실무에서는 보통 직렬화 단계부터 시작한다. 대역폭 문제가 먼저고, DB는 그다음이기 때문이다.

```java
// 동적 필드 필터링 (직렬화 단계)
public MappingJacksonValue userResponse(User user, String fields) {
    MappingJacksonValue wrapper = new MappingJacksonValue(user);
    if (fields != null && !fields.isBlank()) {
        Set<String> allowed = Set.of(fields.split(","));
        // 화이트리스트로 한정 — 임의 필드 노출 차단
        Set<String> safe = allowed.stream()
                .filter(ALLOWED_FIELDS::contains)
                .collect(Collectors.toSet());
        SimpleBeanPropertyFilter filter =
                SimpleBeanPropertyFilter.filterOutAllExcept(safe);
        wrapper.setFilters(new SimpleFilterProvider()
                .addFilter("userFilter", filter));
    }
    return wrapper;
}
```

DTO에는 `@JsonFilter("userFilter")`를 붙인다. `ALLOWED_FIELDS` 화이트리스트로 막아야 하는 이유는 아래 함정에서 다룬다.

## 운영 함정

**1) 필터를 화이트리스트로 막지 않으면 정보 노출이 된다.** 클라이언트가 `fields=passwordHash,internalNote`를 넣었을 때 서버가 그대로 내려주면 사고다. 요청 필드는 반드시 허용 집합과 교집합만 통과시킨다.

**2) 캐시 키가 폭발한다.** `fields` 파라미터마다 응답이 다르면, URL 단위 캐시(CDN, 리버스 프록시)의 캐시 키가 조합 수만큼 늘어난다. 캐시 적중률이 떨어지고 메모리가 낭비된다. 대응책은 프리셋화다. 임의 조합 대신 `view=summary|detail` 같은 소수의 미리 정의된 뷰만 허용하면, 캐시 키도 유연성도 균형을 맞춘다.

## 핵심 요약

- 하나의 DTO를 모든 엔드포인트가 공유하면 과대 페이로드가 생긴다. 직렬화·전송·역직렬화 모두 비용이다.
- 필드 선택은 직렬화 단계부터 시작하되, **화이트리스트 필수**.
- 임의 `fields` 조합은 캐시를 깨뜨린다. 소수의 뷰 프리셋이 현실적 타협점이다.

> Q. sparse fieldset의 가장 큰 운영 리스크는?
> A. 화이트리스트 없이 임의 필드를 허용하면 민감 필드가 노출되고, 조합별 응답이 달라져 캐시 적중률이 무너진다.

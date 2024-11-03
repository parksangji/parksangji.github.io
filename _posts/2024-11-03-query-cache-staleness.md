---
title: "같은 쿼리 결과를 캐싱할 때의 신선도"
date: 2024-11-03 10:30:00 +0900
categories: [Infra]
tags: [query-cache, staleness, ttl, invalidation, read-heavy]
description: "읽기가 압도적으로 많은 조회를 캐싱할 때 TTL을 어떻게 정하고, 쓰기와의 무효화를 어떻게 맞추는가. 적중률과 신선도의 트레이드오프를 메커니즘 수준에서 다룬다."
---

거의 안 바뀌는데 자주 조회되는 데이터가 있다. 카테고리 목록, 설정 값, 인기 상품 같은 것들이다. 매 요청마다 같은 쿼리를 DB로 보내는 건 낭비다. 결과를 캐시에 올려두면 DB 부하가 급감한다. 그런데 캐시를 붙이는 순간 새 질문이 따라온다. **"이 캐시는 얼마나 오래된 값을 보여줘도 되는가."** 캐시 설계의 본질은 적중률이 아니라 이 **신선도(staleness) 협상**이다.

## 핵심 개념: 적중률과 신선도의 트레이드오프

캐시 결과는 본질적으로 **과거 시점의 스냅샷**이다. TTL(time-to-live)은 *"이 스냅샷을 얼마나 믿을 것인가"*를 시간으로 정한 값이다.

- TTL을 **길게** 잡으면 적중률↑, DB 부하↓ — 대신 데이터가 바뀌어도 TTL이 끝날 때까지 **옛 값**이 나간다(staleness↑).
- TTL을 **짧게** 잡으면 신선도↑ — 대신 캐시가 자주 비어 DB를 더 자주 때린다(적중률↓).

이 둘은 동시에 만족할 수 없다. 그래서 캐시 TTL은 *"이 데이터가 몇 초쯤 옛것이어도 비즈니스가 괜찮은가"*라는 질문에 답해서 정한다. 가격·재고처럼 틀리면 안 되는 값은 짧게(혹은 캐시 안 함), 카테고리 트리처럼 바뀜이 드문 값은 길게.

## TTL만으로는 부족하다: 쓰기 시점 무효화

TTL은 "최악의 staleness 상한"일 뿐이다. 데이터가 바뀌었는데 TTL이 한참 남았다면 그동안 계속 틀린 값이 나간다. 그래서 **쓰기가 일어나면 TTL을 기다리지 말고 해당 캐시를 즉시 무효화**한다. 두 메커니즘을 함께 쓴다.

- **TTL**: 무효화를 놓친 경우의 안전망(eventual 신선도 보장).
- **쓰기 시 무효화(write-through invalidation)**: 정상 경로에서 즉시 신선도 보장.

```java
@Service
public class CategoryService {

    @Cacheable(value = "categories", key = "#parentId")
    public List<Category> children(long parentId) {
        return categoryMapper.findChildren(parentId); // 캐시 미스일 때만 DB
    }

    @CacheEvict(value = "categories", key = "#category.parentId")
    @Transactional
    public void update(Category category) {
        categoryMapper.update(category); // 쓰면 해당 부모 캐시만 비움
    }
}
```

```yaml
# Caffeine 설정 예 — TTL은 안전망
spring:
  cache:
    caffeine:
      spec: maximumSize=10000,expireAfterWrite=10m
```

## 운영 함정

**1) 캐시 스탬피드(stampede).** 인기 키의 TTL이 만료되는 순간, 그 키를 기다리던 수백 요청이 *동시에* 캐시 미스를 맞고 전부 DB로 몰린다. 평소엔 한가하던 DB가 TTL 경계마다 스파이크를 맞는다. 해법은 캐시 미스 시 **하나의 요청만 DB를 로드하게 락(single-flight)** 을 걸고 나머지는 기다리게 하거나, 만료 직전 백그라운드로 미리 갱신(refresh-ahead)하는 것이다.

**2) 무효화 범위가 너무 넓거나 좁다.** 키 하나만 비워야 하는데 캐시 전체를 비우면(`allEntries=true` 남발) 적중률이 무너진다. 반대로 연관된 캐시(예: 목록 캐시와 상세 캐시)를 함께 안 비우면 일부만 신선해진다. **쓰기 1회가 무효화해야 할 키 집합**을 정확히 정의해 둬야 한다.

**3) 분산 환경에서의 로컬 캐시 불일치.** 인스턴스마다 가진 로컬 캐시(Caffeine 등)는 한 인스턴스에서 무효화해도 다른 인스턴스엔 옛 값이 남는다. 여러 인스턴스가 공유해야 하면 중앙 캐시(Redis 등)를 쓰거나, 무효화 이벤트를 인스턴스에 브로드캐스트한다.

## 핵심 요약

- 캐시는 과거 스냅샷이다. 설계의 본질은 **"몇 초까지 옛것이어도 되나"**(신선도 예산).
- **TTL = 안전망**, **쓰기 시 무효화 = 즉시 신선도.** 둘을 함께 쓴다.
- TTL 경계의 **스탬피드**, **무효화 범위**, **분산 로컬 캐시 불일치**가 3대 함정이다.

---
title: "캐시 추상화: @Cacheable과 self-invocation 함정"
date: 2026-06-04 10:30:00 +0900
series: "Spring Boot"
categories: [Backend, Spring Boot]
tags: [spring-boot, cache, cacheable, redis]
image:
  path: /assets/img/posts/springboot-cache-abstraction.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnTEzEkDvTZImjGSMU4yupIB4zUckjP940IkaASQB1NX5dIuY7bz2X5MZqgrFWBHUVp3Gu3E9mLZsBcYNJ3uBnP980w0UU0AlFFFMZ/9k="
  alt: "Spring 캐시 추상화와 @Cacheable"
---

## 같은 조회를 매번 DB까지 가는 게 아까울 때

자주 바뀌지 않는데 조회는 많은 데이터(예: 카테고리 목록, 환율)는 매번 DB를 때리는 게 낭비입니다. Spring의 **캐시 추상화**를 쓰면, 캐시 저장소(로컬, Redis 등)에 상관없이 **애너테이션만으로** 캐싱을 적용할 수 있습니다.

## 켜고 쓰기

먼저 `@EnableCaching`으로 활성화합니다.

```java
@Configuration
@EnableCaching
public class CacheConfig { }
```

그다음 메서드에 애너테이션을 붙입니다.

```java
@Service
public class ProductService {

    @Cacheable(value = "product", key = "#id")
    public Product find(Long id) {
        // 캐시에 없을 때만 실행됨. 결과가 'product' 캐시에 저장됨
        return productRepository.findById(id).orElseThrow();
    }

    @CacheEvict(value = "product", key = "#product.id")
    public void update(Product product) {
        productRepository.save(product);   // 변경 시 해당 캐시 무효화
    }
}
```

- `@Cacheable`: 있으면 캐시 반환, 없으면 실행 후 저장
- `@CacheEvict`: 캐시 제거(데이터 변경 시)
- `@CachePut`: 항상 실행하고 결과로 캐시 갱신

## 또 그 함정: self-invocation

`@Transactional`과 **완전히 같은 함정**이 캐시에도 있습니다. 캐시 역시 **AOP 프록시**로 동작하므로, 같은 클래스 안에서 `@Cacheable` 메서드를 **직접 호출**하면 캐시가 동작하지 않습니다.

```java
@Service
public class ProductService {

    public Product getOrLoad(Long id) {
        return find(id);   // ❌ this.find() → 프록시 안 거침 → 캐시 무시
    }

    @Cacheable("product")
    public Product find(Long id) { ... }
}
```

[@Transactional 함정 글](/posts/springboot-transactional-pitfalls/)에서 다룬 것과 똑같은 원리예요. 해결도 동일합니다 — 호출을 별도 Bean으로 분리하거나 구조를 바꿉니다.

## Redis로 캐시 저장소 바꾸기

로컬 캐시는 서버가 여러 대면 인스턴스마다 따로 캐싱돼서 일관성이 깨집니다. 분산 환경에선 **Redis** 같은 공용 캐시를 씁니다. 의존성과 설정만 바꾸면 **코드(@Cacheable)는 그대로**입니다 — 이게 추상화의 힘이죠.

```gradle
implementation 'org.springframework.boot:spring-boot-starter-data-redis'
implementation 'org.springframework.boot:spring-boot-starter-cache'
```

```yaml
spring:
  cache:
    type: redis
  data:
    redis:
      host: localhost
      port: 6379
```

## 주의점

- **TTL(만료)** 을 꼭 설정하세요. 안 그러면 오래된 데이터가 영원히 남습니다. (`RedisCacheConfiguration.entryTtl(...)`)
- **null 캐싱** 여부를 정하세요. 존재하지 않는 키를 매번 조회하면 캐시가 무용지물(캐시 관통)이 됩니다.
- 캐시 키 설계를 신중히. `key` SpEL이 의도대로 유일한지 확인.
- 데이터 변경 경로에서 **반드시 `@CacheEvict`/`@CachePut`** 으로 정합성을 맞추세요.

## 정리

- `@EnableCaching` + `@Cacheable`/`@CacheEvict`/`@CachePut`로 선언적 캐싱.
- **self-invocation 함정**은 `@Transactional`과 동일(AOP 프록시).
- 저장소는 Redis 등으로 바꿔도 **애너테이션 코드는 그대로**.
- **TTL·null 캐싱·키 설계·무효화**를 반드시 챙기자.

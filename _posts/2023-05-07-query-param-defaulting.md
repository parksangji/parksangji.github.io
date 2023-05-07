---
title: "파라미터 기본값과 경계값을 서버가 정한다"
date: 2023-05-07 10:30:00 +0900
categories: [Backend]
tags: [default-value, boundary, page-size, clamp, validation]
description: "page/size가 안 오거나 비정상일 때 서버가 어떻게 방어하는가. 기본값, 상한 클램핑(DoS 방지), 잘못된 정렬키 처리까지 목록 파라미터 처리의 정석."
---

이번 주는 목록 화면의 요청 파라미터(페이지 번호, 크기, 정렬)를 다듬었다. 여기서 배운 원칙 하나: **파라미터의 기본값과 경계값은 클라이언트가 아니라 서버가 정한다.** 클라이언트 입력은 언제나 누락되거나 비정상일 수 있는 외부 데이터다.

## 왜 서버가 정해야 하는가

클라이언트는 신뢰할 수 없다. 정상 화면에서는 `page=0&size=20`을 보내겠지만, 누군가는 파라미터를 빼고 호출하고, 누군가는 `size=1000000`을 직접 입력한다. 봇은 의도적으로 극단값을 던진다. 서버가 입력을 그대로 믿으면 두 가지가 깨진다.

1. **누락**: `size`가 없으면 null이 되어 쿼리가 깨지거나 전 행을 긁는다.
2. **과도한 값**: `size=1000000`은 DB가 백만 행을 메모리에 올리게 만든다 — 사실상 한 요청으로 인스턴스를 마비시키는 **DoS 벡터**다.

그래서 서버는 모든 목록 파라미터에 대해 **기본값(default)과 상한(clamp)을 강제**해야 한다. 이건 검증을 넘어 가용성 방어다.

## 클램핑의 원리

클램핑은 입력을 허용 범위 `[min, max]`로 강제로 끌어다 놓는 것이다. 거부(예외)가 아니라 보정이라는 점이 중요하다 — 사용자는 잘못된 size를 보내도 합리적인 결과를 받고, 서버는 보호된다.

```java
public final class PageRequestFactory {
    private static final int DEFAULT_SIZE = 20;
    private static final int MAX_SIZE     = 100;

    public static PageQuery of(Integer page, Integer size, String sort) {
        int p = (page == null || page < 0) ? 0 : page;
        int s = (size == null) ? DEFAULT_SIZE
                                : Math.min(Math.max(size, 1), MAX_SIZE); // clamp
        String orderBy = SORT_WHITELIST.getOrDefault(sort, "created_at DESC");
        return new PageQuery(p, s, orderBy);
    }
}
```

`Math.min(Math.max(size, 1), MAX_SIZE)`가 클램프의 정석이다. 1 미만은 1로, 100 초과는 100으로 접는다. 이러면 어떤 size가 들어와도 쿼리에 들어가는 값은 항상 `[1, 100]`이다.

## 정렬키는 화이트리스트로

정렬 컬럼은 절대 입력값을 그대로 쿼리에 넣지 않는다. 위 코드의 `SORT_WHITELIST`처럼 허용된 키→안전한 ORDER BY 문자열로 매핑하고, 매칭되지 않으면 기본 정렬로 떨어뜨린다. 이건 인젝션 방어인 동시에, 인덱스 없는 컬럼 정렬로 인한 풀스캔을 막는 안정성 장치이기도 하다.

```java
private static final Map<String, String> SORT_WHITELIST = Map.of(
    "newest", "created_at DESC",
    "oldest", "created_at ASC",
    "name",   "name ASC"
);
```

## 어디에 둘 것인가

이 보정 로직은 컨트롤러 곳곳에 흩지 말고 **한 곳에 모은다**. Spring이라면 `@ModelAttribute`로 바인딩되는 PageCommand 객체에 보정 메서드를 두거나, 위처럼 팩토리/Argument Resolver로 중앙화한다. 그래야 새 목록 API를 추가할 때마다 클램핑을 빠뜨리지 않는다. 방어는 "모든 입구에서 동일하게" 적용돼야 의미가 있다.

## 운영 함정

- **음수/0 페이지**: `page=-1`은 OFFSET 음수로 SQL 에러를 내거나 의도치 않은 결과를 준다. 0 미만은 0으로 보정한다.
- **page * size 오버플로**: 매우 큰 page에서 `OFFSET = page * size`가 int 범위를 넘거나, 깊은 OFFSET 자체가 느려진다. 페이지 상한도 두거나 keyset 페이징을 고려한다.
- **기본값이 코드마다 다르면** 같은 목록인데 화면마다 페이지 크기가 달라진다. 상수는 한 곳에서 관리한다.

## 핵심 요약

- 목록 파라미터의 **기본값·상한은 서버가 강제**한다 — 누락과 극단값은 항상 온다.
- `size` 클램핑은 단순 검증이 아니라 **DoS 방어**다.
- 정렬키는 **화이트리스트 매핑**으로 인젝션과 풀스캔을 동시에 막는다.

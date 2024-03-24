---
title: "검색 조건을 객체로 다루는 쿼리 빌더"
date: 2024-03-24 10:30:00 +0900
categories: [Backend]
tags: [query-builder, criteria, dynamic-sql, maintainability, search]
description: "조건이 늘 때마다 if 분기가 폭증하는 동적 SQL을, 검색 조건 객체와 빌더로 조립해 유지보수 가능하게 만드는 설계."
---

검색 조건이 십수 개로 불어나는 화면을 다룬 주가 있었다. 키워드, 상태, 기간, 정렬, 페이징… 조건이 늘 때마다 SQL의 `if` 분기가 기하급수로 늘었다. 핵심은 **검색 조건을 흩어진 분기가 아니라 하나의 객체로 다루는 것**이다.

## 왜 분기 폭증이 문제인가

동적 SQL을 if로 쌓으면 조건 N개에 대해 코드는 N개의 if지만, **테스트해야 하는 조합은 2^N**이다. 어떤 조건 조합에서 `WHERE`와 `AND`가 어긋나 문법 오류가 나는지, 어디서 인덱스를 못 타는지 추적하기 어렵다. 더 나쁜 건 같은 검색 로직이 목록·엑셀다운로드·카운트 세 곳에 복붙되어 따로 썩는 것이다.

해법의 본질은 **표현(검색 조건 = 데이터)과 변환(조건 → SQL = 로직)을 분리**하는 것이다. 조건을 객체에 담아 한 번 만들고, 빌더가 그 객체를 일관되게 SQL/파라미터로 변환한다.

## 코드: 조건 객체 + 빌더

```java
public record ProductSearch(
    String keyword,
    List<String> categories,
    Integer minPrice,
    Integer maxPrice,
    SortKey sort
) {}
```

MyBatis라면 동적 SQL을 `<where>`로 감싸 AND 접두/접미를 자동 정리한다.

```xml
<select id="search" resultType="Product">
  SELECT * FROM product
  <where>
    <if test="keyword != null and keyword != ''">
      AND name LIKE CONCAT('%', #{keyword}, '%')
    </if>
    <if test="categories != null and !categories.isEmpty()">
      AND category IN
      <foreach collection="categories" item="c" open="(" separator="," close=")">
        #{c}
      </foreach>
    </if>
    <if test="minPrice != null"> AND price &gt;= #{minPrice} </if>
    <if test="maxPrice != null"> AND price &lt;= #{maxPrice} </if>
  </where>
  ORDER BY ${@com.example.SortKey@toColumn(sort)}
</select>
```

`<where>`는 자식 중 첫 조건의 선두 `AND/OR`를 떼어내고, 조건이 하나도 없으면 `WHERE` 절 자체를 생략한다. 이게 if 폭증의 가장 흔한 버그(`WHERE AND ...`)를 구조적으로 막아준다.

순수 자바 빌더로 짜면 의도가 더 드러난다.

```java
QueryBuilder qb = new QueryBuilder("SELECT * FROM product");
search.keyword().ifPresentLike("name", qb);
qb.in("category", search.categories());
qb.gte("price", search.minPrice());
String sql = qb.where().orderBy(search.sort()).build();
```

## 운영 함정

**1. 정렬·컬럼명을 문자열로 받기.** 동적 ORDER BY는 바인딩 파라미터가 안 되므로 문자열을 SQL에 직접 박는데, 사용자 입력을 그대로 넣으면 **SQL 인젝션**이다. 반드시 `enum` 화이트리스트(`SortKey`)로 컬럼명을 매핑한다. MyBatis `${}`는 치환이지 바인딩이 아님을 늘 의식해야 한다.

**2. 인덱스를 죽이는 LIKE.** `LIKE '%kw%'`는 선두 와일드카드라 인덱스 풀스캔이 된다. 조건 객체가 깔끔해도 쿼리는 느릴 수 있으니, 전방 일치나 풀텍스트 인덱스로 분기하는 것까지 빌더가 책임지면 좋다.

## 핵심 요약

- 검색 조건을 객체로 모으면 분기(코드)와 조합(테스트)이 분리되어 유지보수성이 오른다.
- MyBatis `<where>`는 AND 접두 정리로 동적 SQL 문법 버그를 구조적으로 제거한다.
- 동적 컬럼/정렬은 enum 화이트리스트로만 받아 인젝션을 차단한다.

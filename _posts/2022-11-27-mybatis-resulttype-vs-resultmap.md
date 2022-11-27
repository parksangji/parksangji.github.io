---
title: "resultType vs resultMap, 무엇을 언제"
date: 2022-11-27 10:30:00 +0900
categories: [Backend]
tags: [mybatis, result-type, result-map, mapping, type-safety]
description: "평평한 결과는 resultType, 연관·중첩은 resultMap. Map 반환의 유혹과 위험, 그리고 타입 안정성까지 MyBatis 매핑 선택의 기준을 정리한다."
---

조회 결과를 어떤 형태로 받을지 정하는 일은 사소해 보이지만, 매핑 전략 하나가 코드의 타입 안정성과 유지보수성을 좌우한다. MyBatis에서 SELECT 결과를 객체로 받는 길은 크게 `resultType`과 `resultMap` 두 가지다. 둘은 경쟁 관계가 아니라 다른 문제를 푼다.

## resultType — 컬럼명을 프로퍼티에 자동 매핑

`resultType`은 "이 SELECT 결과 한 행을 이 클래스 하나에 담아라"는 지시다. MyBatis는 결과셋의 컬럼명과 대상 클래스의 프로퍼티명을 매칭해 자동으로 setter를 호출한다. 컬럼명이 `user_name`이고 프로퍼티가 `userName`이라면 `mapUnderscoreToCamelCase` 설정으로 스네이크-카멜 변환까지 처리한다.

핵심은 **이 매핑이 1:1 평면 매핑이라는 점**이다. 결과의 모든 컬럼이 한 객체의 한 프로퍼티에 대응할 때, 즉 중첩 구조나 컬렉션이 없을 때 가장 간결하다.

```xml
<select id="findUser" resultType="com.example.User">
  SELECT id, user_name, email, created_at
  FROM users
  WHERE id = #{id}
</select>
```

```java
public class User {
    private Long id;
    private String userName;
    private String email;
    private LocalDateTime createdAt;
    // getters/setters
}
```

## resultMap — 명시적 매핑과 중첩 구조

`resultMap`은 매핑을 직접 선언한다. 컬럼명과 프로퍼티명이 다르거나, 한 객체 안에 다른 객체(`association`)나 리스트(`collection`)를 채워야 할 때 쓴다. 자동 매핑이 표현하지 못하는 구조를 다루는 도구다.

```xml
<resultMap id="orderMap" type="com.example.Order">
  <id     column="order_id"   property="id"/>
  <result column="order_no"   property="orderNo"/>
  <association property="customer" javaType="com.example.Customer">
    <id     column="cust_id"   property="id"/>
    <result column="cust_name" property="name"/>
  </association>
</resultMap>

<select id="findOrder" resultMap="orderMap">
  SELECT o.order_id, o.order_no, c.cust_id, c.cust_name
  FROM orders o JOIN customers c ON o.cust_id = c.cust_id
  WHERE o.order_id = #{id}
</select>
```

`<id>` 태그는 단순 표기가 아니다. MyBatis는 `id`로 지정된 컬럼 값으로 **행을 식별**해, 같은 부모 객체에 속한 여러 행을 하나로 접는다(collection 매핑 시 결정적). `<id>`를 빼면 모든 컬럼을 비교해 동일성을 판단하므로 느리고, 중첩 매핑에서 중복 객체가 생길 수 있다.

## Map 반환의 유혹과 위험

`resultType="map"`으로 받으면 DTO 클래스를 안 만들어도 되어 편하다. 하지만 대가가 크다.

- **타입 안정성 상실**: `map.get("amount")`는 `Object`다. 컴파일러가 도와주지 않고, 캐스팅 실수가 런타임에야 터진다.
- **키 오타가 침묵한다**: 존재하지 않는 키는 예외 없이 `null`을 반환한다.
- **계약 불명확**: 메서드 시그니처가 `Map`이면 어떤 필드가 오는지 호출부에서 알 수 없다. 자동완성도 안 된다.

빠른 프로토타입이나 동적 컬럼 집계가 아니라면 Map 반환은 피한다. DTO를 만드는 1분이 디버깅 1시간을 막는다.

## 운영 함정

**부분 매핑 시 자동 매핑 모드.** `resultMap`을 쓰면서 일부 컬럼만 선언하면, `autoMappingBehavior`가 `PARTIAL`(기본)일 때 선언 안 한 컬럼은 이름 매칭으로 자동 채워진다. 의도치 않은 컬럼이 매핑되거나, 반대로 별칭을 잘못 줘서 조용히 `null`이 들어갈 수 있다. 명시적 매핑이 필요하면 `autoMappingBehavior=NONE`을 고려한다.

## 핵심 요약

- 결과가 평면 1:1이면 `resultType`. 연관/컬렉션 등 중첩이 있으면 `resultMap`.
- `resultMap`의 `<id>`는 행 식별 키이며 중첩 매핑의 정확성과 성능을 좌우한다.
- `Map` 반환은 타입 안정성과 계약을 버리는 행위다. 동적 집계가 아니면 DTO를 쓴다.

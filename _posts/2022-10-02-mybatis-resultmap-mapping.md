---
title: "resultMap: 컬럼과 객체를 잇는 다리"
date: 2022-10-02 10:30:00 +0900
categories: [Backend]
tags: [mybatis, resultmap, mapping, association, camelcase]
description: "MyBatis가 조회 결과 컬럼을 객체 프로퍼티로 잇는 방식, snake_case↔camelCase 자동 매핑의 원리와 한계, resultMap 명시 매핑과 조용한 null 함정을 정리한다."
---

조회 쿼리의 결과는 컬럼명을 가진 행의 집합이다. 이걸 자바 객체로 받으려면 **컬럼 이름과 객체의 프로퍼티 이름을 이어주는** 무언가가 필요하다. MyBatis는 이를 자동 매핑과 `resultMap` 두 갈래로 처리한다. 둘의 경계를 모르면, 분명히 조회됐는데 객체 필드가 `null`인 당혹스러운 버그를 만난다.

## 핵심 개념: 자동 매핑과 그 한계

MyBatis는 결과 컬럼명과 객체 setter(프로퍼티)명을 **대소문자 무시하고 일치**시켜 자동 매핑한다. 그런데 DB는 `created_at`(snake_case), 자바는 `createdAt`(camelCase)가 관례라 이름이 어긋난다. 이때 설정 `mapUnderscoreToCamelCase=true`를 켜면 MyBatis가 `created_at`을 `createdAt`으로 변환해 매핑한다.

```xml
<!-- mybatis-config.xml -->
<settings>
  <setting name="mapUnderscoreToCamelCase" value="true"/>
</settings>
```

자동 매핑의 한계는 분명하다. (1) **조인 결과를 중첩 객체로** 묶지 못한다(평면 컬럼만). (2) 컬럼명과 프로퍼티명이 규칙적으로 대응하지 않으면 매핑이 안 된다. (3) 타입 핸들러를 컬럼별로 지정할 수 없다. 이 한계를 넘으려면 `resultMap`을 명시한다.

## resultMap: 명시적 매핑

`resultMap`은 컬럼과 프로퍼티의 대응을 직접 선언한다. 별칭(alias)으로 컬럼명을 맞추는 방법도 있지만, `resultMap`은 중첩 객체 매핑까지 표현할 수 있어 더 강력하다.

```xml
<resultMap id="userMap" type="User">
  <id     column="id"          property="id"/>
  <result column="user_name"   property="name"/>
  <result column="email"       property="email"/>
  <!-- 1:1 연관 객체 매핑 -->
  <association property="dept" javaType="Dept">
    <id     column="dept_id"   property="id"/>
    <result column="dept_name" property="name"/>
  </association>
  <!-- 1:N 컬렉션 매핑 -->
  <collection property="orders" ofType="Order">
    <id     column="order_id"  property="id"/>
    <result column="amount"    property="amount"/>
  </collection>
</resultMap>

<select id="findUser" resultMap="userMap">
  SELECT u.id, u.user_name, u.email,
         d.dept_id, d.dept_name,
         o.order_id, o.amount
  FROM users u
  LEFT JOIN dept d  ON d.dept_id = u.dept_id
  LEFT JOIN orders o ON o.user_id = u.id
  WHERE u.id = #{id}
</select>
```

`<id>`는 단순 매핑이 아니다. MyBatis는 `<id>` 컬럼 값으로 **행이 같은 엔티티인지 식별**한다. 조인으로 한 사용자가 주문 수만큼 중복 행으로 나와도, 같은 `id`면 하나의 User로 묶고 `orders` 컬렉션에 주문만 누적한다. `<id>`를 빠뜨리면 같은 사용자가 여러 객체로 쪼개진다.

## 운영 함정: 조용한 null

가장 흔한 버그는 **매핑 누락이 예외 없이 null이 되는 것**이다. 쿼리에 `user_name`을 SELECT 했는데 자동 매핑 대상 프로퍼티가 `name`이고 underscore 변환이 꺼져 있으면, MyBatis는 대응을 못 찾아도 에러를 내지 않고 그냥 그 필드를 비워둔다. "쿼리는 맞는데 객체만 비어 있다"의 정체가 이것이다.

이를 빨리 잡으려면 설정 `autoMappingUnknownColumnBehavior`를 `WARNING`(또는 `FAILING`)으로 둔다. 매핑되지 않은 컬럼이 있을 때 로그/예외로 알려준다.

```xml
<setting name="autoMappingUnknownColumnBehavior" value="WARNING"/>
```

또 하나, 조인 매핑에서 **컬럼명 충돌**. `users.id`와 `orders.id`가 둘 다 `id`로 나오면 어느 쪽이 매핑될지 모호하다. SELECT에서 별칭(`u.id AS user_id`)으로 구분하고 resultMap도 그 별칭에 맞춘다.

## 면접 한 줄 Q&A

- **Q. snake_case 컬럼을 camelCase로 받으려면?** A. `mapUnderscoreToCamelCase=true`로 자동 변환하거나, resultMap/별칭으로 명시 매핑한다.
- **Q. resultMap의 `<id>` 역할은?** A. 행이 같은 엔티티인지 식별하는 키다. 조인으로 중복된 행을 하나의 객체로 묶고 컬렉션을 누적할 때 기준이 된다.

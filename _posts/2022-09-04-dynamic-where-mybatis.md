---
title: "동적 검색조건을 안전하게 조립하는 법"
date: 2022-09-04 10:30:00 +0900
categories: [Backend]
tags: [mybatis, dynamic-sql, trim, where, sql-injection]
description: "MyBatis <where>/<if>/<trim>로 빈 조건을 빼고 AND/OR 접두를 정리하는 법, #{}와 ${}의 결정적 차이, 동적 SQL이 만드는 실행계획 캐시 미스를 다룬다."
---

검색 폼에 입력칸이 여럿 있고, 사용자가 그중 일부만 채운다. 백엔드는 채워진 조건만 골라 WHERE 절을 만들어야 한다. 문자열을 직접 이어붙이면 빈 조건과 `AND` 접두 처리에서 금방 깨지고, 더 나쁘게는 SQL 인젝션 문이 열린다. MyBatis의 동적 SQL은 이 조립을 안전하고 선언적으로 풀어준다.

## 핵심 개념: <where>가 접두 AND를 지우는 원리

조건을 단순히 `<if>`로 나열하면 첫 조건 앞에 `AND`가 남거나, 모든 조건이 비면 `WHERE`만 덩그러니 남는다. `<where>` 태그는 이 둘을 자동 처리한다. 내부 조건이 하나라도 만들어지면 `WHERE`를 붙이고, **생성된 절의 맨 앞에 오는 `AND` 또는 `OR`를 제거**한다. 조건이 하나도 없으면 `WHERE` 자체를 출력하지 않는다.

`<where>`는 사실 `<trim>`의 특수형이다. `<trim prefix="WHERE" prefixOverrides="AND |OR ">`와 같다. 접두 후보를 직접 지정해야 할 때(예: `SET` 절의 후행 콤마 제거)는 `<trim>`을 쓴다.

```xml
<select id="search" resultType="User">
  SELECT id, name, email, status FROM users
  <where>
    <if test="name != null and name != ''">
      AND name LIKE CONCAT('%', #{name}, '%')
    </if>
    <if test="status != null">
      AND status = #{status}
    </if>
  </where>
  ORDER BY id DESC
</select>
```

`UPDATE`의 후행 콤마는 `<set>`이 처리한다.

```xml
<update id="update">
  UPDATE users
  <set>
    <if test="name != null">name = #{name},</if>
    <if test="email != null">email = #{email},</if>
  </set>
  WHERE id = #{id}
</update>
```

## #{}와 ${}: 인젝션을 가르는 한 글자

이것이 가장 중요하다. `#{}`는 **PreparedStatement의 바인딩 파라미터(`?`)**로 치환된다. 값은 SQL 문법 바깥에서 드라이버가 바인딩하므로, 사용자가 `' OR '1'='1`을 넣어도 그건 그냥 문자열 값일 뿐 SQL이 되지 못한다. 반면 `${}`는 **문자열을 그대로 SQL에 박아넣는다.** 사용자 입력을 `${}`로 받으면 곧장 인젝션이다.

```xml
<!-- 안전: 값은 항상 #{} -->
WHERE name = #{name}

<!-- 위험: 사용자 입력을 ${}로 받으면 인젝션 -->
WHERE name = '${name}'   <!-- 절대 금지 -->
```

`${}`가 필요한 경우는 **값이 아니라 식별자**(컬럼명, 정렬 방향 등)를 동적으로 바꿀 때뿐이다. 이때도 사용자 입력을 그대로 넣지 말고, 화이트리스트로 검증한 뒤 허용된 값만 통과시킨다.

```java
// 정렬 컬럼은 허용 목록으로 검증 후에만 ${}에 넘긴다
Set<String> allowed = Set.of("id", "name", "created_at");
String sort = allowed.contains(req.getSort()) ? req.getSort() : "id";
```

## 운영 함정: 실행계획 캐시 미스

동적 SQL의 그림자가 하나 있다. 조건 조합마다 **최종 SQL 텍스트가 달라진다.** DB는 SQL 텍스트(또는 그 해시)를 키로 실행계획을 캐시하는데, 조합이 폭증하면 캐시 적중률이 떨어지고 매번 파싱·플래닝 비용이 든다. `#{}` 바인딩 변수는 텍스트가 같아 계획을 공유하지만, `<if>`로 절 자체가 붙었다 떨어졌다 하면 그 자체로 다른 SQL이다. 검색 조합이 많은 화면이라면, 자주 쓰는 조합을 모니터링하고 핵심 조건엔 인덱스를 맞춰두는 것이 현실적이다.

## 면접 한 줄 Q&A

- **Q. `#{}`와 `${}` 차이는?** A. `#{}`는 PreparedStatement 바인딩이라 인젝션에 안전하고, `${}`는 문자열 치환이라 사용자 값에 쓰면 인젝션이 난다. `${}`는 컬럼명 같은 식별자에만, 화이트리스트 검증 후 쓴다.
- **Q. `<where>`는 무엇을 해주나?** A. 조건이 있으면 `WHERE`를 붙이고 맨 앞 `AND`/`OR`를 제거, 없으면 `WHERE`를 아예 안 붙인다.

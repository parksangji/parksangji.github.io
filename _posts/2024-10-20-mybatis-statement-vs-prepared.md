---
title: "#{} 와 ${}: 바인딩과 인젝션의 분기점"
date: 2024-10-20 10:30:00 +0900
categories: [Backend]
tags: [mybatis, prepared-statement, sql-injection, binding, order-by]
description: "MyBatis의 #{}와 ${}는 한 글자 차이지만 결과는 PreparedStatement 바인딩과 날 문자열 치환으로 갈린다. ORDER BY 같은 바인딩 불가 자리를 화이트리스트로 안전하게 처리하는 법."
---

동적 정렬을 붙여야 했다. 사용자가 고른 컬럼으로 `ORDER BY`를 바꾸는, 흔한 요구다. 그런데 정렬 컬럼명을 `#{}`로 넣으면 동작하지 않는다. 어쩔 수 없이 `${}`로 바꾸면 동작은 한다 — 그리고 그 순간 SQL 인젝션의 문이 열린다. MyBatis에서 `#{}`와 `${}`의 차이는 한 글자지만, 내부 동작은 완전히 다른 세계다.

## 핵심 개념: 왜 둘은 다른가

**`#{}` — PreparedStatement 파라미터 바인딩.** MyBatis가 SQL을 만들 때 `#{}` 자리에 값을 직접 끼워 넣지 않는다. 대신 자리표시자 `?`를 박고, 값은 JDBC `PreparedStatement.setXxx()`로 따로 전달한다.

```
-- mapper
SELECT * FROM users WHERE name = #{name}
-- 실제 DB로 가는 것
SELECT * FROM users WHERE name = ?     (+ 바인딩 값: "오'); DROP TABLE users;--")
```

값은 SQL 구문이 아니라 **데이터**로 전달되므로, 안에 어떤 따옴표나 세미콜론이 있어도 절대 구문으로 해석되지 않는다. 인젝션이 원천적으로 불가능하다. 덤으로 DB가 실행계획을 재사용(prepared statement caching)할 수 있어 성능도 좋다.

**`${}` — 문자열 치환.** SQL 텍스트에 값을 **그대로 이어 붙인다.** 파싱 전에 문자열로 합쳐지므로, 값 안의 내용이 곧 SQL 구문이 된다.

```
-- mapper
SELECT * FROM users ORDER BY ${sortColumn}
-- sortColumn = "name; DROP TABLE users--" 이면
SELECT * FROM users ORDER BY name; DROP TABLE users--
```

`${}`는 인젝션에 무방비다. **원칙: 값에는 무조건 `#{}`.**

## 그럼 ORDER BY는 왜 #{}가 안 되나

PreparedStatement의 `?`는 **값(value)** 자리에만 바인딩된다. 컬럼명, 테이블명, `ASC/DESC`, `LIMIT` 키워드 같은 **SQL의 구조(identifier)** 는 바인딩 대상이 아니다. DB가 실행계획을 세울 때 이미 결정돼 있어야 하는 부분이기 때문이다. 그래서 `ORDER BY ?`는 문법적으로 동작하지 않거나(드라이버에 따라 무시), 상수로 취급된다.

즉 정렬 컬럼은 구조적으로 `#{}`를 쓸 수 없고, `${}`를 써야 한다. 그러면 인젝션 위험은 어떻게 막는가. 답은 **값 검증이 아니라 화이트리스트**다.

## 안전한 동적 정렬: 화이트리스트

사용자 입력을 SQL에 흘리지 말고, **허용된 값으로만 매핑**한다. 입력은 "키"로만 쓰고 실제 컬럼명은 서버가 가진 고정 목록에서 고른다.

```java
private static final Map<String, String> SORTABLE = Map.of(
    "name",      "name",
    "createdAt", "created_at",
    "price",     "price"
);

public String resolveSort(String key, String dir) {
    String col = SORTABLE.get(key);
    if (col == null) throw new IllegalArgumentException("invalid sort: " + key);
    String d = "DESC".equalsIgnoreCase(dir) ? "DESC" : "ASC";
    return col + " " + d;
}
```

```xml
<!-- 서버가 검증·정규화한 값만 ${}로 들어온다 -->
SELECT * FROM products
<if test="orderBy != null"> ORDER BY ${orderBy} </if>
```

핵심은 *사용자 문자열이 SQL에 직접 닿지 않는다*는 것이다. 입력은 맵의 키로만 쓰이고, 매칭되지 않으면 즉시 거부된다. 정렬 방향도 `ASC`/`DESC` 둘 중 하나로만 강제한다.

## 운영 함정

**1) "이스케이프하면 되지 않나?"** 컬럼명은 따옴표로 감쌀 수 없으므로 값 이스케이프 기법이 통하지 않는다. 식별자는 **검증이 아니라 화이트리스트**가 유일하게 안전한 방법이다. 블랙리스트(위험 문자 제거)는 늘 우회된다.

**2) `LIKE`와 `#{}`의 조합.** `LIKE '%#{kw}%'`는 따옴표 안이라 바인딩이 안 된다. `CONCAT('%', #{kw}, '%')`나 `bind` 태그로 값을 만든 뒤 `#{}`로 바인딩해야 인젝션 없이 부분검색이 된다.

## 핵심 요약

- **값은 무조건 `#{}`** (PreparedStatement 바인딩 → 인젝션 불가, 계획 재사용).
- `${}`는 날 문자열 치환이라 인젝션에 무방비. **구조(컬럼명·ORDER BY·키워드)에만** 불가피하게 쓴다.
- `${}`를 쓸 땐 사용자 입력을 직접 넣지 말고 **화이트리스트로 매핑**한다.

> **면접 Q.** ORDER BY 컬럼을 동적으로 받는데 `#{}`가 안 된다. 어떻게 안전하게 처리하나?
> **A.** 식별자는 바인딩 대상이 아니라 `${}`를 써야 하는데, 사용자 입력을 직접 넣지 않고 허용 컬럼 화이트리스트의 키로만 받아 서버가 가진 컬럼명으로 매핑한다.

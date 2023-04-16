---
title: "SQL 인젝션: 문자열로 쿼리를 만들지 마라"
date: 2023-04-16 10:30:00 +0900
categories: [Backend]
tags: [sql-injection, prepared-statement, binding, whitelist, security]
description: "문자열 결합으로 만든 동적 쿼리가 왜 위험한가. 파라미터 바인딩이 인젝션을 원천 차단하는 원리와, 바인딩할 수 없는 정렬·컬럼명을 화이트리스트로 막는 법."
---

이번 주는 검색 조건이 동적으로 붙고 빠지는 화면을 다뤘다. 조건 개수가 가변적이면 쿼리를 코드로 조립하게 되는데, 여기서 한 발만 잘못 디디면 **SQL 인젝션**으로 직행한다.

## 왜 문자열 결합이 위험한가

인젝션의 본질은 **데이터와 코드가 같은 문자열에 섞이는 것**이다. 다음을 보자.

```java
String sql = "SELECT * FROM users WHERE name = '" + name + "'";
```

`name`에 `' OR '1'='1`이 들어오면 쿼리는 `... WHERE name = '' OR '1'='1'`이 되어 전체 행이 노출된다. `'; DROP TABLE users; --`라면 파괴적이다. DB 입장에선 어디까지가 개발자가 의도한 쿼리이고 어디부터가 사용자 입력인지 구분할 방법이 없다. 한 덩어리 문자열로 받았기 때문이다.

## 파라미터 바인딩이 막는 원리

PreparedStatement(MyBatis의 `#{}`)는 **쿼리 구조를 먼저 DB에 보내 파싱·컴파일하고, 값은 그 다음에 별도 채널로 바인딩**한다. 즉 실행 계획이 확정된 뒤에 값이 들어온다. 그러므로 값에 `OR '1'='1`이 들어와도 그것은 "name 컬럼과 비교할 하나의 문자열 리터럴"일 뿐, 쿼리 구조를 바꿀 수 없다. 데이터와 코드의 채널이 분리됐기 때문에 인젝션이 원천적으로 불가능하다. 부가로 실행 계획 캐시 재사용이라는 성능 이점도 따라온다.

```xml
<!-- 안전: 값은 바인딩 -->
<select id="search" resultType="User">
  SELECT id, name FROM users
  WHERE 1=1
  <if test="name != null">AND name = #{name}</if>
  <if test="status != null">AND status = #{status}</if>
</select>
```

MyBatis에서 `#{}`는 바인딩, `${}`는 **문자열 그대로 치환**이다. `${}`는 인젝션 통로이므로 사용자 입력에 절대 쓰지 않는다.

## 바인딩할 수 없는 것 — 화이트리스트

함정은 여기다. **정렬 컬럼이나 정렬 방향, 테이블명은 바인딩이 안 된다.** PreparedStatement는 값(value) 자리만 바인딩하지, 식별자(identifier)는 쿼리 구조의 일부라서 컴파일 시점에 확정돼야 한다. 그래서 정렬을 동적으로 받으면 결국 `${}`로 끼워 넣게 되고 인젝션이 열린다.

```java
String sortColumn = req.getParameter("sort"); // "price DESC; DROP ..." 가능
```

해법은 입력을 검증하는 게 아니라 **허용 목록으로 매핑**하는 것이다. 입력값을 그대로 쓰지 않고, 미리 정의한 안전한 값으로 치환한다.

```java
private static final Map<String, String> SORT_WHITELIST = Map.of(
    "name",  "name ASC",
    "newest","created_at DESC",
    "price", "price ASC"
);

String orderBy = SORT_WHITELIST.getOrDefault(req.sort(), "created_at DESC");
```

이러면 사용자가 무엇을 보내든 출력은 내가 정의한 문자열 중 하나로 고정된다. "블랙리스트로 위험 문자 제거"는 우회가 많아 신뢰할 수 없다. 식별자는 언제나 화이트리스트다.

## 운영 함정

- **LIKE 검색의 와일드카드**: `#{keyword}`로 바인딩해도 `%`, `_`는 사용자가 와일드카드로 쓸 수 있다. 인젝션은 아니지만 `%` 단독 입력으로 전 행 스캔을 유발할 수 있어, 이스케이프 처리와 최소 길이 제한을 둔다.
- **IN 절을 문자열로 조립**하면 다시 인젝션이다. MyBatis `foreach`로 각 원소를 `#{}` 바인딩한다.

## 면접 한 줄 Q&A

- **Q. PreparedStatement는 왜 인젝션을 막나?** A. 쿼리 구조를 먼저 컴파일하고 값을 별도 채널로 바인딩해, 값이 쿼리 구조를 바꿀 수 없기 때문이다.
- **Q. 정렬 컬럼은 왜 바인딩으로 못 막나?** A. 식별자는 값이 아니라 쿼리 구조라 바인딩 대상이 아니며, 화이트리스트 매핑으로 막아야 한다.

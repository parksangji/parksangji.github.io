---
title: "조인 컬럼 타입이 어긋나면 풀스캔이 난다 — 암묵적 형변환의 덫"
date: 2024-10-09 10:30:00 +0900
categories: [Database]
tags: [full-scan, implicit-cast, index, join, explain]
description: "조인·조건 컬럼의 타입 불일치가 인덱스를 무력화하는 원리. 한쪽이 문자/한쪽이 숫자거나 collation이 달라 옵티마이저가 암묵 캐스트를 걸며 풀스캔이 나는 안티패턴."
---

그 주에 잡은 건 "분명히 인덱스가 있는데 조인이 풀스캔으로 도는" 케이스였다. 추상화하면 흔한 안티패턴 하나다. **매핑(조인) 테이블의 키 한쪽은 숫자, 다른 쪽은 문자였고, 옵티마이저가 둘을 비교하려고 암묵적 형변환(implicit cast)을 걸면서 인덱스를 통째로 버렸다.** EXPLAIN 읽기나 조인 전략 같은 일반론과 달리, 여기선 이 구체적 함정 하나를 끝까지 판다.

## 핵심: 타입이 다르면 한쪽을 변환해야 하고, 변환되는 쪽 인덱스는 죽는다

DB는 서로 다른 타입을 직접 비교하지 못한다. `varchar`와 `bigint`를 `=`로 비교하면, 옵티마이저는 한쪽을 다른 쪽 타입으로 맞춘다. 문제는 **어느 쪽을 변환하느냐**다. 보통 우선순위(type precedence)에 따라 **문자열을 숫자로** 변환한다. 즉 `WHERE user.code = order.user_code`에서 `user_code`가 문자라면 옵티마이저는 사실상 이렇게 실행한다.

```sql
-- 우리가 쓴 쿼리
WHERE u.id = o.user_id          -- u.id: bigint, o.user_id: varchar

-- 옵티마이저가 실제로 수행하는 것 (개념적)
WHERE u.id = CAST(o.user_id AS bigint)
```

`o.user_id`에 함수(`CAST`)가 씌워지는 순간, 그 컬럼의 인덱스는 무용지물이 된다. 앞 글에서 본 `LOWER(col)`이 인덱스를 깨는 것과 정확히 같은 원리다. **인덱스는 컬럼 원본값을 정렬해 저장하는데, 변환된 표현식의 정렬 정보는 없다.** 결과적으로 `orders` 전체를 읽어 한 행씩 캐스트하며 비교하는 풀스캔이 난다.

## EXPLAIN에서 어떻게 보이나

타입 불일치 풀스캔은 EXPLAIN에 흔적을 남긴다.

```sql
EXPLAIN SELECT u.name, o.id
FROM users u
JOIN orders o ON u.id = o.user_id;   -- u.id: bigint, o.user_id: varchar
```

읽어야 할 신호:

- 인덱스가 있는데도 `orders`에 **Seq Scan / 풀 테이블 스캔**이 찍힌다.
- 조인 조건에 `(o.user_id)::bigint` 또는 `CAST(...)` 같은 **암묵 변환 흔적**이 보인다.
- 예상 행 수(rows)가 비정상적으로 크다.

같은 함정의 사촌이 **collation 불일치**다. 두 문자 컬럼을 조인하는데 collation이 서로 다르면("`utf8mb4_general_ci` vs `utf8mb4_unicode_ci`" 같은) 비교 규칙을 맞추느라 한쪽에 collate 캐스트가 걸리고, 역시 인덱스를 못 탄다.

## 처방: 타입을 맞춘다

가장 정직한 해법은 **스키마에서 타입을 통일**하는 것이다. 조인 키는 양쪽이 같은 타입·같은 collation이어야 한다.

```sql
-- 정공법: FK가 될 컬럼을 참조 대상과 같은 타입으로
ALTER TABLE orders
    ALTER COLUMN user_id TYPE bigint USING user_id::bigint;

-- 이제 조인이 인덱스를 탄다
SELECT u.name, o.id
FROM users u
JOIN orders o ON u.id = o.user_id;   -- 양쪽 bigint, 캐스트 없음
```

당장 스키마를 못 바꾸는 상황이면, 차선책은 **인덱스가 살아 있어야 하는 쪽(보통 조인의 inner 테이블, 큰 테이블)에 변환이 걸리지 않도록** 반대쪽 상수/작은 쪽을 변환하는 것이다. 핵심 원칙: **변환은 인덱스를 안 쓰는 쪽(상수, 또는 적게 읽는 쪽)에만 건다.**

```sql
-- orders가 크고 user_id 인덱스를 살려야 한다면,
-- 변환을 users 쪽(작은 쪽)으로 유도해 orders 인덱스를 보존
SELECT u.name, o.id
FROM users u
JOIN orders o ON CAST(u.id AS varchar) = o.user_id;
```

다만 이건 임시방편이다. 근본은 스키마 정합성이고, 임시 캐스트는 또 다른 쪽 인덱스를 죽일 수 있으므로 EXPLAIN으로 반드시 확인해야 한다.

## 운영 함정

**함정 1 — 파라미터 바인딩 타입 불일치.** 컬럼은 숫자인데 애플리케이션이 문자열로 바인딩하면(MyBatis에서 `#{id}`가 String으로 매핑되면) 단일 테이블 조회에서도 같은 풀스캔이 난다. 매퍼의 `jdbcType`/자바 타입을 컬럼 타입과 맞춰라. "조인이 아니라 단순 조회인데 느리다"의 숨은 원인인 경우가 많다.

**함정 2 — 조용히 동작하는 위험성.** 타입 불일치는 에러가 아니라 **성능 저하**로만 나타난다. 테스트 데이터가 적을 땐 풀스캔도 빨라서 통과한다. 운영에서 테이블이 커진 뒤에야 터진다. 그래서 조인 키 타입은 코드 리뷰·스키마 설계 단계에서 못 박아야 한다.

## 핵심 요약

- 타입이 다른 컬럼을 비교하면 옵티마이저가 한쪽에 **암묵 CAST**를 걸고, 그쪽 인덱스는 죽는다.
- 보통 **문자→숫자**로 변환되므로 문자 쪽(FK 컬럼)이 풀스캔을 맞기 쉽다. collation 불일치도 같은 결과.
- 근본 처방은 **조인 키 타입·collation 통일**. EXPLAIN에서 CAST 흔적과 Seq Scan을 보면 의심하라.

> **면접 한 줄 Q&A**
> Q. 인덱스가 있는 조인이 풀스캔이다. 가장 먼저 의심할 것은?
> A. 조인 키의 타입·collation 불일치. 옵티마이저가 한쪽에 암묵 캐스트를 걸면 그 컬럼 인덱스가 무력화된다. EXPLAIN에서 CAST 흔적을 확인한다.

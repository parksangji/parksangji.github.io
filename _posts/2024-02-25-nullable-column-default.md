---
title: "컬럼 기본값을 코드에서 줄까 DB에서 줄까"
date: 2024-02-25 10:30:00 +0900
categories: [Database]
tags: [default-value, column, nullable, insert, data-consistency]
description: "같은 컬럼의 기본값을 애플리케이션과 DB 양쪽에서 정의하면 두 값이 어긋나며 데이터가 갈라진다. 권위의 단일 출처를 정하는 기준을 다룬다."
---

새 컬럼을 추가하면서 "상태값 기본은 ACTIVE로 하자"고 정한다. 이때 그 기본값을 어디에 둘 것인가. DB 컬럼의 `DEFAULT` 절인가, 애플리케이션 엔티티의 필드 초기값인가, 아니면 둘 다인가. 답을 어물쩍 넘기면 두 곳에 서로 다른 기본값이 박혀 데이터가 조용히 갈라진다.

## 핵심 개념 — 기본값이 적용되는 시점은 둘 다 다르다

DB 기본값과 애플리케이션 기본값은 **적용되는 경로가 다르다**.

DB `DEFAULT`는 INSERT 문에 그 컬럼이 **아예 빠졌을 때**만 발동한다. 애플리케이션이 `INSERT INTO orders (id, amount)` 처럼 status 컬럼을 명시하지 않으면 DB가 기본값을 채운다. 그런데 ORM/매퍼는 대개 모든 컬럼을 명시적으로 INSERT한다. 엔티티 필드가 `null`이면 `INSERT ... status = NULL`이 나가고, DB의 `DEFAULT 'ACTIVE'`는 **발동하지 않는다**. 명시적으로 NULL을 넣었기 때문이다.

반대로 애플리케이션에서만 기본값을 두면, 그 애플리케이션을 거치지 않는 경로(배치 스크립트, DBA의 수동 INSERT, 다른 서비스의 직접 INSERT)는 기본값을 못 받는다.

즉 두 기본값은 "누가 INSERT를 만드느냐"에 따라 선택적으로 적용되며, 값이 다르면 같은 컬럼에 두 종류의 기본값이 공존하게 된다.

## 코드 예시 — 어긋남이 만드는 데이터

```sql
CREATE TABLE orders (
    id      BIGINT PRIMARY KEY,
    amount  DECIMAL(12,2) NOT NULL,
    status  VARCHAR(20) NOT NULL DEFAULT 'PENDING'  -- DB는 PENDING
);
```

```java
public class Order {
    private Long id;
    private BigDecimal amount;
    private String status = "ACTIVE";  // 애플리케이션은 ACTIVE
}
```

이제 두 경로의 결과가 갈린다.

```sql
-- 애플리케이션 경유 INSERT (status 명시)
INSERT INTO orders (id, amount, status) VALUES (1, 100, 'ACTIVE');
-- 결과: status = 'ACTIVE'

-- 배치/수동 INSERT (status 생략)
INSERT INTO orders (id, amount) VALUES (2, 200);
-- 결과: status = 'PENDING'  ← DB 기본값
```

같은 테이블에 ACTIVE와 PENDING이 "기본값"이라는 같은 의미로 공존한다. 나중에 `WHERE status = 'ACTIVE'`로 집계하면 배치로 들어간 행이 빠지는 미묘한 버그가 된다.

## 권위의 단일 출처 — 어디에 둘 것인가

원칙은 **하나의 권위 있는 출처(single source of truth)**를 정하는 것이다. 두 가지 합리적 전략이 있다.

1. **DB를 권위로** — 컬럼에 `DEFAULT`와 `NOT NULL`을 두고, 애플리케이션은 해당 필드를 INSERT에서 제외하거나 `null`로 보내 DB가 채우게 한다. 어떤 경로로 INSERT되든 같은 기본값이 보장된다. 데이터 무결성을 DB가 최종 책임진다는 관점이다.

2. **애플리케이션을 권위로** — 도메인 객체 생성 시 항상 기본값을 채우고, DB에는 `DEFAULT`를 두지 않거나 같은 값으로 맞춘다. 비즈니스 규칙이 코드에 응집된다는 장점이 있으나, 코드를 우회하는 INSERT는 막을 수 없으므로 `NOT NULL` 제약으로 방어한다.

핵심은 **두 값을 다르게 두지 않는 것**이다. 어느 전략이든 한 곳을 정하고, 다른 쪽은 그것을 거스르지 않도록 맞춘다.

## 운영 함정

기존 테이블에 `NOT NULL DEFAULT` 컬럼을 추가하면, 기존 행은 모두 그 기본값으로 채워진다. 의도한 게 아니면 일괄 백필 후 의미를 재검토해야 한다. 또 nullable 컬럼에 DB 기본값을 두면 "NULL(미설정)"과 "기본값(설정됨)"의 의미가 흐려진다. 기본값이 의미 있으려면 보통 `NOT NULL`이 짝이다.

## 핵심 요약

- DB `DEFAULT`는 INSERT에 컬럼이 생략됐을 때만 발동한다. 명시적 NULL은 기본값을 무시한다.
- 코드와 DB에 서로 다른 기본값을 두면, INSERT 경로에 따라 데이터가 두 갈래로 갈라진다.
- 권위의 단일 출처를 정하라. DB를 권위로 두면 모든 경로에 일관성이 보장된다.

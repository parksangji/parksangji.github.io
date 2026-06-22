---
title: "제약조건에 대해서 (PRIMARY KEY, UNIQUE, NOT NULL, CHECK)"
date: 2024-07-16 10:50:00 +0900
series: "PostgreSQL"
categories: [Database, PostgreSQL]
tags: [postgresql, constraint, data-integrity, schema]
image:
  path: /assets/img/posts/postgresql-constraints.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDndhOSATSGNv7ppN7AkA8Uhkf+8askWONpZAijkmr8mlERZRizgciqEExgmWQdVOa1p9cjaM+VFtkYYNAGO3U000UUgEpKKKAP/9k="
  alt: PostgreSQL 제약조건
---

## 검증 로직을 어디에 둘 것인가

신입 때 저는 데이터 검증을 전부 애플리케이션 코드에서 했습니다. "이메일은 중복되면 안 돼", "나이는 0보다 커야 해" 같은 규칙을 서비스 레이어에서 if문으로 막았죠. 그런데 배치 작업, 다른 관리 도구, 직접 날린 SQL처럼 **애플리케이션을 거치지 않는 경로**가 생기면 그 검증은 무용지물이 됩니다.

데이터의 무결성은 결국 **데이터베이스 자신**이 지켜야 가장 확실합니다. PostgreSQL의 제약조건(constraint)이 그 역할을 합니다.

## NOT NULL — 값이 반드시 있어야 함

가장 단순한 제약. 해당 컬럼에 `NULL`을 허용하지 않습니다.

```sql
CREATE TABLE users (
    id    bigserial PRIMARY KEY,
    email text NOT NULL
);
```

## UNIQUE — 중복 금지

특정 컬럼(또는 컬럼 조합)의 값이 테이블 내에서 유일하도록 보장합니다. UNIQUE 제약을 걸면 PostgreSQL이 내부적으로 유니크 인덱스를 자동으로 만들어줍니다.

```sql
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- 여러 컬럼 조합도 가능 (이 조합이 유일)
ALTER TABLE memberships
    ADD CONSTRAINT uq_user_team UNIQUE (user_id, team_id);
```

## PRIMARY KEY — 행을 대표하는 키

`PRIMARY KEY`는 사실상 **`UNIQUE` + `NOT NULL`** 의 조합입니다. 테이블당 하나만 둘 수 있고, 각 행을 유일하게 식별합니다.

```sql
CREATE TABLE orders (
    id      bigserial PRIMARY KEY,            -- 단일 컬럼 PK
    -- ...
);

CREATE TABLE order_items (
    order_id   bigint,
    product_id bigint,
    PRIMARY KEY (order_id, product_id)        -- 복합 PK
);
```

## CHECK — 값의 규칙을 정의

컬럼 값이 특정 조건을 만족해야만 통과시킵니다. 도메인 규칙을 DB에 못 박아 둘 수 있습니다.

```sql
CREATE TABLE products (
    id    bigserial PRIMARY KEY,
    price integer NOT NULL CHECK (price >= 0),
    discount_rate numeric CHECK (discount_rate BETWEEN 0 AND 1)
);

-- 테이블 레벨 CHECK: 여러 컬럼 관계도 검증 가능
ALTER TABLE events
    ADD CONSTRAINT chk_event_period CHECK (start_at < end_at);
```

## FOREIGN KEY — 참조 무결성

다른 표를 살짝 곁들이면, `FOREIGN KEY`는 참조하는 값이 부모 테이블에 실제로 존재하도록 강제합니다.

```sql
ALTER TABLE orders
    ADD CONSTRAINT fk_orders_user
    FOREIGN KEY (user_id) REFERENCES users (id);
```

## 제약조건에 이름을 붙이자

위 예시들처럼 `CONSTRAINT 이름`을 직접 지정하는 습관을 들이면 좋습니다. 이름을 안 주면 PostgreSQL이 `users_email_key` 같은 이름을 자동으로 붙이는데, 나중에 제약을 삭제·변경하거나 에러 로그를 추적할 때 이름이 명확하면 훨씬 편합니다.

```sql
-- 이름이 있으면 관리가 쉽다
ALTER TABLE users DROP CONSTRAINT uq_users_email;
```

## 정리

- 데이터 무결성은 애플리케이션이 아니라 **DB가 지키게** 하는 게 가장 안전합니다.
- `NOT NULL`(필수), `UNIQUE`(중복 금지), `PRIMARY KEY`(= UNIQUE + NOT NULL), `CHECK`(값 규칙), `FOREIGN KEY`(참조 무결성)를 적절히 조합하세요.
- 제약조건엔 **명시적인 이름**을 붙이면 운영이 편해집니다.
- 다음 글에서는 이 제약조건들을 운영 환경에 적용할 때 자주 마주치는 **함정들**을 정리하겠습니다.

---
title: "INSERT 할 때 ID는 누가 만드나 — 시퀀스와 자동증가"
date: 2023-12-30 10:30:00 +0900
categories: [Database]
tags: [sequence, nextval, identity, primary-key, insert, id-generation]
description: "INSERT 시 PK를 시퀀스 nextval로 채번하는 방식과 IDENTITY/auto_increment의 차이. 시퀀스 캐시·증분·갭이 왜 정상인지와, 같은 트랜잭션에서 채번한 ID를 자식에 쓰는 패턴을 다룬다."
---

행을 하나 넣을 때 그 행의 기본키(PK)는 누가, 언제 만드는가. 이 단순해 보이는 질문에 DB는 두 가지 답을 갖고 있다. **시퀀스(sequence)**에서 미리 번호를 받아 INSERT에 넣는 방식과, **자동증가(IDENTITY / auto_increment)**로 행이 들어가는 순간 DB가 알아서 채우는 방식이다. 둘은 닮았지만 동작 시점과 제어권이 다르다.

## 시퀀스 — 번호를 먼저 받는다

시퀀스는 "다음 번호"를 발급하는 독립적인 카운터 객체다. INSERT와 별개로 존재하며, `NEXTVAL`을 호출할 때마다 증가한 값을 돌려준다.

```sql
-- 시퀀스 정의 (Oracle/PostgreSQL 계열)
CREATE SEQUENCE order_seq START WITH 1 INCREMENT BY 1 CACHE 20;

-- 채번해서 INSERT에 직접 넣는다
INSERT INTO orders (id, user_id, amount)
VALUES (order_seq.NEXTVAL, #{userId}, #{amount});
```

핵심은 **번호를 INSERT 전에, 혹은 INSERT 문 안에서 명시적으로 받는다**는 점이다. 그래서 채번한 ID를 애플리케이션이 곧바로 알 수 있고, 그 값을 자식 행 INSERT에 이어 쓸 수 있다.

## 자동증가 — 들어가는 순간 DB가 채운다

IDENTITY(SQL Server, 표준 SQL) / auto_increment(MySQL)는 컬럼 자체에 "넣을 때 알아서 다음 값"이라는 속성을 단다.

```sql
-- MySQL
CREATE TABLE orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT,
  amount DECIMAL(12,2)
);

INSERT INTO orders (user_id, amount) VALUES (#{userId}, #{amount});
-- id는 안 적는다. DB가 채운다.
```

차이는 **제어권과 시점**이다. 시퀀스는 값을 미리 손에 쥐고 INSERT하지만, 자동증가는 INSERT가 끝나야 값이 정해진다. 그래서 자동증가는 채번한 값을 다시 회수하는 단계(예: `LAST_INSERT_ID()`, 생성키 반환)가 필요하다. 시퀀스는 채번이 곧 회수다.

## 캐시·증분·갭 — 비어도 정상이다

시퀀스를 처음 보면 ID가 1, 2, 3이 아니라 1, 2, 21처럼 **건너뛰는** 경우에 당황한다. 이건 버그가 아니라 설계다.

성능을 위해 시퀀스는 `CACHE` 옵션으로 번호를 미리 한 묶음(예: 20개) 메모리에 받아둔다. 매 채번마다 디스크에 기록하면 느리니까, 1~20을 캐시에 올려두고 거기서 나눠준다. 그런데 그 사이 DB가 재시작되거나 인스턴스가 죽으면 **캐시에 남은 미사용 번호는 버려진다.** 다음엔 21부터 시작한다. 그래서 갭(gap)이 생긴다.

롤백도 갭을 만든다. `NEXTVAL`은 트랜잭션과 무관하게 즉시 증가한다(그래야 동시 채번이 충돌하지 않는다). 트랜잭션을 롤백해도 이미 발급된 번호는 돌아오지 않는다.

> 결론: **시퀀스/자동증가 PK는 "고유하고 단조 증가"만 보장하지, "빈틈없이 연속"을 보장하지 않는다.** 갭에 의미를 부여하거나 "총 주문 수 = 마지막 ID" 같은 가정을 하면 안 된다.

## 같은 트랜잭션에서 부모-자식 INSERT

시퀀스의 진짜 강점은 채번한 ID를 즉시 알 수 있어 **부모를 넣고 그 ID로 자식을 넣는** 흐름이 깔끔하다는 것이다.

```sql
-- 1) 부모 채번 + INSERT
SELECT order_seq.NEXTVAL INTO #{orderId} FROM dual;   -- 채번
INSERT INTO orders (id, user_id) VALUES (#{orderId}, #{userId});

-- 2) 같은 트랜잭션에서 채번한 ID로 자식 INSERT
INSERT INTO order_items (order_id, product_id, qty)
VALUES (#{orderId}, #{productId}, #{qty});
```

MyBatis라면 `<selectKey>`로 INSERT 직전 채번해 파라미터 객체에 ID를 세팅하고, 그 객체로 자식 INSERT를 이어간다. 부모·자식이 같은 트랜잭션 안이므로, 부모가 롤백되면 자식도 함께 사라진다.

## 운영 함정

**함정 1 — 갭을 결번으로 오해해 "복구"한다.** 비어 있는 ID를 메우려고 시퀀스를 되돌리거나 재사용하면, 동시성 환경에서 PK 충돌을 자초한다. 갭은 그냥 둔다.

**함정 2 — 캐시 크기를 무작정 키운다.** `CACHE`를 크게 잡으면 채번은 빨라지지만, 재시작 때 버려지는 번호가 많아져 갭이 커진다. ID 범위가 빨리 소진되거나, 순서에 민감한 화면이 흔들릴 수 있다. 처리량과 갭 허용도 사이에서 정한다.

## 핵심 요약

- 시퀀스는 번호를 미리 받아 INSERT에 넣고, 자동증가는 INSERT 후 DB가 채운다.
- 캐시·롤백·재시작으로 생기는 갭은 정상이다. PK는 고유·증가만 보장한다.
- 부모 채번 ID를 같은 트랜잭션에서 자식 INSERT에 이어 쓰는 패턴이 시퀀스의 핵심 효용이다.

> **면접 한 줄**: "시퀀스로 만든 ID에 빈 번호가 있는데 버그 아닌가요?" → "캐시 손실·롤백·동시 채번 때문에 갭은 정상입니다. 시퀀스는 고유성과 단조 증가만 보장하고 연속성은 보장하지 않으므로, 갭에 비즈니스 의미를 부여하면 안 됩니다."

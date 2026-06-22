---
title: 제약조건 설정 시 주의해야 할 부분
date: 2024-07-30 15:10:00 +0900
series: "PostgreSQL"
categories: [Database, PostgreSQL]
tags: [postgresql, constraint, pitfall, migration]
image:
  path: /assets/img/posts/postgresql-constraint-pitfalls.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnhEzgkCkaF1GcUCZ0yFPFDXEhGCeKskbGjSyBF6k1fk0oiLKMWcDkVQgmMEyyL1U5rWn1yNoz5UW2Rhg0AY7dTTTRRSASkoooA//Z"
  alt: 제약조건 설정 시 주의점
---

## 제약조건은 "거는 것"보다 "운영 중에 거는 것"이 어렵다

앞 글에서 제약조건의 종류를 정리했는데, 정작 실무에서 사람을 당황시키는 건 **이미 데이터가 쌓인 테이블에 제약을 추가할 때** 입니다. 직접 부딪혔던(혹은 부딪힐 뻔한) 함정들을 모아봤습니다. 😅

## 1. UNIQUE는 NULL을 중복으로 보지 않는다

가장 많이 헷갈리는 부분입니다. `UNIQUE` 제약이 걸린 컬럼에 `NULL`은 **여러 개** 들어갈 수 있습니다. SQL 표준상 `NULL`은 "값이 없음/알 수 없음"이라 서로 같다고 판단하지 않기 때문이에요.

```sql
CREATE TABLE t (code text UNIQUE);
INSERT INTO t VALUES (NULL);
INSERT INTO t VALUES (NULL);   -- 에러 없이 통과!
```

"이메일이 유일해야 한다"고 `UNIQUE`만 걸어두면, `NULL` 이메일이 잔뜩 들어갈 수 있습니다. 진짜 하나만 허용하려면 `UNIQUE` + `NOT NULL`을 함께 걸어야 합니다.

> PostgreSQL 15부터는 `UNIQUE NULLS NOT DISTINCT` 옵션으로 NULL도 중복 취급하게 만들 수 있습니다.
{: .prompt-tip }

## 2. 기존 테이블에 NOT NULL 추가 → 기존 NULL이 있으면 실패

데이터가 있는 테이블에 `NOT NULL`을 추가하려 했는데 이미 `NULL` 행이 있으면, `ALTER TABLE`은 그냥 실패합니다.

```sql
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
-- ERROR: column "phone" contains null values
```

순서를 지켜야 합니다. **먼저 기존 NULL을 채우고**, 그다음 제약을 추가합니다.

```sql
UPDATE users SET phone = 'UNKNOWN' WHERE phone IS NULL;
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
```

## 3. CHECK에서 NULL은 통과한다

`CHECK` 조건은 결과가 `TRUE`면 통과, `FALSE`면 거부인데, **`NULL`(unknown)은 거부하지 않습니다.** 3-value 논리 때문이에요.

```sql
CREATE TABLE products (price integer CHECK (price >= 0));
INSERT INTO products VALUES (NULL);   -- CHECK 통과! (NULL은 거부 안 됨)
```

가격이 음수가 아니어야 한다고 `CHECK (price >= 0)`만 걸면 `NULL`은 막지 못합니다. 필요하면 `NOT NULL`을 같이 걸어야 합니다.

## 4. 큰 테이블에 제약 추가는 잠금(LOCK)을 유발한다

운영 중인 대형 테이블에 제약을 그냥 추가하면, 검증을 위해 테이블 전체를 훑으면서 그동안 **쓰기 잠금**이 걸릴 수 있습니다. 트래픽이 있는 시간대엔 서비스가 멈춰 보일 수 있어요.

PostgreSQL은 이걸 두 단계로 나눌 수 있게 해줍니다. 먼저 `NOT VALID`로 제약을 "앞으로 들어올 데이터에만" 적용하고(기존 데이터 전체 스캔 생략), 나중에 한가할 때 `VALIDATE`로 기존 데이터를 검증합니다.

```sql
-- 1) 기존 데이터는 검증하지 않고 빠르게 추가
ALTER TABLE orders
    ADD CONSTRAINT fk_orders_user
    FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID;

-- 2) 트래픽 적은 시간에 기존 데이터 검증 (약한 잠금)
ALTER TABLE orders VALIDATE CONSTRAINT fk_orders_user;
```

## 5. 외래 키 컬럼엔 인덱스를 직접 걸어주자

`FOREIGN KEY`를 만들어도, **참조하는 쪽(자식) 컬럼에는 인덱스가 자동으로 생기지 않습니다.** 부모 행을 `DELETE`/`UPDATE`할 때 자식 테이블을 확인해야 하는데, 인덱스가 없으면 자식 전체를 스캔해서 느려집니다.

```sql
-- FK 컬럼에는 보통 직접 인덱스를 걸어준다
CREATE INDEX idx_orders_user_id ON orders (user_id);
```

## 정리 & 체크리스트

- `UNIQUE`는 `NULL` 중복을 허용한다 → 진짜 유일하게 하려면 `NOT NULL` 병행.
- `NOT NULL` 추가 전, 기존 `NULL` 데이터부터 처리.
- `CHECK`는 `NULL`을 통과시킨다.
- 대형 테이블엔 `NOT VALID` → `VALIDATE` 2단계로 잠금 최소화.
- **FK 컬럼엔 인덱스를 직접** 걸어 삭제/수정 성능을 챙기자.

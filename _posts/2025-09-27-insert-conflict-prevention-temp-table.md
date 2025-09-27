---
title: "중복 INSERT를 막는 임시 적재 테이블"
date: 2025-09-27 10:30:00 +0900
categories: [Database]
tags: [insert-conflict, staging-table, dedup, on-conflict, idempotent-insert, batch]
description: "관계 데이터를 임시 스테이징 테이블에 모은 뒤 한 번에 반영하며 중복 INSERT 충돌을 막는 패턴. NOT EXISTS/ON CONFLICT, 임시 테이블의 수명과 동시성까지."
---

여러 소스에서 모은 관계 데이터를 적재하다 같은 행이 두 번 들어가 유니크 제약 위반으로 실패한 주가 있었다. 한 건씩 `INSERT`하며 중복을 if문으로 거르는 방식은 느리고, 동시 실행되면 검사와 삽입 사이의 틈에서 또 충돌한다. 핵심은 **데이터를 먼저 임시 테이블에 모으고, 거기서 정제한 뒤 한 번의 집합 연산으로 본 테이블에 반영**하는 것이다.

## 왜 스테이징인가

한 건씩 처리하는 코드는 두 가지 약점이 있다.

- **성능**: row-by-row 왕복(이른바 RBAR)은 네트워크·파싱 오버헤드가 행마다 붙는다.
- **정합성**: "있으면 건너뛰기"를 애플리케이션에서 검사하면 검사 시점과 삽입 시점 사이에 다른 트랜잭션이 끼어든다(TOCTOU). 검사를 통과한 두 요청이 모두 삽입을 시도해 충돌한다.

스테이징은 이 둘을 한 번에 푼다. 원본을 일단 임시 테이블에 통째로 넣고, **중복 판단과 본 테이블 반영을 DB의 집합 연산 한 방**으로 끝낸다.

```mermaid
flowchart LR
    A[소스 데이터] -->|bulk load| B[(staging_table)]
    B -->|dedup + 집합 INSERT| C[(target_table)]
    C --> D[staging 정리]
```

## 패턴

```sql
-- 1) 세션/배치 단위 임시 테이블
CREATE TEMPORARY TABLE staging_user_product (
    user_id    BIGINT NOT NULL,
    product_id BIGINT NOT NULL
);

-- 2) 원본을 통째로 적재 (여기선 중복 신경 안 씀)
INSERT INTO staging_user_product (user_id, product_id) VALUES /* 대량 */ ;

-- 3) 스테이징 안에서 먼저 자기 중복 제거 후, 본 테이블에 없는 것만 반영
INSERT INTO user_product (user_id, product_id)
SELECT DISTINCT s.user_id, s.product_id
FROM staging_user_product s
WHERE NOT EXISTS (
    SELECT 1 FROM user_product t
    WHERE t.user_id = s.user_id AND t.product_id = s.product_id
);
```

`DISTINCT`는 스테이징 자체에 중복이 있을 때를 막고, `NOT EXISTS`는 이미 본 테이블에 있는 행을 거른다. 두 방어가 함께 있어야 한다.

`NOT EXISTS`는 검사 후 다른 트랜잭션이 같은 행을 넣으면 여전히 경합할 수 있다. 본 테이블의 유니크 제약을 마지막 안전망으로 두고, DB가 지원하면 충돌을 명시적으로 흡수하는 구문을 쓴다.

```sql
-- PostgreSQL: 유니크 충돌을 무시 (멱등)
INSERT INTO user_product (user_id, product_id)
SELECT DISTINCT user_id, product_id FROM staging_user_product
ON CONFLICT (user_id, product_id) DO NOTHING;

-- MySQL: 동등한 효과
INSERT IGNORE INTO user_product (user_id, product_id)
SELECT DISTINCT user_id, product_id FROM staging_user_product;
```

`ON CONFLICT DO NOTHING` / `INSERT IGNORE`는 유니크 제약이 걸려 있어야만 동작한다. 제약이 곧 중복 판단 기준이다.

## 운영 함정

**임시 테이블의 수명과 정리.** DB의 `TEMPORARY TABLE`은 보통 세션/연결 단위로 살고 끝나면 자동 소멸한다. 그러나 커넥션 풀 환경에서 같은 커넥션이 재사용되면 이전 배치 데이터가 남을 수 있다. 영구 스테이징 테이블을 쓴다면 반드시 배치 시작에 `TRUNCATE`하거나 배치 키 컬럼으로 자기 데이터만 다룬다.

**동시 배치의 격리.** 여러 워커가 같은 영구 스테이징 테이블을 공유하면 서로의 행을 섞어 본다. 배치마다 `batch_id`를 부여하고 `WHERE batch_id = :id`로 자기 데이터만 처리하거나, 연결 단위 `TEMPORARY` 테이블로 물리적으로 분리한다. `INSERT IGNORE`는 충돌 외에 타입 변환 오류 같은 다른 경고도 함께 삼키므로, 무엇을 건너뛰는지 명확히 해야 한다.

## 핵심 요약

- 대량 관계 데이터는 한 건씩이 아니라 **스테이징 → 집합 연산**으로 반영한다.
- `DISTINCT`(스테이징 내부 중복) + `NOT EXISTS`(본 테이블 기존 행) 두 방어를 함께 둔다.
- 본 테이블 유니크 제약을 최종 안전망으로 두고 `ON CONFLICT DO NOTHING`/`INSERT IGNORE`로 충돌을 멱등하게 흡수한다.
- 임시 테이블은 수명·정리·동시성(배치 키 또는 세션 단위 분리)을 반드시 챙긴다.

> **면접 Q.** 애플리케이션에서 "조회 후 없으면 INSERT"로 중복을 막는데도 가끔 유니크 위반이 난다. 왜인가?
> **A.** 조회와 삽입 사이에 다른 트랜잭션이 같은 행을 넣는 경합(TOCTOU) 때문이다. 최종 방어는 DB 유니크 제약이며, 충돌을 멱등하게 흡수하는 구문으로 처리해야 한다.

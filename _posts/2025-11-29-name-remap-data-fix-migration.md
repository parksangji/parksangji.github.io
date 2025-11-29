---
title: "잘못 매핑된 이름을 일괄로 바로잡기 — 데이터 보정"
date: 2025-11-29 10:30:00 +0900
categories: [Database]
tags: [data-fix, remap, migration, update-join, data-integrity, backfill]
description: "참조가 어긋난 데이터를 화면이 아니라 일괄 보정 쿼리로 바로잡는다. 조인 기반 UPDATE, 영향 범위 사전 검증, 누락 매핑 backfill의 안전 절차를 다룬다."
---

그 주엔 참조가 어긋난 데이터를 일괄로 바로잡았다. 추상화하면 "어떤 테이블이 다른 테이블의 잘못된 값을 들고 있어서, 올바른 출처를 기준으로 일괄 교정한다"는 작업이다. 한두 건이면 화면에서 고치겠지만 수천 건이면 보정 쿼리가 답이다. 그리고 보정 쿼리는 한 번 잘못 돌리면 멀쩡한 데이터까지 망가뜨리므로, 쿼리 자체보다 *절차*가 더 중요하다.

## 무엇이 문제인가 — 비정규화된 참조

흔한 시나리오. `order` 테이블이 정규화를 피하려고 `company_name` 같은 값을 복사해 들고 있다. 그런데 출처인 `company.name`이 바뀌었거나, 애초에 잘못된 이름이 복사돼 들어갔다. 정답은 언제나 출처 테이블에 있다. 보정이란 "출처를 기준으로 사본을 다시 동기화"하는 일이다.

```sql
-- order.company_name 이 company.name 과 어긋난 건수를 먼저 센다
SELECT COUNT(*)
FROM   "order" o
JOIN   company c ON c.id = o.company_id
WHERE  o.company_name <> c.name OR o.company_name IS NULL;
```

## 1단계 — 보정 전 영향 범위를 센다

UPDATE를 짜기 전에 항상 같은 WHERE로 SELECT부터 돌린다. "몇 건이 바뀔 것인가"를 숫자로 안 다음에 손댄다. 예상이 100건인데 50만 건이 나오면 WHERE가 틀린 것이다. 이 한 번의 COUNT가 사고를 막는다.

## 2단계 — 조인 기반 UPDATE

올바른 값은 다른 테이블에 있으므로 조인해서 채운다. DB마다 문법이 다르다.

```sql
-- PostgreSQL
UPDATE "order" o
SET    company_name = c.name
FROM   company c
WHERE  o.company_id = c.id
  AND  (o.company_name <> c.name OR o.company_name IS NULL);

-- MySQL
UPDATE `order` o
JOIN   company c ON c.id = o.company_id
SET    o.company_name = c.name
WHERE  o.company_name <> c.name OR o.company_name IS NULL;
```

WHERE에 "이미 맞는 행은 건드리지 않는" 조건을 꼭 넣는다. 불필요한 업데이트는 트리거·감사 로그·복제 부하를 헛되이 만든다.

## 3단계 — 누락 매핑 backfill

보정하다 보면 출처 자체가 없는 행이 나온다. `company_id`가 NULL이거나, 매칭되는 회사가 없는 고아 행이다. 이건 UPDATE 조인이 손대지 못한다(조인에서 빠지니까). 이 누락을 따로 찾아 채우는 것이 backfill이다.

```sql
-- 매칭되는 회사가 없어 보정에서 누락된 행
SELECT o.id, o.company_name
FROM   "order" o
LEFT   JOIN company c ON c.id = o.company_id
WHERE  c.id IS NULL;
```

이 행들은 정책 결정이 필요하다. 이름으로 회사를 역추적해 `company_id`를 채울지, 기본값/미상으로 둘지, 별도 검토 대상으로 뺄지. 자동 쿼리로 뭉개지 말고 명시적으로 처리한다.

## 운영 함정

**트랜잭션과 백업 없이 바로 실행.** 운영 DB의 일괄 UPDATE는 트랜잭션으로 감싸고, 가능하면 보정 대상의 백업 스냅샷(혹은 before 값을 별도 테이블로 저장)을 먼저 뜬다. 롤백 경로가 있어야 안심하고 commit한다.

```sql
BEGIN;
-- before 값 보존
CREATE TABLE order_name_backup AS
SELECT id, company_name FROM "order"
WHERE company_name <> (SELECT name FROM company WHERE id = "order".company_id);
-- 보정
UPDATE ... ;
-- 건수 확인 후 이상 없으면
COMMIT;   -- 이상하면 ROLLBACK;
```

**거대한 단일 UPDATE의 락.** 수백만 행을 한 트랜잭션으로 갱신하면 락이 오래 잡히고 복제 지연·타임아웃이 난다. PK 범위로 배치를 쪼개 나눠 도는 편이 안전하다.

## 핵심 요약

- 어긋난 참조는 화면이 아니라 출처 기준 일괄 보정 쿼리로 동기화한다.
- 순서: ① WHERE로 영향 범위 COUNT → ② 조인 UPDATE(이미 맞는 행 제외) → ③ 고아 행 backfill.
- 트랜잭션 + before 백업 + 배치 분할이 일괄 보정의 안전벨트다.

> **면접 한 줄:** "대량 데이터 보정 시 가장 먼저 하는 일은?" → "같은 WHERE로 SELECT COUNT를 돌려 영향 범위를 숫자로 확인하고, 트랜잭션과 백업으로 롤백 경로를 확보한 뒤 실행한다."

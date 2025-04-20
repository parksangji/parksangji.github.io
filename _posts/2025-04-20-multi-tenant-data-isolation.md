---
title: "한 DB에서 여러 집단의 데이터를 가르는 법"
date: 2025-04-20 10:30:00 +0900
categories: [Backend]
tags: [multi-tenant, isolation, scoping, security, query-design]
description: "하나의 스키마에 여러 집단의 데이터가 섞여 있을 때, 모든 쿼리에 테넌트 조건을 강제하지 않으면 어떻게 데이터가 교차 노출되는지와 기본 스코프 강제 설계를 다룬다."
---

여러 집단의 데이터를 같은 테이블에 담아 운영한 적이 있다. 이런 구조에서 가장 무서운 버그는 에러가 아니라 **조용한 데이터 유출**이다. A 집단의 사용자가 B 집단의 데이터를 보게 되는데, 시스템은 아무런 예외도 던지지 않는다. 핵심은 "모든 데이터 접근에 소속 조건을 어떻게 빠짐없이 강제하느냐"다.

## 멀티 테넌시의 격리 모델

한 시스템에서 여러 고객/집단(테넌트)의 데이터를 다루는 방식은 크게 세 가지다.

- **DB 분리**: 테넌트마다 별도 데이터베이스. 격리는 완벽하지만 수가 늘면 운영 비용이 폭증한다.
- **스키마 분리**: 같은 인스턴스, 다른 스키마. 중간 절충.
- **공유 스키마 + 테넌트 컬럼**: 한 테이블에 `tenant_id` 같은 식별 컬럼을 두고 모든 행을 구분한다. 가장 흔하고 비용이 낮지만, **격리를 애플리케이션이 책임진다.**

마지막 방식의 본질적 위험은 명확하다. `WHERE tenant_id = ?` 조건이 단 하나의 쿼리에서 빠지면, 그 쿼리는 전 테넌트의 데이터를 반환한다. DB는 정상 동작이라 판단하므로 테스트에서도 잘 드러나지 않는다. 데이터가 적을 땐 우연히 한 테넌트만 있어서 통과하다가, 운영에서 두 번째 테넌트가 들어오는 순간 터진다.

## 왜 "수동 조건"은 반드시 실패하는가

개발자가 매 쿼리마다 테넌트 조건을 직접 붙이는 방식은 인간의 규율에 의존한다. 쿼리는 수백 개로 늘고, 신규 입사자는 규칙을 모르며, 급한 핫픽스에서 조건이 누락된다. **누락의 확률은 0이 아니고, 누락의 결과는 치명적이다.** 따라서 격리는 개별 쿼리가 아니라 **기본값(default scope)** 으로 강제되어야 한다.

전략은 컨텍스트에서 테넌트 ID를 한 번 확정하고, 모든 쿼리가 그 컨텍스트를 거치게 만드는 것이다.

```java
// 요청 단위로 테넌트를 확정해 ThreadLocal에 보관
public final class TenantContext {
    private static final ThreadLocal<Long> CURRENT = new ThreadLocal<>();

    public static void set(Long tenantId) { CURRENT.set(tenantId); }
    public static Long require() {
        Long id = CURRENT.get();
        if (id == null) throw new IllegalStateException("tenant not bound");
        return id;
    }
    public static void clear() { CURRENT.remove(); }
}
```

조회 계층에서는 이 값을 자동으로 주입한다. 예를 들어 인터셉터가 SQL에 테넌트 조건을 끼워 넣거나, 리포지토리 베이스 메서드가 항상 조건을 포함하게 한다.

```sql
-- 모든 조회는 이 형태를 벗어나지 못하게 한다
SELECT id, name, status
FROM orders
WHERE tenant_id = #{tenantId}   -- 컨텍스트에서 강제 주입
  AND status = #{status}
```

DB 레벨에서 한 겹 더 막고 싶다면 **행 수준 보안(Row-Level Security)** 을 쓴다. PostgreSQL이라면 정책을 걸어 세션 변수 기반으로 자동 필터링하므로, 애플리케이션이 조건을 빼먹어도 DB가 막아 준다.

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.tenant_id')::bigint);
```

## 운영 함정

**함정 1 — 쓰기 경로의 누락.** 읽기 조건만 챙기고 `UPDATE`/`DELETE`의 `WHERE`에 테넌트 조건을 빼면, 한 테넌트가 다른 테넌트의 행을 덮어쓰거나 지운다. 읽기보다 쓰기 누락이 더 파괴적이다.

**함정 2 — 캐시 키에 테넌트 누락.** `order:123` 같은 키로 캐싱하면 테넌트 간 캐시가 충돌한다. 키는 반드시 `tenant:7:order:123` 처럼 테넌트로 네임스페이스를 나눠야 한다.

## 핵심 요약

- 공유 스키마 멀티 테넌시의 격리는 **개별 쿼리가 아니라 기본 스코프로 강제**한다.
- 테넌트 ID는 요청 진입점에서 한 번 확정하고, 모든 접근이 그 컨텍스트를 거치게 한다.
- 읽기·쓰기·캐시 키 전부에 테넌트 차원을 포함한다. 가능하면 DB의 RLS로 이중 방어한다.
- 면접 한 줄: "공유 테이블 멀티 테넌시에서 가장 큰 리스크는?" → "쿼리 조건 누락에 의한 조용한 교차 노출. 그래서 격리를 기본값으로 강제한다."

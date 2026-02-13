---
title: "MyBatis 설정 한 줄이 쿼리 전체 동작을 바꾼다"
date: 2026-02-13 10:30:00 +0900
categories: [Backend]
tags: [mybatis, configuration, fetch-size, timeout, mapping]
description: "mapUnderscoreToCamelCase·defaultFetchSize·defaultStatementTimeout 등 MyBatis 전역 설정의 동작 원리와 운영 함정을 정리한다."
---

## 매퍼를 고치기 전에 설정부터 본다

resultMap을 아무리 잘 짜도, 전역 설정(`mybatis-config` / `mybatis.configuration.*`)이 어긋나 있으면 모든 매퍼가 조용히 비효율적으로 동작한다. 설정은 한 번 정하면 앱 전체에 적용되므로, 여기서의 한 줄이 resultMap 수십 개보다 영향이 크다.

## 자주 켜는 설정과 그 의미

- **`mapUnderscoreToCamelCase`**: `user_name` 컬럼을 `userName` 프로퍼티에 자동 매핑한다. 끄면 모든 컬럼에 `AS`나 resultMap 별칭이 필요하다. 켜면 편하지만, **별칭과 충돌**하면 매핑이 어긋난다.
- **`defaultFetchSize`**: JDBC 드라이버가 한 번에 가져올 행 수. 큰 결과를 스트리밍할 때 적절한 값을 주지 않으면 드라이버가 전부 메모리에 적재한다.
- **`defaultStatementTimeout`**: 쿼리별 타임아웃(초). 설정해두면 슬로우 쿼리가 커넥션을 무한 점유하는 사고를 막는다.
- **`callSettersOnNulls`**: NULL이어도 세터를 호출한다. 끄면 `Map` 결과에서 NULL 키가 **아예 빠져** `containsKey`가 false가 된다.

```yaml
mybatis:
  configuration:
    map-underscore-to-camel-case: true
    default-statement-timeout: 3      # 초
    default-fetch-size: 100
    call-setters-on-nulls: true
```

## 동작 원리 — 설정은 `Configuration` 한 곳에 모인다

MyBatis는 부트스트랩 시 모든 설정을 `Configuration` 객체에 적재하고, 각 `MappedStatement`가 이를 참조한다. 즉 `defaultStatementTimeout`은 매퍼에서 `timeout`을 명시하지 않은 모든 statement의 기본값이 된다. 개별 `<select timeout="10">`이 전역값을 덮어쓴다.

## 운영 함정

- **`mapUnderscoreToCamelCase`를 중간에 켜면** 그동안 별칭으로 우회하던 매퍼가 이중 매핑으로 깨질 수 있다. 도입은 신규 매퍼부터.
- **fetch size 미설정 + 대량 조회**: PostgreSQL JDBC는 기본적으로 전체 결과를 한 번에 받는다. 스트리밍하려면 fetch size와 `ResultHandler`를 함께 써야 한다.

## 핵심 요약

전역 설정은 "모든 쿼리에 곱해지는 상수"다. `defaultStatementTimeout` 하나로 슬로우 쿼리 사고를 줄이고, `mapUnderscoreToCamelCase`로 매핑 보일러플레이트를 없애되 별칭 충돌을 주의한다.

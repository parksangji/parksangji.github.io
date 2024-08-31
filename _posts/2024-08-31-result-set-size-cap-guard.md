---
title: "조회 결과 30만 건이 메모리를 삼키기 전에"
date: 2024-08-31 10:30:00 +0900
categories: [Database]
tags: [result-limit, memory, guard, max-rows, query-safety, oom]
description: "느슨한 조건의 조회가 수십만 건을 메모리에 올려 OOM을 내기 전에 — 결과 건수 상한 가드와 경계 방어."
---

그 주엔 조회 화면 하나가 가끔 서버를 멈춰 세우는 문제를 다뤘다. 원인은 단순했다. 사용자가 조건을 거의 안 건 채 검색을 눌렀고, 옵티마이저는 충실히 수십만 건을 끌어왔다. ORM/매퍼는 그걸 전부 객체로 매핑해 리스트에 담았고, 힙이 터졌다. 이 작업의 본질은 쿼리 튜닝이 아니라 **"한 번에 메모리로 끌어올 수 있는 행 수에 상한을 두는 안전장치"**다.

## 왜 건수가 곧 메모리인가

`SELECT ... WHERE 느슨한_조건`이 30만 행을 반환하면, JDBC 결과를 도메인 객체로 매핑하는 순간 30만 개의 객체가 힙에 올라온다. 한 객체가 1KB만 돼도 300MB다. 동시에 같은 화면을 몇 명이 누르면 수 GB가 순식간에 잡힌다. GC가 따라잡지 못하고 `OutOfMemoryError`가 난다. 한 요청이 전체 인스턴스를 죽인다.

핵심 통찰: **사용자는 30만 건을 화면에서 볼 수 없다.** 그렇게 많은 결과는 "조건이 잘못됐다"는 신호지 정상 응답이 아니다. 그러니 응답하지 말고 막아야 한다.

## 상한 가드

전략은 "원하는 상한 + 1"만 가져와 초과 여부만 판정하는 것이다.

```java
static final int MAX_ROWS = 100_000;

public SearchResult search(SearchCond cond) {
    // 상한+1만 조회 — 넘는지 아닌지만 알면 된다
    List<Order> rows = orderMapper.search(cond, MAX_ROWS + 1);

    if (rows.size() > MAX_ROWS) {
        throw new TooManyResultsException(
            "결과가 너무 많습니다. 조건을 좁혀 주세요.");
    }
    return SearchResult.of(rows);
}
```
```sql
SELECT * FROM orders
WHERE /* 동적 조건 */
LIMIT #{limit}        -- MAX_ROWS + 1
```

`LIMIT`을 DB에 내려보내는 게 중요하다. 애플리케이션에서 30만 건을 다 받은 뒤 자르면 이미 메모리는 다 먹은 뒤다. **DB가 상한에서 멈추게** 해야 의미가 있다. 초과 시엔 부분 결과를 주는 대신 "조건을 좁히라"고 돌려준다. 잘못된 요청을 정상 응답으로 위장하지 않는다.

진짜로 대량을 내보내야 하는 export 같은 경로는 메모리에 다 올리지 않는 **스트리밍/`fetchSize`** 경로로 분리한다. 화면 조회와 대량 추출은 다른 문제이고, 같은 코드로 풀면 안 된다.

## 운영 함정

**경계에서의 NPE.** 가드 코드는 입력이 깨끗하다고 가정하기 쉽다. 인증 토큰이나 컨텍스트 값이 `null`인 채로 들어오면, 상한을 검사하기도 전에 `accessToken.getX()`에서 NPE가 터진다. 가드 자체가 또 다른 실패 지점이 되지 않게, 진입부에서 `null` 경계를 먼저 막는다.

```java
String token = ctx.getAccessToken();
if (token == null) {
    throw new UnauthorizedException("인증 정보가 없습니다.");
}
```

**count 쿼리로 미리 막으려다 두 배 부담.** "먼저 `COUNT(*)`로 세고 많으면 막자"는 발상은, 무거운 조건에선 count 자체가 풀스캔이라 비용을 두 번 낸다. `LIMIT N+1` 방식이 보통 더 싸다 — 상한까지만 읽고 멈추기 때문이다.

## 핵심 요약

- 건수 = 메모리. 사용자가 못 볼 양의 결과는 정상 응답이 아니라 **잘못된 조건의 신호**다.
- **`LIMIT 상한+1`을 DB에 내려** 초과 여부만 판정하고, 넘으면 "조건을 좁히라"고 돌려준다.
- 대량 추출은 스트리밍/`fetchSize` 경로로 **분리**한다.
- 가드 진입부의 `null` 경계(토큰 등)를 먼저 막아 가드가 또 다른 NPE 지점이 되지 않게 한다.

---
title: "Redis가 죽으면 문을 열까 닫을까: graceful degradation"
date: 2026-04-17 10:30:00 +0900
categories: [Infra]
tags: [redis, resilience, fail-open, degradation, race-condition]
description: "부가 기능 저장소(Redis) 장애 시 fail-open/closed 선택과 카운터 초기화 경합 방지를 다룬다."
---

## 부가 기능이 본 기능을 멈추게 하지 마라

Redis는 흔히 레이트리밋·캐시 같은 **부가 기능**을 받친다. 이 Redis가 죽었을 때 API 전체가 500을 내면, 부가 기능이 핵심 기능을 인질로 잡은 셈이다. 의존 저장소 장애 시 어떻게 "우아하게 저하"할지 정해야 한다.

## fail-open vs fail-closed

- **fail-open**: 저장소 장애 시 요청을 **통과**시킨다. 가용성 우선. 레이트리밋이라면 "한도 검사를 못 하니 일단 허용". 단 장애 동안 폭주 방어가 사라진다.
- **fail-closed**: 장애 시 요청을 **거부**한다. 안전 우선. 인증·결제처럼 틀리면 안 되는 곳에 적합하지만, 가용성을 희생한다.

선택 기준은 **그 기능이 보호하는 게 무엇이냐**다. 레이트리밋(편의·보호)은 보통 fail-open, 인증(보안)은 fail-closed.

```java
try {
    return redisRateLimiter.tryConsume(key);
} catch (RedisConnectionFailureException e) {
    log.warn("rate-limit store down, fail-open");
    return true;                 // 통과 (fail-open)
}
```

## catch 안의 dead code를 조심하라

연결 예외를 잡은 뒤 "복구 시도" 코드를 넣었다가, 실제론 도달 불가능하거나 또 예외를 던지는 dead code가 되기 쉽다. catch 블록은 **단순하고 확실한 한 가지 동작**(허용/거부)만 하게 둔다.

## 카운터 초기화 경합

키가 없을 때 "조회 → 없으면 0으로 초기화 → 증가"를 분리하면, 두 요청이 동시에 0을 만들어 한쪽 증가가 사라진다. **원자적 증가(`INCR`)**는 키가 없으면 0에서 시작해 1을 반환하므로, lazy 초기화 자체가 필요 없다. 초기화와 증가를 한 연산으로 합치는 게 경합을 없애는 길이다.

## 핵심 요약

의존 저장소 장애는 "fail-open이냐 fail-closed냐"를 기능의 성격으로 먼저 정한다. catch는 단순하게, 카운터는 원자 연산으로 초기화 경합을 원천 제거한다.

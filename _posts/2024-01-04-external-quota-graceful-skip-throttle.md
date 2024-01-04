---
title: "외부 API 호출 한도가 바닥나면 멈춰야 한다 — 소비자 측 쿼터 소진과 우아한 중단"
date: 2024-01-04 10:30:00 +0900
categories: [Infra]
tags: [api-quota, graceful-skip, throttling, sleep-pacing, batch-failure-alert, external-api]
description: "외부 API의 일일·키별 호출 한도를 소비자가 직접 세어, 한도를 넘기기 전에 호출을 건너뛰고 잡을 우아하게 종료하며, 정상 구간에서는 sleep 페이싱으로 속도를 조절하는 설계."
---

쓸 수 있는 호출 횟수가 정해진 외부 API를 부를 때, 한도를 넘기기 전에 멈추고 호출 간 간격을 두는 일은 흔한 요구다. 핵심은 관점의 전환이다. 제공자 측 레이트 리미팅(토큰 버킷·고정 창)이나 호출 실패 후 재시도·백오프와 달리, 여기서는 **소비자가 자신의 잔여 할당량을 미리 세어 한도 안에서 스스로 멈춘다**. 429를 맞고 재시도로 뚫는 게 아니라, 애초에 한도를 넘길 호출을 하지 않는 것이다.

## 왜 재시도가 아니라 graceful skip인가

429(Too Many Requests)를 받고 백오프 후 재시도하는 전략은 **순간적인 속도 초과**에 맞다. 하지만 외부 API가 "하루 N건" 같은 일별·키별 총량 한도를 가진다면 재시도는 무의미하다. 한도를 다 쓴 상태에서 재시도하면 다음 호출도, 그다음도 전부 429다. 백오프로 기다려봐야 한도는 자정(혹은 갱신 주기)이 되어야 회복된다. 그동안 잡은 재시도 루프에서 시간만 태우고 결국 실패한다.

그래서 소비자 측 전략은 다르다.

- **잔여 한도를 세어, 이번 사이클에서 호출이 한도를 넘길 것 같으면 호출하지 않고 건너뛴다(graceful skip).**
- 건너뛴 작업은 다음 실행 주기로 미루고, **잡 자체는 실패가 아니라 정상 종료**시킨다.
- 정상 구간에서는 호출 사이에 짧은 sleep을 넣어 순간 속도(burst)도 함께 누른다.

## 잔여 한도를 세는 두 가지 신호

소비자가 한도를 추정하는 방법은 두 가지다.

1. **응답 헤더 신뢰**: 많은 API가 `X-RateLimit-Remaining` 류 헤더로 잔여량을 알려준다. 이게 있으면 매 응답마다 갱신해 가장 정확하다.
2. **자체 카운터**: 헤더가 없으면 소비자가 직접 "오늘 몇 건 썼는지"를 카운트한다. 다중 인스턴스라면 이 카운터를 공유 저장소(원자적 증가 연산)에 둬야 한다. 인스턴스마다 로컬 카운터를 두면 합이 한도를 넘긴다.

핵심은 **호출하기 전에** 잔여량을 검사하는 것이다. 호출 후에 검사하면 이미 한도를 넘긴 뒤다.

```java
public class QuotaGuardedClient {

    private final ExternalApiClient client;       // generic 외부 API 클라이언트
    private final AtomicInteger remaining;         // 또는 공유 저장소
    private final long pacingMillis;               // 호출 간 최소 간격

    public Optional<Response> callIfAllowed(Request req) {
        // 1) 호출 전 잔여 한도 검사 — 부족하면 graceful skip
        if (remaining.get() <= QUOTA_SAFETY_MARGIN) {
            return Optional.empty();   // 호출하지 않고 건너뜀
        }
        // 2) 정상 구간: sleep 페이싱으로 burst 억제
        sleepQuietly(pacingMillis);

        Response res = client.send(req);
        // 3) 응답 헤더가 있으면 잔여량 갱신, 없으면 카운터 감소
        remaining.set(res.remainingQuotaOrElse(remaining.get() - 1));
        return Optional.of(res);
    }
}
```

`QUOTA_SAFETY_MARGIN`을 0이 아니라 여유 있게 두는 이유가 있다. 다중 인스턴스나 동시 요청 때문에 카운터가 한도에 딱 붙기 직전 여러 호출이 동시에 통과할 수 있다. 마진은 그 경합을 흡수하는 완충이다.

## 잡을 우아하게 종료시키는 흐름

배치 안에서 한도가 소진되면, 남은 항목을 무리하게 처리하려 들면 안 된다. 흐름은 이렇다.

```java
for (Item item : items) {
    Optional<Response> res = quotaClient.callIfAllowed(toRequest(item));
    if (res.isEmpty()) {
        log.warn("쿼터 소진 — 남은 {}건은 다음 실행으로 이월", remainingCount);
        alertService.notifyQuotaExhausted(remainingCount);  // 운영 알림
        break;   // 루프 중단 — 예외 아님
    }
    handle(res.get());
}
// break로 빠져나와도 잡은 COMPLETED 로 끝난다
```

`break`로 빠져나오고 잡을 `COMPLETED`로 끝내는 게 핵심이다. 예외를 던져 `FAILED`로 만들면 스케줄러가 재시도하거나 알림이 에러로 쌓인다. 한도 소진은 **예상된 정상 상황**이지 장애가 아니다. 다만 운영자는 "오늘은 다 못 돌았다"는 사실을 알아야 하므로 별도 알림을 한 번 보낸다.

미처리 항목을 다음 주기로 안전하게 넘기려면, 처리한 항목을 상태로 표시해 다음 실행이 그것부터 건너뛰게 해야 한다. 그래야 매번 처음부터 한도를 까먹지 않는다.

## 운영 함정

**함정 1 — 한도 창의 시간대(timezone).** "일일 한도"가 UTC 자정 기준인지 KST 기준인지에 따라 리셋 시점이 9시간 어긋난다. 소비자가 자체 카운터를 리셋하는 시각을 제공자의 리셋 기준에 맞추지 않으면, 아직 한도가 안 풀렸는데 카운터만 0이 되어 호출이 줄줄이 429를 맞는다.

**함정 2 — sleep으로 인한 잡 시간 폭증.** 호출당 200ms sleep에 10만 건이면 그것만 5.5시간이다. 페이싱은 burst 억제용 최소 간격이어야지, 모든 호출에 큰 sleep을 거는 도구가 아니다. 한도가 넉넉하면 페이싱을 줄이고, 정말 빡빡하면 처리량 자체를 여러 주기로 나누는 설계가 맞다.

## 핵심 요약

- 총량 한도엔 재시도가 무의미하다. **호출 전에 잔여량을 검사**해 넘길 호출은 건너뛴다(graceful skip).
- 한도 소진은 장애가 아니다. **`break` 후 잡을 COMPLETED로 종료**하고, 알림은 한 번만.
- 잔여량은 응답 헤더 우선, 없으면 **공유 원자 카운터**로. 다중 인스턴스 로컬 카운터는 합이 한도를 넘긴다.

**면접 한 줄 Q&A**
Q. 외부 API가 일일 총량 한도를 줄 때, 재시도·백오프로 충분한가?
A. 아니다. 총량을 다 쓰면 재시도해도 리셋 전까진 계속 429다. 소비자가 잔여량을 세어 한도 전에 graceful skip 하고 잡을 정상 종료시키는 편이 맞다.

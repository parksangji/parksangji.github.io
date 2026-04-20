---
title: "어떤 호출을 사용량으로 셀 것인가 — 미터링의 경계 정의"
date: 2026-04-20 10:30:00 +0900
categories: [Backend]
tags: [api-usage, metering, billing, http-status, counting, policy]
description: "사용량 미터링에서 어떤 응답(상태코드)을 과금·집계 대상으로 셀지의 경계 정의와 함의. 분류 규칙을 한 곳에 모으는 설계."
---

그 주엔 API 사용량 집계 대상을 손봤다. 성공(2xx)만 세던 것을, 일부 실패 응답까지 세도록 바꿨다. 사소해 보이지만 이건 정책 결정이다. **무엇을 '한 번의 사용'으로 셀지**에 따라 과금 금액도, 할당량 소진 속도도, 통계 그래프도 전부 달라진다. 코드 한 줄이 돈과 신뢰의 경계가 된다.

## 셀 것과 안 셀 것

직관은 "성공만 센다"지만, 실무의 기준은 다르다. 핵심 질문은 **"누구의 책임으로 발생한 호출인가"**다.

- **2xx 성공** — 당연히 센다. 가치를 제공했다.
- **4xx 클라이언트 오류** — 대체로 **센다.** 잘못된 파라미터, 없는 리소스(404)라도 *클라이언트가 유효하게 요청을 보냈고 서버가 그걸 받아 처리(판정)했다.* 일을 했으니 센다. 특히 404는 "조회해봤다"는 정당한 사용일 때가 많다.
- **401/403 인증·인가 실패** — 보통 **안 센다.** 정상 사용자의 호출로 보기 어렵다(키 오류, 권한 없음). 다만 정책에 따라 다르다.
- **429 레이트리밋 차단** — 게이트웨이가 막은 요청. 보통 **안 센다.** 처리 자체를 거부했으니까.
- **5xx 서버 오류** — **안 센다.** 우리 잘못으로 실패한 호출에까지 과금하면 신뢰를 잃는다.

요지는 이렇다. **클라이언트가 유효하게 보냈고 서버가 결과를 판정했다면, 결과의 성패와 무관하게 센다. 서버 책임의 실패는 빼고, 처리에 도달하지 못한 호출(차단)도 뺀다.** 이건 비즈니스 정책이지 기술 상수가 아니다.

## 경계는 한 곳에 모은다

이 판단이 코드 곳곳에 흩어지면, 정책이 바뀔 때마다 여기저기 고쳐야 하고 누락이 생긴다. **분류 규칙을 단일 함수(혹은 정책 객체)에 모은다.** 미터링 대상 여부는 오직 이 한 곳에서 결정한다.

```java
public final class UsageCountingPolicy {

    /** 이 응답을 사용량 1건으로 셀 것인가 */
    public boolean isCountable(int status, boolean blockedByGateway) {
        if (blockedByGateway) return false;      // 차단된 요청은 미집계
        if (status >= 500) return false;          // 서버 책임 실패는 미집계
        if (status == 401 || status == 403) return false; // 인증·인가 실패 제외
        return status >= 200 && status < 500;     // 2xx + 정당한 4xx
    }
}
```

집계 지점에서는 정책에 묻기만 한다.

```java
@Component
@RequiredArgsConstructor
public class UsageRecorder {
    private final UsageCountingPolicy policy;
    private final UsageMapper usageMapper;

    public void record(long clientId, int status, boolean blocked) {
        if (!policy.isCountable(status, blocked)) return;
        usageMapper.increment(clientId, LocalDate.now()); // 멱등 집계 키
    }
}
```

정책이 "404는 이제 안 센다"로 바뀌어도 수정은 `UsageCountingPolicy` 한 곳뿐이다. 집계·과금·통계가 같은 판단을 공유하므로 셋이 절대 어긋나지 않는다 — 이게 진짜 노림수다.

## 운영 함정

**과거 데이터와의 단절.** 미터링 경계를 바꾸면 그 전후의 숫자가 불연속이 된다. 4월 19일까지는 2xx만, 20일부터는 4xx 포함이면 그래프가 갑자기 솟는다. 변경 시점을 기록하고, 과금·통계 화면에 "집계 기준 변경" 주석을 남겨야 분석가가 오해하지 않는다.

**경계 케이스의 모호함.** 304 Not Modified, 202 Accepted(비동기 수락), 206 Partial Content 같은 응답은 "사용인가?"가 애매하다. 이런 건 정책 문서에 명시적으로 박아두고, 분류 함수에 단위 테스트로 못 박는다. "셀까 말까"를 매번 코드 읽으며 추측하게 두면 안 된다.

```java
@Test
void 정당한_404는_세고_5xx와_차단은_안_센다() {
    var p = new UsageCountingPolicy();
    assertThat(p.isCountable(200, false)).isTrue();
    assertThat(p.isCountable(404, false)).isTrue();
    assertThat(p.isCountable(500, false)).isFalse();
    assertThat(p.isCountable(200, true)).isFalse(); // 차단
}
```

## 핵심 요약

- 미터링의 본질은 "무엇을 한 번의 사용으로 셀지"의 정책 정의다. 기술 상수가 아니다.
- 일반 원칙: 클라이언트가 유효하게 보내 서버가 판정한 호출은 성패와 무관하게 세고, 서버 책임 실패(5xx)와 차단(429)은 뺀다.
- 분류 규칙을 한 곳에 모아 집계·과금·통계가 같은 판단을 공유하게 한다.
- 경계를 바꾸면 데이터에 불연속이 생기니 변경 시점을 기록하고 모호한 상태코드는 테스트로 못 박는다.

---
title: "로그는 문자열이 아니라 데이터다"
date: 2024-11-10 10:30:00 +0900
categories: [Infra]
tags: [logging, structured, mdc, correlation-id, observability]
description: "흩어진 print 로그를 구조화 로깅으로 정비하는 법. JSON 구조 로그, MDC 기반 correlation ID로 분산 요청을 추적하고, 로그 레벨 전략으로 신호와 잡음을 가른다."
---

장애가 터졌을 때 로그를 열어 보면 두 부류로 갈린다. 사람이 읽기 좋게 문장으로 늘어놓은 로그와, 기계가 질의할 수 있게 구조화된 로그. 전자는 평소엔 친절해 보이지만, 막상 *"오류난 그 요청 하나의 전체 흐름"*을 추적해야 할 때 `grep`만으로는 답이 안 나온다. 로그를 정비한다는 건 결국 **로그를 문장이 아니라 질의 가능한 데이터로 바꾸는 일**이다.

## 핵심 개념: 왜 구조화인가

전통적 로그는 한 줄의 자유 텍스트다.
```
2024-11-10 10:30:01 주문 12345 결제 실패 - 잔액부족 user=u-77
```
사람은 읽지만, *"user=u-77의 최근 한 시간 실패 로그"*를 뽑으려면 정규식과 운에 기댄다. 구조화 로깅은 같은 사건을 **키-값 필드의 묶음**으로 남긴다.
```json
{"ts":"2024-11-10T10:30:01Z","level":"ERROR","event":"payment_failed",
 "orderId":"12345","userId":"u-77","reason":"insufficient_balance","traceId":"a1b2c3"}
```
이러면 로그 수집기(ELK, Loki 등)에서 `userId="u-77" AND event="payment_failed"`처럼 **필드로 질의·집계**할 수 있다. 로그가 검색 가능한 데이터셋이 된다.

## correlation ID와 MDC: 요청을 꿰는 실

하나의 요청은 컨트롤러 → 서비스 → 매퍼 → 외부연동을 거치며 수십 줄의 로그를 남긴다. 동시에 수백 요청이 흐르면 로그가 뒤섞여, 어떤 줄이 *같은 요청*인지 알 수 없다. 해법이 **correlation ID(trace ID)** 다. 요청 진입점에서 고유 ID를 하나 발급해, 그 요청이 남기는 모든 로그에 같은 ID를 박는다.

문제는 "모든 로그 줄마다 ID를 인자로 넘기는" 건 비현실적이라는 것이다. 그래서 **MDC(Mapped Diagnostic Context)** 를 쓴다. MDC는 *스레드 로컬* 저장소다. 요청 시작 시 ID를 한 번 넣어 두면, 그 스레드가 찍는 모든 로그에 자동으로 따라붙는다.

```java
@Component
public class TraceIdFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest req,
            HttpServletResponse res, FilterChain chain) throws Exception {
        String traceId = Optional.ofNullable(req.getHeader("X-Trace-Id"))
                                  .orElse(UUID.randomUUID().toString());
        MDC.put("traceId", traceId);     // 이 스레드의 모든 로그에 부착
        try {
            res.setHeader("X-Trace-Id", traceId);
            chain.doFilter(req, res);
        } finally {
            MDC.clear();                 // 반드시 비운다 — 아래 함정 참고
        }
    }
}
```

로그 패턴에 `%X{traceId}`를 넣으면 모든 줄에 ID가 자동으로 찍힌다. 이제 장애 한 건의 `traceId`로 전 구간 로그를 한 번에 모은다.

## 로그 레벨 전략

레벨은 *"누가 언제 봐야 하는가"* 로 가른다.
- **ERROR**: 사람이 즉시 개입해야 하는 실패. 알림과 연결된다. 남발하면 알림이 무뎌진다.
- **WARN**: 자동 복구됐지만 추세를 봐야 하는 것(재시도, 폴백).
- **INFO**: 비즈니스 이벤트의 골격(주문 생성, 결제 완료). 운영 중 켜두는 기본선.
- **DEBUG/TRACE**: 개발·재현용. 운영에선 끈다.

기준이 흐리면 ERROR가 INFO처럼 쌓이고, 정작 진짜 장애가 잡음에 묻힌다.

## 운영 함정

**1) MDC를 안 비운다.** MDC는 스레드 로컬인데, 서버는 스레드를 **풀에서 재사용**한다. 요청 끝에 `MDC.clear()`를 안 하면, 다음 요청이 그 스레드를 재활용할 때 *이전 요청의 traceId·userId가 남아* 엉뚱한 요청에 붙는다. 추적이 오히려 거짓말을 한다. `finally`에서 반드시 비운다.

**2) 비동기로 넘어가면 MDC가 사라진다.** `@Async`나 별도 스레드풀로 작업을 넘기면 MDC(스레드 로컬)는 따라가지 않는다. 비동기 경계에서 컨텍스트를 명시적으로 복사·전파해야 ID가 끊기지 않는다.

**3) 민감정보 로깅.** 구조화하면 필드가 깔끔해 보여 무심코 비밀번호·토큰·개인정보를 넣기 쉽다. 로그는 평문으로 오래 쌓인다. 민감 필드는 마스킹하거나 아예 찍지 않는다.

## 핵심 요약

- 구조화 로그 = **질의 가능한 데이터**. 자유 텍스트는 장애 시 추적이 안 된다.
- 요청당 **correlation ID**를 발급하고 **MDC**로 모든 로그에 자동 부착해 한 요청을 꿴다.
- MDC는 스레드 로컬 — **`finally`에서 clear**, 비동기 경계에서 **전파** 필수. 민감정보는 마스킹.

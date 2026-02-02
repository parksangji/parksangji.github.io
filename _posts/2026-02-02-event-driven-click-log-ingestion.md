---
title: "초당 수천 클릭을 삼키는 법 — 이벤트로 받아 비동기로 적재하기"
date: 2026-02-02 10:30:00 +0900
categories: [Infra]
tags: [kafka, event-driven, logging, ingestion, async, high-throughput]
mermaid: true
description: "고빈도 클릭/노출 로그를 요청 스레드에서 직접 쓰지 않고 메시지로 던져 컨슈머가 비동기 적재하는 인제스트 파이프라인. 유실·순서 트레이드오프 포함."
---

## 도입 — 요청 스레드에서 DB에 쓰면 안 되는 이유

클릭이나 노출 같은 행동 로그는 **수가 많고 가볍다**. 한 건의 비즈니스 가치는 작지만 초당 수천 건이 들어온다. 이 주에 다룬 모듈의 핵심 결정은 단순했다. **로그를 요청 스레드에서 곧장 DB에 INSERT하지 않는다.**

이유는 두 가지다. 첫째, 사용자 요청의 응답 시간에 DB 쓰기 지연이 그대로 더해진다. 로그 적재가 느려지면 사용자가 느려진다. 둘째, 초당 수천 건의 단건 INSERT는 DB 커넥션 풀과 디스크 I/O를 금세 포화시킨다. 로그 트래픽 스파이크가 본 서비스 DB를 함께 무너뜨린다.

해법은 **발생과 적재를 시간적으로 분리**하는 것이다. 요청 스레드는 이벤트를 메시지 큐에 던지기만 하고 즉시 응답한다. 적재는 컨슈머가 뒤에서 비동기로, 자기 페이스대로 한다.

## 핵심 개념 — 인제스트 경로를 쪼갠다

```mermaid
flowchart LR
    U[클릭 요청] --> A[API: 이벤트 발행]
    A -->|즉시 응답| U
    A --> Q[(메시지 큐)]
    Q --> C[컨슈머]
    C --> B[배치 버퍼]
    B -->|N건 또는 T초| DB[(로그 저장소)]
```

이 구조에서 발생 측(API)의 작업은 "이벤트 직렬화 + 발행" 뿐이다. 메시지 발행은 보통 로컬 버퍼에 담고 백그라운드로 전송되므로 마이크로초 단위다. 사용자 응답은 DB와 무관하게 빨라진다.

대신 한 가지를 받아들여야 한다. **적재가 비동기가 되는 순간, 로그는 즉시 조회 가능하지 않고 재처리 대상이 된다.** 이벤트가 발행되고 컨슈머가 적재하기까지 지연이 존재하며, 컨슈머가 죽으면 그 사이 메시지는 큐에 남아 재처리된다. 이건 비용이 아니라 트레이드오프다. 로그는 보통 약간의 지연과 약간의 중복을 허용할 수 있다(at-least-once). 그래서 동기 적재의 비용을 떼어낼 수 있는 것이다.

## 코드 — 발행 측과 컨슈머 측

발행 측은 가볍다. 요청 스레드를 막지 않는다.

```java
@RestController
class ClickController {
    private final EventPublisher publisher;

    @PostMapping("/clicks")
    public ResponseEntity<Void> click(@RequestBody ClickRequest req) {
        var event = new ClickEvent(
            req.itemId(), req.userId(), Instant.now(), req.context());
        publisher.publish("click-events", event.groupKey(), event); // 키=묶음 기준
        return ResponseEntity.accepted().build();  // 202, DB를 기다리지 않는다
    }
}
```

`groupKey`를 메시지 키로 쓰는 이유가 있다. 같은 키는 같은 파티션으로 가므로, 한 컨슈머가 같은 그룹의 이벤트를 모아 **배치 INSERT**하기 좋다. 단건 INSERT 수천 번을 묶음 INSERT 수십 번으로 접는다.

컨슈머 측은 버퍼링 후 일괄 적재한다.

```java
class ClickConsumer {
    private final List<ClickEvent> buffer = new ArrayList<>();

    @KafkaListener(topics = "click-events")
    void onMessage(List<ClickEvent> records) {   // 배치 리스너
        buffer.addAll(records);
        if (buffer.size() >= 500) flush();        // 크기 임계
    }

    @Scheduled(fixedDelay = 2000)
    synchronized void flush() {                   // 시간 임계
        if (buffer.isEmpty()) return;
        logRepository.batchInsert(buffer);        // 한 번에 적재
        buffer.clear();
    }
}
```

크기 임계(500건)와 시간 임계(2초) **둘 다** 두는 것이 핵심이다. 트래픽이 많으면 크기로 먼저 flush되고, 한산하면 시간으로 flush된다. 한쪽만 두면 한산할 때 영영 안 내려가거나, 바쁠 때 너무 자주 내려간다.

## 운영 함정

**1) flush 전 종료 시 버퍼 유실.** 메모리 버퍼에 모아둔 채로 컨슈머가 죽으면, 아직 커밋 안 한 메시지는 큐에 남아 재처리되지만(다행), 오프셋 커밋 시점이 어긋나면 유실되거나 중복된다. **오프셋 커밋은 반드시 batchInsert 성공 이후**여야 한다. flush 전에 커밋하면 적재 안 된 메시지가 사라진다. 종료 훅(graceful shutdown)에서 남은 버퍼를 강제 flush하는 것도 필요하다.

**2) 발행 측 큐 장애를 무시한다.** "어차피 로그니까" 발행 실패를 삼키면, 큐가 죽었을 때 조용히 데이터가 사라진다. 반대로 발행 실패에 재시도를 강하게 걸면 요청 스레드가 막혀 본 서비스가 느려진다. 로그의 중요도에 따라 정책을 정해야 한다. 보통은 **로컬 버퍼 + 짧은 타임아웃 + 실패 시 로컬 폴백 파일** 정도로 타협한다. 핵심은 "로그 적재가 사용자 요청을 절대 막지 않는다"는 원칙을 깨지 않는 것이다.

## 핵심 요약 / 면접 Q&A

- **Q. 왜 동기 적재를 피하나?** A. DB 쓰기 지연이 응답 시간에 더해지고, 고빈도 단건 INSERT가 DB를 포화시키기 때문. 발생과 적재를 분리해 발생 측을 가볍게 한다.
- **Q. 비동기 적재의 대가는?** A. 즉시 조회 불가(지연)와 재처리 가능성(at-least-once, 중복). 로그는 이걸 허용할 수 있어 성립한다.
- **Q. 배치 flush의 임계는?** A. 크기와 시간 둘 다. 바쁠 땐 크기로, 한산할 땐 시간으로 내려간다.
- **한 줄 정리:** 요청 스레드는 던지고 끝, 적재는 컨슈머가 묶어서. 분리의 대가는 약간의 지연과 중복이고, 로그는 그걸 감당할 수 있다.

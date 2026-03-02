---
title: "건건이 INSERT하지 마라 — 메모리 누산기로 통계를 접는 법"
date: 2026-03-02 10:30:00 +0900
categories: [Infra]
tags: [aggregation, accumulator, stats, kafka, in-memory, flush]
description: "이벤트를 (날짜+대상) 키별로 메모리에서 누산했다가 주기적으로 한 번에 내려쓰는 사전 집계 패턴. 누산 키 설계, 동시성, flush 정합을 다룬다."
---

## 도입 — 통계 테이블을 매 이벤트마다 갱신하면 벌어지는 일

API 사용량, 조회수, 클릭 통계 같은 지표는 보통 "키별 합계"다. (날짜, 대상)당 호출 수, 합산 용량 같은 것. 가장 단순한 구현은 이벤트가 들어올 때마다 `UPDATE stats SET count = count + 1 WHERE ...`를 날리는 것이다. 동작은 한다. 그런데 이벤트가 초당 수천이면 이야기가 다르다.

문제는 **같은 행에 대한 갱신이 경합**한다는 점이다. 같은 (날짜, 대상) 행을 수많은 트랜잭션이 동시에 `UPDATE`하면 그 행에 락이 걸리고, 갱신이 직렬화되어 줄을 선다. 핫 로우(hot row) 경합이다. 게다가 매 이벤트가 한 번의 DB 왕복이다.

이 주의 핵심은 **"DB에서 누산하지 말고 메모리에서 먼저 접는 것"** 이다. 들어오는 이벤트를 키별로 메모리 맵에 합쳐 두었다가, 일정 주기로 한 번에 내려쓴다. 1000건의 이벤트가 1건의 갱신으로 접힌다.

## 핵심 개념 — 사전 집계(pre-aggregation)의 메커니즘

누산기는 결국 `Map<Key, Accumulator>`다. 핵심 설계 포인트는 세 가지다.

- **누산 키 설계**: 집계 기준을 그대로 키로. (날짜 + 대상 ID)처럼 *최종 통계 행의 PK*와 일치시킨다. 키 단위가 곧 경합 단위이자 flush 단위다.
- **합치기(merge)**: count는 더하고, sum은 누적하고, max는 갱신하는 식으로 이벤트를 누산기에 접는다.
- **flush**: 주기마다 누산 맵을 통째로 스냅샷해 비우고, 모인 값을 DB에 `INSERT ... ON DUPLICATE KEY UPDATE`(upsert)로 한 번에 반영한다.

핵심은 **DB가 보는 쓰기 빈도를 이벤트 빈도에서 떼어낸다**는 것이다. 이벤트는 초당 수천이지만 DB 갱신은 flush 주기당 키 개수만큼만 일어난다.

## 코드 — 동시성 안전한 누산기

여러 스레드(또는 컨슈머 워커)가 동시에 누산하므로 동시성이 관건이다. `ConcurrentHashMap` + 원자적 merge로 락 없이 합친다.

```java
class StatsAccumulator {
    // 키 = 날짜|대상, 값 = 원자 누산기
    private final ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();

    void accumulate(ApiUsageEvent e) {
        String key = e.date() + "|" + e.targetId();
        // computeIfAbsent + LongAdder: 고경합에서도 거의 락 없이 증가
        counts.computeIfAbsent(key, k -> new LongAdder()).increment();
    }

    // 주기적 flush: 스냅샷 후 비우고 한 번에 반영
    @Scheduled(fixedDelay = 10_000)
    void flush() {
        // 1) 현재 키들을 떼어내며 새 누산을 막지 않는다
        Map<String, Long> snapshot = new HashMap<>();
        for (var key : counts.keySet()) {
            LongAdder adder = counts.remove(key);   // 원자적으로 떼어냄
            if (adder != null) snapshot.put(key, adder.sum());
        }
        if (snapshot.isEmpty()) return;

        // 2) 모인 값을 upsert로 일괄 반영
        List<StatRow> rows = snapshot.entrySet().stream()
            .map(en -> StatRow.of(en.getKey(), en.getValue()))
            .toList();
        statsRepository.upsertBatch(rows);  // INSERT ... ON DUPLICATE KEY UPDATE count=count+?
    }
}
```

`LongAdder`를 쓴 것이 포인트다. `AtomicLong`은 고경합에서 CAS 재시도가 폭증하지만, `LongAdder`는 내부적으로 셀을 분산해 경합을 흩는다. 카운터처럼 "읽기는 가끔, 증가는 매우 자주"인 워크로드에 맞는다.

`flush`에서 `remove`로 키를 떼어내며 스냅샷하는 이유는, flush 도중 들어온 새 이벤트가 *다음 주기*에 깔끔히 누산되게 하기 위함이다. 맵을 비우는 사이에 들어온 증가분을 놓치지 않는다.

## 운영 함정

**1) flush 전 종료 시 누산분 유실.** 메모리 누산기의 본질적 위험이다. flush 주기 사이에 프로세스가 죽으면 아직 안 내려간 카운트가 통째로 사라진다. 정확도가 중요하면 **종료 훅에서 강제 flush**를 걸고, 그래도 메모리 손실(OOM kill 등)은 막을 수 없으니 *근사치를 허용할 수 있는 지표에만* 이 패턴을 쓴다. 정산처럼 한 건도 틀리면 안 되는 값은 원장(ledger)을 따로 둔다.

**2) 누산 맵 무한 증가.** 키가 (날짜 + 대상)이면 날짜가 바뀔수록 키가 쌓인다. 매 flush가 키를 비운다면 괜찮지만, 만약 flush가 값만 읽고 키를 안 지우면 맵이 끝없이 자란다. 그리고 대상 ID 카디널리티가 폭발적이면(고유 키 수백만) 누산 맵 자체가 메모리를 먹는다. 키 개수에 상한을 두거나, 키 수가 임계를 넘으면 즉시 flush하는 안전장치가 필요하다.

## 핵심 요약 / 면접 Q&A

- **Q. 왜 메모리에서 먼저 누산하나?** A. 매 이벤트 DB 갱신은 핫 로우 경합과 잦은 왕복을 만든다. 메모리에서 접으면 N건이 1건의 upsert로 줄어 DB 쓰기 빈도가 이벤트 빈도와 분리된다.
- **Q. 동시성은 어떻게 잡나?** A. `ConcurrentHashMap` + `LongAdder`. 고경합 카운터에서 CAS 재시도를 분산해 사실상 락 없이 증가한다.
- **Q. 가장 큰 위험은?** A. flush 전 종료 시 유실. 종료 훅 강제 flush로 줄이되, 근본적으로 근사치 허용 지표에만 적용한다.
- **한 줄 정리:** 이벤트는 메모리에서 키별로 접고, 주기마다 한 번에 upsert. DB가 보는 쓰기는 이벤트 수가 아니라 키 수만큼이다.

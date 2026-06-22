---
title: "Redis 영속성: RDB vs AOF (그리고 MISCONF 에러)"
date: 2025-02-04 11:10:00 +0900
categories: [Infra, Redis]
tags: [redis, persistence, rdb, aof]
mermaid: true
image:
  path: /assets/img/posts/redis-persistence-rdb-aof.svg
  alt: "Redis 영속성 RDB vs AOF"
---

## 메모리에 있는데, 재시작하면 다 날아가나?

[Redis는 인메모리](/posts/redis-introduction/)라 "서버 끄면 데이터가 사라지는 거 아냐?"가 자연스러운 걱정입니다. 그래서 Redis는 메모리 데이터를 디스크에 남기는 **영속성(persistence)** 방식을 두 가지 제공합니다: **RDB**와 **AOF**.

## RDB — 스냅샷

특정 시점의 데이터 전체를 **스냅샷**으로 떠서 `dump.rdb` 파일로 저장합니다.

```mermaid
flowchart LR
    M["메모리 데이터"] -->|"주기적 fork + 저장"| R["dump.rdb<br/>(시점 스냅샷)"]
```

- 장점: 파일이 **컴팩트**하고, 복구(로딩)가 **빠름**. 백업·재해 복구에 적합.
- 단점: 스냅샷 **사이에 쌓인 데이터는 유실** 가능(예: 5분마다 저장이면 최대 5분치 손실).

```conf
save 900 1      # 900초 동안 1개 이상 변경 시 저장
save 300 10     # 300초 동안 10개 이상 변경 시 저장
```

## AOF — 명령 로그

데이터를 바꾸는 **쓰기 명령을 순서대로 기록**합니다. 재시작 시 이 명령들을 다시 실행해 복원합니다.

```mermaid
flowchart LR
    W["쓰기 명령<br/>SET / INCR ..."] -->|append| A["appendonly.aof<br/>(명령 로그)"]
    A -->|재시작 시 재실행| M["메모리 복원"]
```

- 장점: **유실 범위가 작다**(fsync 정책에 따라 최대 1초). 내구성↑.
- 단점: 파일이 RDB보다 크고, 복구가 느릴 수 있음.
- fsync 정책: `always`(가장 안전·느림), `everysec`(권장, 최대 1초 손실), `no`(OS에 맡김).

```conf
appendonly yes
appendfsync everysec
```

## 무엇을 쓸까

- 둘은 **함께 켤 수 있습니다.** 일반적으로 **AOF(내구성) + RDB(백업/빠른 복구)** 조합을 권장.
- 캐시 용도로 유실이 괜찮다면 둘 다 꺼서 순수 인메모리로 운영하기도 합니다.

| | RDB | AOF |
|---|---|---|
| 방식 | 스냅샷 | 명령 로그 |
| 유실 | 클 수 있음 | 작음(≤1초) |
| 복구 속도 | 빠름 | 느릴 수 있음 |
| 파일 크기 | 작음 | 큼 |

## MISCONF 에러 해결

운영하다 보면 이런 에러로 **쓰기가 막히는** 경우가 있습니다.

```text
MISCONF Redis is configured to save RDB snapshots, but it's currently
unable to persist to disk. Commands that may modify the data set are disabled.
```

이건 Redis가 백그라운드 스냅샷(bgsave)에 **실패**해서, 데이터 보호를 위해 쓰기를 막은 상태입니다. 원인과 해결:

1. **디스크 부족**: 가장 흔한 원인. `df -h`로 확인하고 공간 확보.
2. **권한 문제**: `dir`로 지정된 저장 경로에 Redis가 쓸 수 있는지 확인.
3. **메모리 부족(fork 실패)**: 스냅샷은 `fork`로 메모리를 복제하는데, 메모리가 빠듯하면 실패. `vm.overcommit_memory = 1` 설정 권장.

근본 원인을 고치는 게 우선이고, **임시방편**으로 쓰기 차단만 풀려면:

```bash
redis-cli config set stop-writes-on-bgsave-error no
```

> 단, 이건 "스냅샷이 실패해도 쓰기는 허용"으로 바꾸는 거라 **유실 위험을 감수**하는 임시 조치입니다. 반드시 디스크/권한/메모리 원인을 해결하세요.
{: .prompt-warning }

## 정리

- **RDB**(스냅샷): 작고 빠른 복구, 유실 가능. **AOF**(명령 로그): 내구성↑, 파일 큼.
- 보통 **AOF + RDB 병행**. 캐시 전용이면 둘 다 끄기도.
- **MISCONF 에러**는 스냅샷 실패 → 디스크/권한/메모리를 점검해 근본 해결.

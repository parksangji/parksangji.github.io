---
title: "Bitmap Scan이 lossy로 떨어질 때: work_mem과 실행계획의 단위"
date: 2026-08-28 10:30:00 +0900
series: "PostgreSQL"
categories: [Database]
tags: [postgresql, explain, bitmap-scan, work-mem, index, query-tuning]
description: "Heap Blocks의 lossy가 무엇이고 Rows Removed by Index Recheck가 왜 폭발하는지, work_mem 증설과 인덱스 설계 중 어느 쪽이 진짜 처방인지 다룬다."
---

실행계획을 읽다가 가장 자주 미끄러지는 지점은 노드 이름이 아니라 **숫자의 단위**다. 블록으로 찍힌 값을 행으로 읽는 순간 진단 전체가 통째로 어긋난다. 아래 계획 조각을 놓고 그 함정과, 거기서 이어지는 `work_mem` 이야기를 정리한다.

```text
Bitmap Heap Scan on ...  (actual rows=284102 loops=1)
  Recheck Cond: (...)
  Rows Removed by Index Recheck: 1902884
  Heap Blocks: exact=12081 lossy=71120
  Buffers: shared hit=83201
  ->  BitmapAnd  (actual rows=0 loops=1)
        ->  Bitmap Index Scan on ...
        ->  Bitmap Index Scan on ...
...
Sort Method: external merge  Disk: 141920kB
```

## 노드 이름과 단위를 같이 읽는다

계획에 찍히는 숫자는 줄마다 단위가 다르다.

- `Heap Blocks: exact= lossy=` — **블록(페이지) 개수**. 행이 아니다.
- `rows=` — 행.
- `Buffers: shared hit/read` — 블록.
- `Disk: 141920kB` — KB.

즉 위 계획의 `lossy=71120`은 "버려진 행 71,120건"이 아니라 **lossy 방식으로 기록된 페이지가 71,120개**라는 뜻이다. 버려진 행 수는 바로 위 `Rows Removed by Index Recheck: 1902884` 쪽이다.

## exact와 lossy — 비트맵이 해상도를 잃는 순간

Bitmap Index Scan은 조건에 맞는 튜플의 위치(TID)를 메모리에 비트맵으로 모은다. 이 비트맵이 `work_mem`을 넘기려 하면 PostgreSQL은 비트맵을 버리는 대신 **해상도를 떨어뜨린다.**

```text
exact : "3번 페이지의 7번, 12번, 40번 튜플"   ← 튜플 단위
lossy : "3번 페이지 어딘가에 있음"            ← 페이지 단위, 어느 튜플인지 잃어버림
```

## Recheck Cond는 장식이 아니다

lossy 페이지는 "어느 튜플인지 모르니 그 페이지의 튜플을 전부 꺼내서 다시 판정"해야 한다. 그래서 `Recheck Cond`라는 줄이 있는 것이고, 그건 표시가 아니라 실제로 다시 도는 판정이다.

페이지당 30개쯤 들어있다고 치면,

```text
71,120 페이지 × 약 30 튜플 ≈ 213만 건 재판정
                          → 190만 건 조건 불일치로 탈락
                          = Rows Removed by Index Recheck: 1,902,884
```

**비트맵이 커지면 recheck가 폭발한다.** lossy와 recheck는 별개 증상이 아니라 하나의 인과다.

## work_mem은 서버 예산이 아니라 노드당 한도

비트맵이 `work_mem` 안에 들어가면 전부 exact로 유지되어 `lossy=0`, `Rows Removed by Index Recheck: 0`이 된다.

```sql
SET work_mem = '256MB';   -- 세션 단위
```

대가가 진짜 포인트다. `work_mem`은 서버 전체가 나눠 쓰는 예산이 아니라 **연산 노드 하나당** 한도다. 커넥션 하나가 Sort 2개 + HashJoin 1개 + Bitmap 1개를 돌리면 그 쿼리 하나가 `work_mem × 4`를 쓴다.

```text
256MB × 4 노드 × 100 커넥션 = 100GB   ← 이론적 최악
```

실제로 전부 동시에 최대치를 쓰진 않지만, `postgresql.conf`에서 전역으로 올리는 건 OOM Killer가 postmaster를 잡아가는 가장 흔한 경로다. 그래서 원칙은 하나다 — **전역은 보수적으로(4~64MB), 무거운 배치·리포트 쿼리에만 세션 단위로 올린다.** 배치 전용 커넥션에서는 정당한 패턴이고, 사용자 API 커넥션에서는 위험하다.

## Sort Method의 두 얼굴

정렬 노드도 같은 한도를 쓴다.

```text
Sort Method: quicksort       Memory: 8210kB    ← 메모리 안에서 끝남
Sort Method: external merge  Disk: 141920kB    ← 스필. 임시 파일로 쏟아냄
```

`external merge Disk:`가 보이면 정렬 대상이 `work_mem`에 안 들어갔다는 신호다. 약 142MB를 썼다는 건 그 이상으로 올려야 메모리 정렬이 된다는 뜻이다.

## 그래서 파라미터냐 인덱스냐

`work_mem`을 올리면 lossy도 없어지고 external merge도 없어진다. 계획은 확실히 빨라진다. 하지만 **이 쿼리가 하는 일의 양 자체는 그대로다.** `LIMIT 20`이 붙은 위 쿼리를 두 처방으로 비교하면 이렇다.

| | work_mem 증설 | 복합 인덱스 |
|---|---|---|
| 힙 블록 읽기 | 83,201 (그대로) | 약 24 |
| 정렬 대상 행 | 284,102 (그대로) | 0 — 정렬 자체가 없음 |
| 최종 반환 | 20 | 20 |
| 비용 성격 | O(전체 매칭 건수) | O(LIMIT) |

28만 건을 읽고 정렬해서 20건만 빼고 전부 버리는 구조는 그대로 남는다. 데이터가 두 배로 늘면 다시 느려진다.

> **파라미터 튜닝은 낭비를 빠르게 만들고, 인덱스 설계는 낭비를 없앤다.**
{: .prompt-tip }

## 운영 함정

**함정 1 — `LIMIT`이 계획 해석을 왜곡한다.** 최종 반환이 20건이라고 가벼운 쿼리가 아니다. 정렬 노드 아래에서 이미 28만 건을 읽고 정렬한 뒤 20건만 남긴 것이다. 반환 행 수가 아니라 **정렬·스캔 노드의 입력 행 수**를 봐야 한다.

**함정 2 — `BitmapAnd (actual rows=0)`은 버그가 아니다.** 비트맵 노드는 행을 반환하지 않고 비트맵만 만들기 때문에 항상 0으로 찍힌다. 여기서 "행이 안 나온다"고 진단하면 엉뚱한 곳을 판다.

**함정 3 — 전역 `work_mem` 증설.** 세션에서 올려 효과를 봤다고 그대로 `postgresql.conf`에 옮기면, 노드당 한도라는 성질 때문에 커넥션 수만큼 곱해져 터진다.

## 면접 한 줄 Q&A

- **Q. `Heap Blocks: lossy=71120`은 무슨 뜻인가?** A. lossy 방식으로 기록된 **페이지가 71,120개**라는 뜻이다. 비트맵이 `work_mem`을 넘겨 튜플 단위 해상도를 잃고 페이지 단위로 떨어진 것이고, 그래서 해당 페이지의 모든 튜플을 다시 판정해야 한다.
- **Q. `Rows Removed by Index Recheck`가 큰데 어떻게 하나?** A. 원인은 lossy 비트맵이다. `work_mem`을 세션 단위로 올리면 exact로 유지되어 사라지지만, 그건 증상 처방이다. 접근 경로 자체가 O(전체 매칭 건수)면 인덱스로 O(LIMIT)을 만들어야 한다.
- **Q. `work_mem`을 전역으로 올리면 왜 위험한가?** A. 서버 전체 예산이 아니라 **연산 노드당** 한도이기 때문이다. 커넥션 하나가 Sort·HashJoin·Bitmap을 동시에 쓰면 그 배수만큼 잡히고, 커넥션 수까지 곱해지면 OOM으로 이어진다.
- **Q. `Sort Method: external merge Disk:`는?** A. 정렬 대상이 `work_mem`에 안 들어가 디스크 임시 파일로 스필했다는 신호다. `quicksort Memory:`면 메모리 안에서 끝난 것이다.

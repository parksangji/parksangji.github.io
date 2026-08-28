---
title: "PostgreSQL 실행계획 읽는 법: 트리, 숫자, 그리고 단위"
date: 2026-08-28 10:30:00 +0900
series: "PostgreSQL"
categories: [Database]
tags: [postgresql, explain, query-plan, optimizer, cost, index-scan, join]
description: "실행계획을 트리로 읽는 순서, 노드 한 줄의 문법, cost와 actual의 의미, 숫자마다 다른 단위, 스캔·조인 노드의 종류와 선택 기준을 정리한 레퍼런스."
---

실행계획은 위에서 아래로 읽는 문장이 아니라 **트리**다. 그리고 트리에 찍힌 숫자들은 서로 단위가 다르다. 이 두 가지를 모르면 계획을 아무리 오래 들여다봐도 엉뚱한 결론이 나온다. 이 글은 특정 쿼리를 고치는 이야기가 아니라, **계획이라는 표기법 자체를 읽는 문법**을 정리한다.

MySQL 기준 `EXPLAIN`의 `type`·`key`·`Extra`를 읽는 법은 [실행계획 읽는 법: 옵티마이저의 속마음](/posts/explain-plan-reading/)에서 다뤘다. 여기서는 PostgreSQL의 트리형 계획을 다룬다.

## 계획은 트리다 — 안쪽부터, 아래부터

들여쓰기와 `->`가 부모·자식 관계를 나타낸다. 데이터는 **잎에서 뿌리로** 흐른다. 즉 가장 깊이 들여쓴 노드가 먼저 돌고, 맨 위 노드가 마지막이다.

<div class="ep-tree" markdown="0">
<style>
.ep-tree{margin:1.6rem 0;overflow-x:auto}
.ep-tree svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.ep-tree .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;fill:currentColor}
.ep-tree .sub{fill:currentColor;font-size:10px;opacity:.55}
.ep-tree .ord{font-size:10.5px;font-weight:700;fill:#fff}
.ep-tree circle.step{fill:#1864ab}
.ep-tree .flow{stroke:currentColor;opacity:.3;stroke-width:1.5;fill:none}
.ep-tree .rule{stroke:currentColor;opacity:.15;stroke-width:1}
:root[data-bs-theme='dark'] .ep-tree circle.step{fill:#4dabf7}
:root[data-bs-theme='dark'] .ep-tree .ord{fill:#10243a}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .ep-tree circle.step{fill:#4dabf7}
:root:not([data-bs-theme]) .ep-tree .ord{fill:#10243a}}
</style>
<svg viewBox="0 0 700 232" role="img" aria-label="실행계획 트리에서 가장 깊이 들여쓴 잎 노드가 먼저 실행되고 위쪽 부모 노드로 결과가 올라가는 실행 순서">
  <text class="sub" x="14" y="16">계획 표기</text>
  <text class="sub" x="470" y="16">실행 순서</text>
  <line class="rule" x1="14" y1="24" x2="686" y2="24"/>

  <text class="mono" x="14" y="48">Sort</text>
  <circle class="step" cx="486" cy="44" r="10"/><text class="ord" x="486" y="48" text-anchor="middle">4</text>
  <text class="sub" x="504" y="48">정렬해서 최종 반환</text>

  <text class="mono" x="34" y="76">-&gt;  Hash Join</text>
  <circle class="step" cx="486" cy="72" r="10"/><text class="ord" x="486" y="76" text-anchor="middle">3</text>
  <text class="sub" x="504" y="76">두 입력을 받아 조인</text>

  <text class="mono" x="62" y="104">-&gt;  Seq Scan on orders</text>
  <circle class="step" cx="486" cy="100" r="10"/><text class="ord" x="486" y="104" text-anchor="middle">1</text>
  <text class="sub" x="504" y="104">바깥 입력을 만든다</text>

  <text class="mono" x="62" y="140">-&gt;  Hash</text>
  <circle class="step" cx="486" cy="136" r="10"/><text class="ord" x="486" y="140" text-anchor="middle">2</text>
  <text class="sub" x="504" y="140">해시 테이블을 채운다</text>

  <text class="mono" x="90" y="168">-&gt;  Seq Scan on customers</text>
  <circle class="step" cx="486" cy="164" r="10"/><text class="ord" x="486" y="168" text-anchor="middle">1</text>
  <text class="sub" x="504" y="168">잎 노드가 먼저 돈다</text>

  <path class="flow" d="M104 158 L104 130"/>
  <path class="flow" d="M76 130 L76 88"/>
  <path class="flow" d="M48 88 L48 60"/>
  <text class="sub" x="14" y="206">데이터는 잎(아래·안쪽)에서 뿌리(위·바깥)로 올라간다.</text>
  <text class="sub" x="14" y="222">읽을 때도 같은 방향으로 읽는다 — 맨 위 노드부터 읽으면 원인이 아니라 결과를 먼저 보게 된다.</text>
</svg>
</div>

## 노드 한 줄의 해부

노드 한 줄에는 괄호가 최대 두 개 붙는다. 앞의 것은 **옵티마이저의 추정**, 뒤의 것은 **실제 실행 결과**다. 뒤쪽은 `EXPLAIN ANALYZE`로 실제 실행했을 때만 나온다.

<div class="ep-anat" markdown="0">
<style>
.ep-anat{margin:1.6rem 0;overflow-x:auto}
.ep-anat svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.ep-anat .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;fill:currentColor}
.ep-anat .sub{fill:currentColor;font-size:10px;opacity:.6}
.ep-anat .tag{font-size:10px;font-weight:700;fill:currentColor;opacity:.85}
.ep-anat .lead{stroke:currentColor;opacity:.28;stroke-width:1}
.ep-anat rect.hl{fill:none;stroke:#1864ab;stroke-width:1.3;opacity:.75}
.ep-anat rect.hl2{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.35}
:root[data-bs-theme='dark'] .ep-anat rect.hl{stroke:#4dabf7}
@media (prefers-color-scheme:dark){:root:not([data-bs-theme]) .ep-anat rect.hl{stroke:#4dabf7}}
</style>
<svg viewBox="0 0 700 268" role="img" aria-label="실행계획 노드 한 줄에서 cost의 시작 비용과 전체 비용, 추정 행 수, 행 폭, 그리고 actual의 시작 시각, 종료 시각, 실제 행 수, 반복 횟수가 각각 무엇을 뜻하는지 표시한 해부도">
  <text class="mono" x="14" y="26">Seq Scan on orders</text>

  <rect class="hl2" x="10" y="46" width="404" height="24" rx="4"/>
  <text class="mono" x="18" y="63">(cost=0.00..431.00 rows=1000 width=36)</text>
  <text class="tag" x="424" y="63">옵티마이저 추정</text>

  <line class="lead" x1="52" y1="70" x2="52" y2="88"/>
  <text class="sub" x="30" y="100">0.00</text>
  <text class="sub" x="30" y="114">첫 행까지의 비용</text>
  <line class="lead" x1="120" y1="70" x2="120" y2="128"/>
  <text class="sub" x="100" y="140">431.00 — 마지막 행까지의 비용</text>
  <line class="lead" x1="228" y1="70" x2="228" y2="156"/>
  <text class="sub" x="208" y="168">rows=1000 — 이 노드가 낼 것으로 추정한 행 수</text>
  <line class="lead" x1="350" y1="70" x2="350" y2="184"/>
  <text class="sub" x="330" y="196">width=36 — 행 하나의 평균 바이트</text>

  <rect class="hl" x="10" y="216" width="446" height="24" rx="4"/>
  <text class="mono" x="18" y="233">(actual time=0.012..1.234 rows=980 loops=1)</text>
  <text class="tag" x="466" y="233">실제 측정 (ANALYZE)</text>
  <text class="sub" x="14" y="260">actual time은 시작..종료 밀리초, rows는 실제 행 수, loops는 이 노드가 몇 번 실행됐는지.</text>
</svg>
</div>

## cost의 단위는 시간이 아니다

가장 많이 오해하는 부분이다. `cost=431.00`은 431밀리초도, 431마이크로초도 아니다. **단위 없는 상대값**이고, 기준은 "순차로 페이지 하나 읽기 = 1.0"이다. 나머지 파라미터가 이 1.0에 상대적으로 정의된다.

| 파라미터 | 기본값 | 의미 |
|---|---|---|
| `seq_page_cost` | 1.0 | **기준** — 순차로 페이지(8KB) 하나 읽기 |
| `random_page_cost` | 4.0 | 랜덤 위치의 페이지 하나 읽기 (4배 비싸다고 가정) |
| `cpu_tuple_cost` | 0.01 | 튜플 하나 처리 |
| `cpu_index_tuple_cost` | 0.005 | 인덱스 엔트리 하나 처리 |
| `cpu_operator_cost` | 0.0025 | 연산자·함수 한 번 실행 |

여기서 두 가지가 따라 나온다.

**첫째, `random_page_cost = 4.0`은 HDD 시절의 가정이다.** 회전 디스크에서는 랜덤 탐색이 순차 읽기보다 훨씬 비쌌다. SSD·NVMe에서는 그 격차가 훨씬 작아서, 보통 `1.1`~`2.0`으로 낮춘다. 이 값이 4.0으로 남아 있으면 옵티마이저는 인덱스 스캔(랜덤 접근)을 실제보다 비싸게 보고 **Seq Scan을 과도하게 선호**한다.

**둘째, cost는 계획끼리 비교하라고 있는 값이지 성능 지표가 아니다.** 같은 쿼리의 계획 A와 B 중 무엇을 고를지 판단하는 데 쓰는 상대 점수다. 서로 다른 쿼리의 cost를 비교하거나, cost를 예상 소요시간으로 환산하는 건 의미가 없다.

## 추정과 실제가 벌어지는 곳이 튜닝 지점

`EXPLAIN ANALYZE`의 진짜 값어치는 `rows=`(추정)와 `actual rows=`(실제)를 나란히 볼 수 있다는 데 있다. 옵티마이저는 통계를 근거로 계획을 고르므로, **추정이 틀리면 계획 선택 자체가 틀린다.**

| 어긋남의 방향 | 옵티마이저가 저지르는 실수 | 흔한 원인 |
|---|---|---|
| 추정 ≪ 실제 (과소추정) | Nested Loop를 골랐는데 안쪽이 수만 번 돈다 | 통계 노후, 상관관계 있는 다중 조건 |
| 추정 ≫ 실제 (과대추정) | 필요 없는 Hash/Sort에 메모리를 잡는다 | 편향된 분포, 부정확한 선택도 |

자릿수 단위로 벌어지면 그 노드가 출발점이다. 먼저 `ANALYZE`로 통계를 갱신하고, 그래도 남으면 다중 컬럼 통계(`CREATE STATISTICS`)나 쿼리 재작성을 본다.

## loops — 안쪽 노드의 숫자는 1회 평균이다

`loops`가 1보다 크면 그 노드는 여러 번 실행됐다는 뜻이다. **이때 표시되는 `actual time`과 `rows`는 총합이 아니라 1회 평균이다.** 곱하지 않으면 병목을 통째로 놓친다.

<div class="ep-loops" markdown="0">
<style>
.ep-loops{margin:1.6rem 0;overflow-x:auto}
.ep-loops svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.ep-loops .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;fill:currentColor}
.ep-loops .sub{fill:currentColor;font-size:10.5px;opacity:.6}
.ep-loops .big{font-size:13px;font-weight:700;fill:currentColor}
.ep-loops .lead{stroke:currentColor;opacity:.28;stroke-width:1}
.ep-loops .rule{stroke:currentColor;opacity:.15;stroke-width:1}
.ep-loops rect.u{fill:#4dabf7}
.ep-loops rect.tot{fill:#1864ab}
:root[data-bs-theme='dark'] .ep-loops rect.u{fill:#a5d8ff}
:root[data-bs-theme='dark'] .ep-loops rect.tot{fill:#4dabf7}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .ep-loops rect.u{fill:#a5d8ff}
:root:not([data-bs-theme]) .ep-loops rect.tot{fill:#4dabf7}}
</style>
<svg viewBox="0 0 700 210" role="img" aria-label="loops가 20인 노드에서 표시된 3.4밀리초는 1회 평균이며 총합은 20을 곱한 68밀리초라는 것을 막대로 비교">
  <text class="mono" x="14" y="24">-&gt;  Aggregate  (actual time=3.412..3.413 rows=6 loops=20)</text>
  <line class="lead" x1="468" y1="30" x2="468" y2="46"/>
  <text class="sub" x="404" y="58">이 노드는 20번 실행됐다</text>

  <line class="rule" x1="14" y1="76" x2="686" y2="76"/>
  <text class="sub" x="14" y="98">계획에 찍힌 값 (1회 평균)</text>
  <rect class="u" x="180" y="86" width="24" height="16" rx="4"/>
  <text class="big" x="214" y="99">3.4 ms</text>
  <text class="sub" x="272" y="99">· rows 6</text>

  <text class="sub" x="14" y="136">실제 총합 (× loops)</text>
  <rect class="tot" x="180" y="124" width="480" height="16" rx="4"/>
  <text class="big" x="180" y="160">68 ms</text>
  <text class="sub" x="232" y="160">· rows 120  —  3.4 × 20, 6 × 20</text>

  <text class="sub" x="14" y="192">Nested Loop 안쪽에서 특히 자주 물린다. loops를 곱하지 않으면 전체의 80%를 먹는 노드가 3ms짜리로 보인다.</text>
</svg>
</div>

## 숫자마다 단위가 다르다

같은 계획 안에서도 줄마다 단위가 다르다. 이 표는 외워 두는 편이 빠르다.

| 계획에 찍히는 표기 | 단위 |
|---|---|
| `rows=` / `actual rows=` | **행** |
| `cost=` | 단위 없는 **상대값** (seq_page_cost = 1.0 기준) |
| `actual time=` | **밀리초**, `시작..종료` |
| `width=` | **바이트** (행 하나의 평균 폭) |
| `loops=` | **횟수** |
| `Buffers: shared hit/read/dirtied` | **블록(8KB 페이지)** |
| `Heap Blocks: exact= lossy=` | **블록** |
| `Sort Method ... Memory:` / `Disk:` | **KB** |
| `Heap Fetches:` | **횟수** |

> 노드 이름과 단위를 같이 읽는다. 숫자만 보고 "몇 건"이라고 단정하는 순간 진단이 어긋난다. `Heap Blocks`는 블록이지 행이 아니다.
{: .prompt-tip }

## 스캔 노드 네 가지

테이블에서 행을 꺼내는 방법은 크게 넷이다. 옵티마이저는 **선택도**(조건에 걸리는 행의 비율)를 보고 고른다.

<div class="ep-scan" markdown="0">
<style>
.ep-scan{margin:1.6rem 0;overflow-x:auto}
.ep-scan svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.ep-scan .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.ep-scan .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.ep-scan .ax{fill:currentColor;font-size:9.5px;opacity:.5}
.ep-scan .rule{stroke:currentColor;opacity:.16;stroke-width:1}
.ep-scan rect.band{fill:#4dabf7}
.ep-scan rect.band2{fill:#228be6}
.ep-scan rect.band3{fill:#1864ab}
:root[data-bs-theme='dark'] .ep-scan rect.band{fill:#a5d8ff}
:root[data-bs-theme='dark'] .ep-scan rect.band2{fill:#4dabf7}
:root[data-bs-theme='dark'] .ep-scan rect.band3{fill:#1c7ed6}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .ep-scan rect.band{fill:#a5d8ff}
:root:not([data-bs-theme]) .ep-scan rect.band2{fill:#4dabf7}
:root:not([data-bs-theme]) .ep-scan rect.band3{fill:#1c7ed6}}
</style>
<svg viewBox="0 0 700 196" role="img" aria-label="선택도가 낮을수록 인덱스 스캔, 중간이면 비트맵 스캔, 높으면 순차 스캔이 유리하다는 구간 그래프">
  <text class="lbl" x="14" y="18">선택도에 따른 접근 경로 선택</text>
  <text class="sub" x="14" y="34">선택도 = 조건에 걸리는 행 ÷ 전체 행</text>

  <rect class="band" x="14" y="52" width="150" height="26" rx="4"/>
  <rect class="band2" x="168" y="52" width="212" height="26" rx="4"/>
  <rect class="band3" x="384" y="52" width="302" height="26" rx="4"/>

  <line class="rule" x1="14" y1="88" x2="686" y2="88"/>
  <text class="ax" x="14" y="102">0%</text>
  <text class="ax" x="152" y="102">~1%</text>
  <text class="ax" x="360" y="102">~20%</text>
  <text class="ax" x="668" y="102">100%</text>

  <text class="lbl" x="14" y="128">Index Scan</text>
  <text class="sub" x="14" y="144">몇 행만 집는다.</text>
  <text class="sub" x="14" y="158">힙 접근은 랜덤.</text>

  <text class="lbl" x="196" y="128">Bitmap Heap Scan</text>
  <text class="sub" x="196" y="144">위치를 비트맵에 모아</text>
  <text class="sub" x="196" y="158">페이지 순서로 정렬해 읽는다.</text>

  <text class="lbl" x="416" y="128">Seq Scan</text>
  <text class="sub" x="416" y="144">어차피 대부분을 읽을 거면</text>
  <text class="sub" x="416" y="158">순차로 훑는 게 싸다.</text>
  <text class="sub" x="14" y="188">경계는 고정값이 아니라 random_page_cost·테이블 크기·상관도(correlation)에 따라 움직인다.</text>
</svg>
</div>

| 노드 | 언제 고르나 | 특징 |
|---|---|---|
| **Seq Scan** | 선택도가 높거나 테이블이 작을 때 | 전체를 순차로. 인덱스가 있어도 자주 이긴다 |
| **Index Scan** | 선택도가 아주 낮을 때 | 인덱스로 위치를 찾고 힙에 랜덤 접근. 정렬 순서를 그대로 얻는다 |
| **Index Only Scan** | 필요한 컬럼이 인덱스 안에 다 있을 때 | 힙을 건너뛴다. 단 `Heap Fetches`가 0인지 확인해야 한다 |
| **Bitmap Heap Scan** | 선택도가 중간일 때 | 위치를 비트맵에 모아 페이지 순서로 읽어 랜덤 접근을 줄인다 |

`Index Only Scan`이 "인덱스만 읽는다"는 이름값을 하려면 조건이 하나 더 필요하다. 인덱스에는 튜플의 **가시성 정보가 없어서**, Visibility Map이 "이 페이지는 전부 보이는 튜플"이라고 표시해 준 경우에만 힙을 건너뛴다. 그 표시는 VACUUM이 갱신한다. 그래서 갱신이 잦고 VACUUM이 못 따라오는 테이블에서는 계획에 `Index Only Scan`이라고 찍혀도 `Heap Fetches`가 크게 나온다.

## 조인 노드 세 가지

| 노드 | 방식 | 유리한 조건 | 비용 성격 |
|---|---|---|---|
| **Nested Loop** | 바깥 행마다 안쪽을 탐색 | 바깥이 작고, 안쪽 조인 키에 인덱스가 있을 때 | `O(N × 안쪽 비용)` |
| **Hash Join** | 한쪽으로 해시 테이블을 만들고 다른 쪽을 훑음 | 양쪽이 크고 등가 조인일 때 | `O(N + M)`, 해시가 `work_mem`을 씀 |
| **Merge Join** | 양쪽을 정렬해 나란히 훑음 | 이미 정렬돼 있거나 정렬이 싼 경우 | 정렬 비용 + `O(N + M)` |

Nested Loop는 `loops`가 붙는 유일한 조인이라, 앞에서 본 **1회 평균 함정**이 여기서 나온다. 안쪽이 인덱스 한 번 타고 끝나면 반복이 많아도 싸고, 안쪽이 Seq Scan이면 반복 수만큼 그대로 곱해져 터진다. **비용을 정하는 건 `loops` 수가 아니라 안쪽 노드의 복잡도다.**

## 경고 신호 사전

계획에서 이 줄들이 보이면 각각 정해진 의심 지점이 있다.

| 보이는 줄 | 무슨 뜻 | 의심할 것 |
|---|---|---|
| `Rows Removed by Filter: N` | 읽고 나서 버린 행 | 인덱스로 미리 걸렀어야 할 조건 |
| `Rows Removed by Index Recheck: N` | 비트맵 재판정에서 버린 행 | `work_mem` 부족으로 lossy 강등 |
| `Heap Blocks: lossy=N` | 페이지 단위로만 기록된 비트맵 | 위와 같은 원인 |
| `Sort Method: external merge  Disk: N kB` | 정렬이 디스크로 넘침 | `work_mem` 부족, 또는 정렬을 없앨 인덱스 |
| `Heap Fetches: N` (0이 아님) | Index Only인데 힙에 감 | VACUUM 지연, Visibility Map 미갱신 |
| `Buffers: shared read=N` 이 큼 | 캐시에 없어 디스크에서 읽음 | 워킹셋 대비 `shared_buffers` 부족 |
| 추정 rows와 actual rows가 자릿수 차이 | 통계가 현실과 다름 | `ANALYZE`, 다중 컬럼 통계 |

> `BitmapAnd`나 `BitmapOr`의 `actual rows=0`은 버그가 아니다. 비트맵 노드는 행을 반환하지 않고 비트맵만 만들기 때문에 항상 0으로 찍힌다.
{: .prompt-info }

## EXPLAIN 옵션

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT TEXT) SELECT ...;
```

| 옵션 | 무엇이 더 나오나 |
|---|---|
| `ANALYZE` | 실제로 실행해서 `actual time`·`rows`·`loops`를 붙인다 |
| `BUFFERS` | 노드마다 읽은 블록 수(`shared hit/read/dirtied`) |
| `VERBOSE` | 출력 컬럼 목록, 스키마 한정 이름 |
| `SETTINGS` | 기본값과 다른 플래너 파라미터 (계획이 이상할 때 결정적) |
| `WAL` | 쓰기 쿼리가 만든 WAL 양 |
| `FORMAT JSON` | 도구로 파싱하기 좋은 구조 |

`ANALYZE`는 **쿼리를 실제로 실행한다.** `INSERT`/`UPDATE`/`DELETE`에 붙이면 데이터가 바뀐다. 트랜잭션으로 감싸고 롤백하는 게 안전하다.

```sql
BEGIN;
EXPLAIN (ANALYZE, BUFFERS) UPDATE ...;
ROLLBACK;
```

## 면접 한 줄 Q&A

- **Q. 실행계획은 어느 방향으로 읽나?** A. 트리라서 가장 깊이 들여쓴 잎 노드가 먼저 실행되고 위로 올라간다. 맨 위부터 읽으면 원인이 아니라 결과를 먼저 보게 된다.
- **Q. `cost=431.00`은 몇 초인가?** A. 시간이 아니다. `seq_page_cost = 1.0`(순차 페이지 하나 읽기)을 기준으로 한 **단위 없는 상대값**이고, 같은 쿼리의 계획끼리 비교하라고 있는 값이다.
- **Q. `random_page_cost` 기본값 4.0을 왜 낮추나?** A. 회전 디스크 기준의 가정이라 SSD·NVMe에서는 과대평가다. 그대로 두면 옵티마이저가 인덱스 스캔을 비싸게 보고 Seq Scan을 과도하게 고른다.
- **Q. `loops=20`인 노드의 `actual time=3.4ms`는?** A. 1회 평균이다. 총합은 `3.4 × 20 ≈ 68ms`이고 행 수도 똑같이 곱해야 한다.
- **Q. 추정 rows와 실제 rows가 100배 차이 나면?** A. 통계가 현실과 다르다는 뜻이고, 그 노드가 잘못된 계획 선택의 출발점이다. `ANALYZE`로 갱신하고, 컬럼 간 상관관계가 원인이면 `CREATE STATISTICS`를 검토한다.
- **Q. `Index Only Scan`인데 느릴 수 있나?** A. `Heap Fetches`가 0이 아니면 힙에 가고 있다. 인덱스에 가시성 정보가 없어 Visibility Map에 의존하는데, VACUUM이 못 따라오면 이름만 Index Only다.

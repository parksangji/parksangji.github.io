---
title: "실행계획은 하드웨어에서 어떻게 도는가: 페이지, 버퍼, work_mem"
date: 2026-08-28 13:00:00 +0900
series: "PostgreSQL"
categories: [Database]
tags: [postgresql, shared-buffers, work-mem, memory, page, buffer-cache, io, explain]
description: "계획의 한 줄이 실제로는 디스크와 메모리에서 무슨 일인지 — 8KB 페이지, 저장 계층의 지연 시간, shared_buffers와 work_mem의 역할 분담, 노드별 메모리 사용과 초과 시 동작을 정리한다."
---

앞 글에서 실행계획을 **표기법**으로 읽는 법을 정리했다. 이 글은 그 아래층 — 계획의 한 줄이 실행될 때 **물리적으로 무슨 일이 일어나는가**를 다룬다. `Seq Scan`은 디스크의 어디를 어떻게 읽고, `Sort`가 쓰는 메모리는 어느 구역에서 나오며, 그 구역이 모자라면 무엇이 무너지는지.

## 모든 것은 8KB 페이지다

PostgreSQL이 디스크와 주고받는 최소 단위는 행이 아니라 **페이지(블록)** 이고, 기본 크기는 8KB다. 행 하나를 읽으려 해도 그 행이 든 페이지를 통째로 올린다. 계획에 찍히는 `Buffers`와 `Heap Blocks`가 전부 이 페이지의 개수다.

<div class="hw-page" markdown="0">
<style>
.hw-page{margin:1.6rem 0;overflow-x:auto}
.hw-page svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.hw-page .lbl{fill:currentColor;font-size:11px;font-weight:600}
.hw-page .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.hw-page rect.seg{stroke:none}
.hw-page rect.s1{fill:#1864ab}
.hw-page rect.s2{fill:#228be6}
.hw-page rect.s3{fill:currentColor;opacity:.14}
.hw-page rect.s4{fill:#4dabf7}
.hw-page rect.frame{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.35}
.hw-page .lead{stroke:currentColor;opacity:.3;stroke-width:1}
:root[data-bs-theme='dark'] .hw-page rect.s1{fill:#1c7ed6}
:root[data-bs-theme='dark'] .hw-page rect.s2{fill:#4dabf7}
:root[data-bs-theme='dark'] .hw-page rect.s4{fill:#a5d8ff}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .hw-page rect.s1{fill:#1c7ed6}
:root:not([data-bs-theme]) .hw-page rect.s2{fill:#4dabf7}
:root:not([data-bs-theme]) .hw-page rect.s4{fill:#a5d8ff}}
</style>
<svg viewBox="0 0 700 210" role="img" aria-label="8KB 페이지 하나의 내부 구조 — 페이지 헤더, 라인 포인터 배열, 빈 공간, 튜플들이 차지하는 영역">
  <text class="lbl" x="14" y="18">힙 페이지 1개 = 8192 바이트</text>
  <rect class="frame" x="12" y="30" width="676" height="42" rx="5"/>
  <rect class="seg s1" x="16" y="34" width="46" height="34"/>
  <rect class="seg s2" x="64" y="34" width="96" height="34"/>
  <rect class="seg s3" x="162" y="34" width="250" height="34"/>
  <rect class="seg s4" x="414" y="34" width="270" height="34"/>

  <line class="lead" x1="39" y1="72" x2="39" y2="92"/>
  <text class="lbl" x="14" y="106">헤더 24B</text>
  <text class="sub" x="14" y="120">여유 공간 위치 등</text>

  <line class="lead" x1="112" y1="72" x2="112" y2="92"/>
  <text class="lbl" x="88" y="106">라인 포인터</text>
  <text class="sub" x="88" y="120">튜플마다 4B — 페이지 내</text>
  <text class="sub" x="88" y="133">오프셋을 가리킨다</text>

  <line class="lead" x1="287" y1="72" x2="287" y2="92"/>
  <text class="lbl" x="262" y="106">빈 공간</text>
  <text class="sub" x="262" y="120">새 튜플이 들어올 자리</text>

  <line class="lead" x1="549" y1="72" x2="549" y2="92"/>
  <text class="lbl" x="470" y="106">튜플 (행 데이터)</text>
  <text class="sub" x="470" y="120">페이지 끝에서부터 앞으로 쌓인다</text>

  <text class="sub" x="14" y="166">행 하나가 100바이트라면 페이지당 약 70~80행. 그래서 "블록 1개"와 "행 1개"는 두 자릿수쯤 차이 난다.</text>
  <text class="sub" x="14" y="184">TID(튜플 식별자)는 (페이지 번호, 라인 포인터 번호) 쌍이다. 인덱스가 저장하는 위치 정보가 바로 이것이다.</text>
</svg>
</div>

## 저장 계층 — 한 칸 내려갈 때마다 자릿수가 바뀐다

계획의 비용이 왜 I/O 중심으로 짜여 있는지는 이 그래프 하나로 설명된다. CPU가 메모리에서 값을 꺼내는 시간과 디스크에서 페이지를 가져오는 시간은 **자릿수가 다르다.**

<div class="hw-lat" markdown="0">
<style>
.hw-lat{margin:1.6rem 0;overflow-x:auto}
.hw-lat svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.hw-lat .lbl{fill:currentColor;font-size:11px;font-weight:600}
.hw-lat .sub{fill:currentColor;font-size:9.5px;opacity:.58}
.hw-lat .val{fill:currentColor;font-size:10.5px;font-weight:700}
.hw-lat .ax{fill:currentColor;font-size:9px;opacity:.45}
.hw-lat .grid{stroke:currentColor;opacity:.12;stroke-width:1}
.hw-lat .base{stroke:currentColor;opacity:.28;stroke-width:1}
.hw-lat rect.b1{fill:#4dabf7}
.hw-lat rect.b2{fill:#228be6}
.hw-lat rect.b3{fill:#1864ab}
.hw-lat rect.b4{fill:#0b3d66}
:root[data-bs-theme='dark'] .hw-lat rect.b1{fill:#a5d8ff}
:root[data-bs-theme='dark'] .hw-lat rect.b2{fill:#4dabf7}
:root[data-bs-theme='dark'] .hw-lat rect.b3{fill:#1c7ed6}
:root[data-bs-theme='dark'] .hw-lat rect.b4{fill:#1864ab}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .hw-lat rect.b1{fill:#a5d8ff}
:root:not([data-bs-theme]) .hw-lat rect.b2{fill:#4dabf7}
:root:not([data-bs-theme]) .hw-lat rect.b3{fill:#1c7ed6}
:root:not([data-bs-theme]) .hw-lat rect.b4{fill:#1864ab}}
</style>
<svg viewBox="0 0 700 258" role="img" aria-label="CPU 캐시 1나노초, 메모리 100나노초, NVMe SSD 100마이크로초, HDD 탐색 10밀리초의 접근 지연을 로그 눈금 막대로 비교한 그래프">
  <text class="lbl" x="14" y="16">계층별 접근 지연 — 가로축 로그 눈금</text>

  <line class="grid" x1="196" y1="30" x2="196" y2="196"/>
  <line class="grid" x1="318" y1="30" x2="318" y2="196"/>
  <line class="grid" x1="440" y1="30" x2="440" y2="196"/>
  <line class="grid" x1="562" y1="30" x2="562" y2="196"/>
  <line class="grid" x1="684" y1="30" x2="684" y2="196"/>

  <text class="lbl" x="14" y="54">CPU L1 캐시</text>
  <rect class="b1" x="140" y="44" width="56" height="14" rx="4"/>
  <text class="val" x="204" y="55">1 ns</text>

  <text class="lbl" x="14" y="90">메모리 (RAM)</text>
  <rect class="b2" x="140" y="80" width="178" height="14" rx="4"/>
  <text class="val" x="326" y="91">100 ns</text>

  <text class="lbl" x="14" y="126">NVMe SSD</text>
  <rect class="b3" x="140" y="116" width="422" height="14" rx="4"/>
  <text class="val" x="570" y="127">100 µs</text>

  <text class="lbl" x="14" y="162">HDD 탐색</text>
  <rect class="b4" x="140" y="152" width="544" height="14" rx="4"/>
  <text class="val" x="608" y="176">10 ms</text>

  <line class="base" x1="140" y1="196" x2="684" y2="196"/>
  <text class="ax" x="140" y="210">1 ns</text>
  <text class="ax" x="290" y="210">1 µs</text>
  <text class="ax" x="412" y="210">100 µs</text>
  <text class="ax" x="534" y="210">1 ms</text>
  <text class="ax" x="654" y="210">10 ms</text>

  <text class="sub" x="14" y="238">1ns를 1초로 환산하면 — 메모리는 1분 40초, NVMe는 하루 남짓, HDD 탐색은 넉 달이다.</text>
  <text class="sub" x="14" y="252">DB 튜닝이 "디스크에 덜 가기"에 집착하는 이유가 이 격차다.</text>
</svg>
</div>

## 블록 하나가 올라오는 경로

노드가 페이지를 요구하면 아래 순서로 찾는다. 위쪽에서 찾으면 아래로 안 내려간다.

<div class="hw-path" markdown="0">
<style>
.hw-path{margin:1.6rem 0;overflow-x:auto}
.hw-path svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.hw-path .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.hw-path .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.hw-path .tag{font-size:10px;font-weight:700}
.hw-path rect.box{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.4}
.hw-path rect.hit{fill:none;stroke:#1864ab;stroke-width:1.6}
.hw-path .arr{stroke:currentColor;opacity:.32;stroke-width:1.4;fill:none}
.hw-path .thit{fill:#1864ab}
.hw-path .tread{fill:currentColor;opacity:.7}
:root[data-bs-theme='dark'] .hw-path rect.hit{stroke:#4dabf7}
:root[data-bs-theme='dark'] .hw-path .thit{fill:#4dabf7}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .hw-path rect.hit{stroke:#4dabf7}
:root:not([data-bs-theme]) .hw-path .thit{fill:#4dabf7}}
</style>
<svg viewBox="0 0 700 216" role="img" aria-label="실행 노드가 요청한 블록을 shared_buffers에서 찾고 없으면 OS 페이지 캐시, 그다음 디스크 순으로 내려가는 경로">
  <rect class="box" x="14" y="52" width="104" height="46" rx="6"/>
  <text class="lbl" x="66" y="72" text-anchor="middle">실행 노드</text>
  <text class="sub" x="66" y="88" text-anchor="middle">블록 요청</text>

  <rect class="hit" x="164" y="52" width="130" height="46" rx="6"/>
  <text class="lbl" x="229" y="72" text-anchor="middle">shared_buffers</text>
  <text class="sub" x="229" y="88" text-anchor="middle">PostgreSQL 자체 캐시</text>

  <rect class="box" x="340" y="52" width="130" height="46" rx="6"/>
  <text class="lbl" x="405" y="72" text-anchor="middle">OS 페이지 캐시</text>
  <text class="sub" x="405" y="88" text-anchor="middle">커널이 들고 있는 사본</text>

  <rect class="box" x="516" y="52" width="130" height="46" rx="6"/>
  <text class="lbl" x="581" y="72" text-anchor="middle">디스크</text>
  <text class="sub" x="581" y="88" text-anchor="middle">실제 파일</text>

  <line class="arr" x1="118" y1="75" x2="164" y2="75"/>
  <line class="arr" x1="294" y1="75" x2="340" y2="75"/>
  <line class="arr" x1="470" y1="75" x2="516" y2="75"/>

  <text class="tag thit" x="229" y="126" text-anchor="middle">여기서 찾으면  hit</text>
  <text class="sub" x="229" y="142" text-anchor="middle">Buffers: shared hit=N</text>

  <text class="tag tread" x="493" y="126" text-anchor="middle">여기까지 내려가면  read</text>
  <text class="sub" x="493" y="142" text-anchor="middle">Buffers: shared read=N</text>

  <text class="sub" x="14" y="180">`read`로 집계돼도 실제로는 OS 페이지 캐시에서 온 것일 수 있다. PostgreSQL 입장에서는 자기 버퍼에 없었으면 전부 read다.</text>
  <text class="sub" x="14" y="198">그래서 `read`가 크다고 반드시 디스크 I/O가 일어난 건 아니지만, 어느 쪽이든 hit보다는 비싸다.</text>
</svg>
</div>

`hit`가 줄여 주는 건 **I/O 비용**이지 **읽어야 하는 블록 수**가 아니다. 블록을 hit 하려면 버퍼 해시 테이블을 뒤지고 핀을 걸고 락을 잡고 그 8KB 안에서 튜플을 하나씩 꺼내 조건을 판정한다. `read=0`이어도 블록 수가 수만이면 그 CPU 비용이 그대로 쿼리 시간이 된다. **블록 수 자체를 줄이는 건 인덱스의 일이다.**

## RAM 안의 두 구역 — 공유 캐시와 사설 작업대

PostgreSQL이 쓰는 메모리는 성격이 완전히 다른 두 덩어리로 나뉜다. 튜닝에서 이 둘을 섞어 생각하면 반드시 사고가 난다.

<div class="hw-mem" markdown="0">
<style>
.hw-mem{margin:1.6rem 0;overflow-x:auto}
.hw-mem svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.hw-mem .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.hw-mem .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.hw-mem .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55;letter-spacing:.06em}
.hw-mem rect.box{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.35}
.hw-mem rect.sh{fill:#1864ab;opacity:.16;stroke:#1864ab;stroke-width:1.4}
.hw-mem rect.wm{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.5}
.hw-mem rect.node{fill:#1864ab;fill-opacity:.16;stroke:#1864ab;stroke-width:1.2}
:root[data-bs-theme='dark'] .hw-mem rect.sh{fill:#4dabf7;opacity:.2;stroke:#4dabf7}
:root[data-bs-theme='dark'] .hw-mem rect.node{fill:#4dabf7;fill-opacity:.2;stroke:#4dabf7}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .hw-mem rect.sh{fill:#4dabf7;opacity:.2;stroke:#4dabf7}
:root:not([data-bs-theme]) .hw-mem rect.node{fill:#4dabf7;fill-opacity:.2;stroke:#4dabf7}}
</style>
<svg viewBox="0 0 700 244" role="img" aria-label="서버 기동 시 한 덩어리로 잡히는 공유 shared_buffers와 커넥션마다 노드마다 따로 잡히는 사설 work_mem의 구조 비교">
  <text class="cap" x="14" y="16">공유 영역 — 서버에 하나</text>
  <rect class="sh" x="12" y="26" width="320" height="72" rx="6"/>
  <text class="lbl" x="172" y="52" text-anchor="middle">shared_buffers</text>
  <text class="sub" x="172" y="70" text-anchor="middle">테이블·인덱스 페이지 캐시</text>
  <text class="sub" x="172" y="86" text-anchor="middle">기동 시 한 덩어리로 확보 · 모든 커넥션이 공유</text>

  <text class="cap" x="368" y="16">사설 영역 — 노드마다 따로</text>
  <rect class="box" x="366" y="26" width="322" height="72" rx="6"/>
  <text class="sub" x="378" y="44">커넥션 1의 쿼리</text>
  <rect class="node" x="378" y="52" width="62" height="18" rx="4"/>
  <text class="sub" x="409" y="65" text-anchor="middle">Sort</text>
  <rect class="node" x="446" y="52" width="62" height="18" rx="4"/>
  <text class="sub" x="477" y="65" text-anchor="middle">Sort</text>
  <rect class="node" x="514" y="52" width="76" height="18" rx="4"/>
  <text class="sub" x="552" y="65" text-anchor="middle">HashJoin</text>
  <rect class="node" x="596" y="52" width="76" height="18" rx="4"/>
  <text class="sub" x="634" y="65" text-anchor="middle">Bitmap</text>
  <text class="sub" x="378" y="88">노드 하나하나가 각자 work_mem 한도까지 잡는다</text>

  <text class="sub" x="14" y="132">shared_buffers는 "디스크에서 꺼내온 페이지를 다 같이 쓰라고 쌓아둔 공용 창고"다.</text>
  <text class="sub" x="14" y="150">work_mem은 "정렬하려고 꺼낸 카드를 늘어놓는 개인 작업 책상"이다. 책상은 사람마다, 작업마다 따로 편다.</text>
  <text class="sub" x="14" y="176">그래서 총 사용량의 성격이 다르다 —</text>
  <text class="lbl" x="14" y="198">shared_buffers : 설정값 그대로 (고정)</text>
  <text class="lbl" x="14" y="220">work_mem       : 설정값 × 노드 수 × 동시 커넥션 수 (변동)</text>
</svg>
</div>

| | shared_buffers | work_mem |
|---|---|---|
| 범위 | 서버 전체 공유 | 연산 노드 하나당 |
| 담는 것 | 테이블·인덱스 **페이지 사본** | 정렬·해시·비트맵 **중간 결과** |
| 확보 시점 | 서버 기동 시 한 번 | 쿼리 실행 중 필요할 때 |
| 넘칠 때 | 오래된 페이지를 밀어냄 (clock sweep) | 디스크로 흘리거나 정밀도를 버림 |
| 총량 | 설정값 = 총량 | 설정값 × 노드 × 커넥션 |
| 일반적 설정 | 물리 메모리의 25% 내외 | 4~64MB, 무거운 쿼리만 세션 단위로 상향 |

## 노드마다 쓰는 메모리가 다르다

모든 노드가 `work_mem`을 쓰는 게 아니다. 어떤 노드는 스트리밍으로 흘려보내고, 어떤 노드는 입력을 다 모아야 결과를 낼 수 있다. 후자를 **블로킹 노드**라 하고, `work_mem`을 쓰는 건 이쪽이다.

| 노드 | 메모리 성격 | work_mem 사용 |
|---|---|---|
| Seq Scan | 링 버퍼(기본 256KB)만 순환 사용 — 큰 테이블이 캐시를 밀어내지 않게 | 안 씀 |
| Index Scan | 페이지 단위 랜덤 접근 | 안 씀 |
| Nested Loop | 한 행씩 흘려보냄 | 안 씀 |
| **Sort** | 입력을 다 모아야 첫 행이 나온다 | **씀** |
| **Hash / Hash Join** | 해시 테이블을 통째로 들고 있어야 한다 | **씀** |
| **Bitmap Index Scan** | 위치 비트맵을 모은다 | **씀** |
| **HashAggregate** | 그룹별 상태를 들고 있어야 한다 | **씀** |

> `Seq Scan`이 링 버퍼를 쓴다는 게 중요하다. 큰 테이블을 통째로 훑어도 `shared_buffers` 전체를 자기 페이지로 덮어쓰지 않는다. 순차 스캔 한 번이 캐시를 초토화하는 사고를 막는 장치다.
{: .prompt-info }

## work_mem을 넘기면 노드마다 다르게 무너진다

여기가 이 글의 핵심이다. 한도를 넘겼을 때 **모두 디스크로 가는 게 아니다.** 노드마다 대응이 다르고, 계획에 남는 흔적도 다르다.

<div class="hw-spill" markdown="0">
<style>
.hw-spill{margin:1.6rem 0;overflow-x:auto}
.hw-spill svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.hw-spill .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.hw-spill .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.hw-spill .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9.5px;fill:currentColor;opacity:.85}
.hw-spill .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.hw-spill rect.box{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.38}
.hw-spill rect.lim{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.55;stroke-dasharray:4 3}
.hw-spill rect.d{fill:#4dabf7}
.hw-spill rect.over{fill:#1864ab}
.hw-spill .rule{stroke:currentColor;opacity:.14;stroke-width:1}
:root[data-bs-theme='dark'] .hw-spill rect.d{fill:#a5d8ff}
:root[data-bs-theme='dark'] .hw-spill rect.over{fill:#4dabf7}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .hw-spill rect.d{fill:#a5d8ff}
:root:not([data-bs-theme]) .hw-spill rect.over{fill:#4dabf7}}
</style>
<svg viewBox="0 0 700 296" role="img" aria-label="work_mem 초과 시 Sort는 디스크 임시 파일로 스필하고, Hash Join은 배치로 쪼개고, Bitmap Index Scan은 페이지 단위 lossy로 강등된다는 세 가지 대응 비교">
  <text class="cap" x="14" y="16">work_mem 한도 (점선)를 넘겼을 때</text>

  <text class="lbl" x="14" y="46">Sort</text>
  <rect class="lim" x="160" y="34" width="150" height="20" rx="4"/>
  <rect class="d" x="164" y="38" width="142" height="12" rx="3"/>
  <rect class="over" x="316" y="38" width="86" height="12" rx="3"/>
  <text class="sub" x="420" y="48">넘친 만큼 디스크 임시 파일로 스필</text>
  <text class="mono" x="160" y="72">Sort Method: external merge  Disk: 141920kB</text>

  <line class="rule" x1="14" y1="88" x2="686" y2="88"/>

  <text class="lbl" x="14" y="118">Hash Join</text>
  <rect class="lim" x="160" y="106" width="150" height="20" rx="4"/>
  <rect class="d" x="164" y="110" width="44" height="12" rx="3"/>
  <rect class="d" x="212" y="110" width="44" height="12" rx="3"/>
  <rect class="d" x="260" y="110" width="44" height="12" rx="3"/>
  <text class="sub" x="420" y="120">한 번에 못 담으면 배치로 쪼개 여러 번 처리</text>
  <text class="mono" x="160" y="144">Buckets: 4096  Batches: 8  Memory Usage: 3512kB</text>
  <text class="sub" x="160" y="160">Batches가 1보다 크면 이미 디스크를 오가고 있다는 뜻</text>

  <line class="rule" x1="14" y1="176" x2="686" y2="176"/>

  <text class="lbl" x="14" y="206">Bitmap Index Scan</text>
  <rect class="lim" x="160" y="194" width="150" height="20" rx="4"/>
  <rect class="d" x="164" y="198" width="142" height="12" rx="3"/>
  <text class="sub" x="420" y="208">디스크로 안 간다 — 대신 정밀도를 버린다</text>
  <text class="mono" x="160" y="232">Heap Blocks: exact=12081 lossy=71120</text>
  <text class="sub" x="160" y="248">튜플 단위 위치를 페이지 단위로 낮춰 기록(lossy)하고,</text>
  <text class="sub" x="160" y="262">그 페이지의 모든 튜플을 다시 판정한다 → Rows Removed by Index Recheck</text>

  <text class="sub" x="14" y="288">셋 다 원인은 하나(work_mem 부족)인데 증상 이름이 전부 달라서, 모르면 서로 다른 문제로 보인다.</text>
</svg>
</div>

정리하면 이렇다.

| 노드 | 한도 초과 시 동작 | 계획에 남는 흔적 |
|---|---|---|
| Sort | 디스크 임시 파일로 스필 | `Sort Method: external merge  Disk: N kB` |
| Hash Join | 배치로 분할해 여러 번 처리 | `Batches: N` (N > 1) |
| HashAggregate | 배치로 분할 (PG13 이상) | `Disk Usage: N kB` |
| Bitmap Index Scan | 페이지 단위 lossy로 강등 | `Heap Blocks: lossy=N`, `Rows Removed by Index Recheck` |

## work_mem은 서버 예산이 아니라 노드당 한도다

그래서 이 값을 전역으로 올리는 게 위험하다. 한 쿼리가 Sort 2개 + HashJoin 1개 + Bitmap 1개를 돌리면 그 쿼리 하나가 `work_mem × 4`를 쓸 수 있고, 여기에 동시 커넥션 수가 곱해진다.

<div class="hw-mult" markdown="0">
<style>
.hw-mult{margin:1.6rem 0;overflow-x:auto}
.hw-mult svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.hw-mult .lbl{fill:currentColor;font-size:11px;font-weight:600}
.hw-mult .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.hw-mult .val{fill:currentColor;font-size:11px;font-weight:700}
.hw-mult .ax{fill:currentColor;font-size:9px;opacity:.45}
.hw-mult .base{stroke:currentColor;opacity:.26;stroke-width:1}
.hw-mult rect.m1{fill:#4dabf7}
.hw-mult rect.m2{fill:#228be6}
.hw-mult rect.m3{fill:#0b3d66}
:root[data-bs-theme='dark'] .hw-mult rect.m1{fill:#a5d8ff}
:root[data-bs-theme='dark'] .hw-mult rect.m2{fill:#4dabf7}
:root[data-bs-theme='dark'] .hw-mult rect.m3{fill:#1864ab}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .hw-mult rect.m1{fill:#a5d8ff}
:root:not([data-bs-theme]) .hw-mult rect.m2{fill:#4dabf7}
:root:not([data-bs-theme]) .hw-mult rect.m3{fill:#1864ab}}
</style>
<svg viewBox="0 0 700 200" role="img" aria-label="work_mem 256MB가 노드 4개와 커넥션 100개에 곱해져 최악의 경우 100기가바이트가 되는 구조를 로그 눈금 막대로 표시">
  <text class="lbl" x="14" y="16">work_mem = 256MB 로 설정했을 때 — 가로축 로그 눈금</text>

  <text class="lbl" x="14" y="52">설정값</text>
  <rect class="m1" x="150" y="42" width="120" height="14" rx="4"/>
  <text class="val" x="278" y="53">256 MB</text>
  <text class="sub" x="352" y="53">노드 하나가 잡을 수 있는 한도</text>

  <text class="lbl" x="14" y="90">쿼리 1개 (노드 4개)</text>
  <rect class="m2" x="150" y="80" width="240" height="14" rx="4"/>
  <text class="val" x="398" y="91">1 GB</text>
  <text class="sub" x="452" y="91">Sort 2 + HashJoin 1 + Bitmap 1</text>

  <text class="lbl" x="14" y="128">커넥션 100개 동시</text>
  <rect class="m3" x="150" y="118" width="510" height="14" rx="4"/>
  <text class="val" x="596" y="146">100 GB</text>
  <text class="sub" x="150" y="146">이론적 최악값</text>

  <line class="base" x1="150" y1="162" x2="660" y2="162"/>
  <text class="ax" x="150" y="176">256 MB</text>
  <text class="ax" x="390" y="176">1 GB</text>
  <text class="ax" x="500" y="176">10 GB</text>
  <text class="ax" x="622" y="176">100 GB</text>
  <text class="sub" x="14" y="196">실제로 전부 동시에 최대치를 쓰진 않지만, 전역 상향이 OOM으로 가는 가장 흔한 경로가 이 곱셈이다.</text>
</svg>
</div>

실무 원칙은 하나로 정리된다. **전역은 보수적으로 두고(4~64MB), 무거운 배치·리포트 쿼리에서만 세션 단위로 올린다.**

```sql
SET work_mem = '256MB';   -- 이 세션에서만
```

배치 전용 커넥션에서는 정당한 패턴이고, 동시성 높은 사용자 API 커넥션에서는 위험하다.

## 순차 I/O와 랜덤 I/O

`random_page_cost = 4.0`이라는 기본값의 근거가 여기 있다. 회전 디스크에서 순차 읽기는 헤드를 움직이지 않지만, 랜덤 읽기는 매번 탐색과 회전 대기가 붙는다. SSD에서는 이 격차가 크게 줄어든다.

| 매체 | 순차 | 랜덤 | 실무상 `random_page_cost` |
|---|---|---|---|
| HDD | 빠름 | 탐색 + 회전 대기 (~10ms) | 4.0 (기본값의 전제) |
| SATA SSD | 빠름 | 탐색 없음, 약간 느림 | 1.5 ~ 2.0 |
| NVMe SSD | 매우 빠름 | 거의 차이 없음 | 1.0 ~ 1.5 |

이 값이 SSD 환경에서 4.0으로 남아 있으면 옵티마이저는 인덱스 스캔(랜덤 접근)을 실제보다 비싸게 평가해 **Seq Scan을 과도하게 선호한다.** 계획이 자꾸 인덱스를 안 타면 인덱스를 의심하기 전에 이 파라미터를 먼저 본다.

Bitmap Heap Scan이 존재하는 이유도 같은 맥락이다. 인덱스로 찾은 위치를 **페이지 번호 순으로 정렬해서** 읽으면, 흩어진 랜덤 접근이 순차에 가까운 접근으로 바뀐다. 선택도가 중간일 때 Index Scan보다 Bitmap이 이기는 지점이 여기다.

## 쓰기는 어디로 가나

읽기만 보면 절반이다. `UPDATE` 한 번은 이렇게 움직인다.

1. 대상 페이지를 `shared_buffers`로 올린다
2. 메모리 위에서 새 버전 튜플을 쓰고, 그 페이지를 **더티**로 표시한다 (`Buffers: shared dirtied=N`)
3. 변경 내역을 **WAL**에 먼저 기록한다 — 커밋 시점에 디스크로 내려가는 건 데이터 파일이 아니라 이쪽이다
4. 더티 페이지는 나중에 체크포인터·백그라운드 라이터가 데이터 파일에 반영한다

즉 **커밋은 WAL만 기다리고, 데이터 파일 쓰기는 뒤로 미뤄진다.** 랜덤한 위치의 페이지 여러 개를 그때그때 디스크에 쓰는 대신, 순차적인 WAL 하나만 확실히 쓰는 구조다. 앞 절의 "순차가 랜덤보다 싸다"가 쓰기 경로 설계에도 그대로 적용돼 있는 셈이다.

## 면접 한 줄 Q&A

- **Q. PostgreSQL이 디스크와 주고받는 최소 단위는?** A. 8KB 페이지(블록)다. 행 하나가 필요해도 그 행이 든 페이지를 통째로 올린다. 계획의 `Buffers`와 `Heap Blocks`가 전부 이 단위다.
- **Q. `shared_buffers`와 `work_mem`의 차이는?** A. `shared_buffers`는 모든 커넥션이 공유하는 페이지 캐시로 기동 시 한 번 잡히고 설정값이 곧 총량이다. `work_mem`은 정렬·해시·비트맵의 작업 공간으로 **연산 노드마다** 잡히므로 총량이 설정값 × 노드 수 × 커넥션 수가 된다.
- **Q. `Buffers: shared hit`과 `read`의 차이는?** A. `hit`은 `shared_buffers`에서 바로 찾은 블록, `read`는 거기 없어서 OS 캐시나 디스크까지 내려간 블록이다. `read`도 실제로는 OS 페이지 캐시에서 왔을 수 있다.
- **Q. `work_mem`이 모자라면 무슨 일이 생기나?** A. 노드마다 다르다. Sort는 디스크로 스필(`external merge`), Hash Join은 배치 분할(`Batches > 1`), Bitmap Index Scan은 페이지 단위 lossy로 강등된다. 원인은 하나인데 증상 이름이 다 다르다.
- **Q. `work_mem`을 전역으로 올리면 왜 위험한가?** A. 노드당 한도라서 한 쿼리 안에서도 노드 수만큼, 그리고 동시 커넥션 수만큼 곱해진다. 전역 상향이 OOM으로 가는 가장 흔한 경로다.
- **Q. SSD를 쓰는데 인덱스를 잘 안 타면?** A. `random_page_cost` 기본값 4.0을 의심한다. 회전 디스크 전제라 SSD에서는 과대평가이고, 그 결과 옵티마이저가 Seq Scan을 과도하게 선호한다. 보통 1.1~2.0으로 낮춘다.
- **Q. 커밋할 때 데이터 파일이 디스크에 써지나?** A. 아니다. 커밋이 기다리는 건 WAL이다. 더티 페이지는 체크포인터·백그라운드 라이터가 나중에 반영한다. 랜덤 쓰기를 순차 쓰기로 바꾸는 설계다.

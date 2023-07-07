---
title: 페이징·페이지 테이블·TLB — 4단계 주소 변환과 그 캐시
date: 2023-07-07 10:00:00 +0900
description: "페이징과 다단계 페이지 테이블, TLB의 동작과 hit/miss 비용, huge page까지 — x86-64 4단계 주소 변환을 애니메이션으로 따라갑니다."
series: "운영체제 A-Z"
categories: [OS]
tags: [os, paging, page-table, tlb, multi-level, huge-page, pcid]
mermaid: true
image:
  path: /assets/img/posts/os-paging-tlb.png
  lqip: "data:image/jpeg;base64,/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAAIDBAb/xAAgEAACAwABBAMAAAAAAAAAAAABAgADETEEEhMUM2Fx/8QAFgEBAQEAAAAAAAAAAAAAAAAAAQAC/8QAFhEBAQEAAAAAAAAAAAAAAAAAAAEh/9oADAMBAAIRAxEAPwDzVmeR9B5MzOTo9rqKmZa7WVQxIAb7mNlljhRY5bt407k3WImU9LooZlwGRNHuZ0CsdAlh1FvyP+mREQqhERAv/9k="
  alt: "페이징과 TLB — 운영체제 A-Z"
---

## "주소 하나 변환하는데 메모리를 네 번 더 읽는다고?"

[앞 글]({% post_url 2023-06-19-os-virtual-memory %})에서 모든 프로세스가 똑같은 가상 주소를 쓰면서도 안 겹치는 마법을 봤습니다. 그 마법의 엔진이 **페이지 테이블**입니다. 그런데 막상 구현하려면 황당한 벽에 부딪힙니다 — 64비트 주소 공간의 페이지 테이블을 통째로 만들면, **테이블 하나가 페타바이트 단위**가 됩니다. 그리고 변환을 매번 메모리에서 읽으면, 명령어 하나 실행할 때마다 주소 변환 때문에 메모리를 여러 번 더 읽어야 합니다.

이 글은 그 두 문제를 하드웨어와 OS가 어떻게 푸는지를 따라갑니다 — **다단계 페이지 테이블**(공간 문제)과 **TLB**(시간 문제). 이 둘을 모르면 huge page가 왜 성능을 바꾸는지, 컨텍스트 스위치가 왜 캐시를 식히는지([6편]({% post_url 2023-04-08-os-context-switch %})), `dTLB-load-misses`가 무엇인지 영영 감으로만 알게 됩니다.

## 단일 페이지 테이블이 불가능한 이유

x86-64는 48비트 가상 주소를 씁니다(현재 보통). 페이지 크기는 4KB(=12비트 오프셋)이니, 페이지 번호는 36비트 → **2³⁶ ≈ 687억 개의 엔트리**. 엔트리 하나가 8바이트면 테이블 하나가 **512GB**입니다. 프로세스마다 이걸 다 만든다? 불가능합니다.

핵심 통찰: **주소 공간은 거의 다 비어 있습니다.** 프로그램은 코드 근처, 힙, 스택 근처 몇 군데만 쓰고 나머지 광활한 영역은 매핑조차 안 합니다. 그러니 "쓰는 곳만 테이블을 만들자" — 이게 다단계 페이지 테이블입니다.

## 다단계 변환: 가상 주소를 비트로 쪼개 따라간다

48비트 가상 주소를 9비트씩 네 조각 + 12비트 오프셋으로 자릅니다. 각 9비트(=512개 엔트리)가 한 단계의 테이블 인덱스입니다. CPU의 `CR3` 레지스터가 최상위 테이블(PML4)을 가리키고, 단계마다 다음 테이블의 물리 주소를 얻어 내려갑니다.

```text
가상 주소 48비트
┌─────────┬─────────┬─────────┬─────────┬────────────┐
│ PML4(9) │ PDPT(9) │  PD(9)  │  PT(9)  │ offset(12) │
└────┬────┴────┬────┴────┬────┴────┬────┴─────┬──────┘
  CR3→PML4  →  PDPT   →   PD    →   PT  → 물리프레임 + offset
```

아래 애니메이션에서 가상 주소의 각 비트 그룹이 차례로 **그 단계의 테이블을 인덱싱**하고, 토큰이 CR3 → PML4 → PDPT → PD → PT를 거쳐 최종 **물리 프레임**에 도달합니다. 비어 있는 가지(매핑 안 된 영역)는 아예 테이블을 안 만들기 때문에 메모리를 절약합니다.

<div class="os-pgwalk" markdown="0">
<style>
.os-pgwalk{margin:1.4rem 0;overflow-x:auto}
.os-pgwalk svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.os-pgwalk .bx{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.5}
.os-pgwalk .lbl{fill:currentColor;font-size:11px;font-weight:600}
.os-pgwalk .sub{fill:currentColor;font-size:9px;opacity:.6}
.os-pgwalk .seg{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.45}
.os-pgwalk .hi{fill:#1971c2;opacity:0}
.os-pgwalk .h1{animation:ospw 8s ease-in-out infinite}
.os-pgwalk .h2{animation:ospw 8s ease-in-out infinite 1.2s}
.os-pgwalk .h3{animation:ospw 8s ease-in-out infinite 2.4s}
.os-pgwalk .h4{animation:ospw 8s ease-in-out infinite 3.6s}
.os-pgwalk .frame{fill:#2f9e44;opacity:0;animation:ospwframe 8s ease-in-out infinite}
@keyframes ospw{0%,8%{opacity:0}12%,90%{opacity:.85}100%{opacity:0}}
@keyframes ospwframe{0%,58%{opacity:0}64%,92%{opacity:.9}100%{opacity:0}}
.os-pgwalk .tok{fill:#f08c00;animation:ospwtok 8s ease-in-out infinite}
.os-pgwalk .tok{offset-path:path('M 90,58 L 90,120 L 230,120 L 230,160 L 230,120 L 370,120 L 370,160 L 370,120 L 510,120 L 510,160 L 510,120 L 630,120 L 630,200');}
@keyframes ospwtok{0%{offset-distance:0%;opacity:0}5%{opacity:1}95%{opacity:1}100%{offset-distance:100%;opacity:0}}
</style>
<svg viewBox="0 0 720 240" role="img" aria-label="가상 주소의 9비트 그룹이 단계별로 PML4·PDPT·PD·PT 페이지 테이블을 인덱싱하며 최종 물리 프레임에 도달하는 4단계 페이지 워크 애니메이션">
  <text class="lbl" x="20" y="20">가상 주소</text>
  <g>
    <rect class="seg" x="70" y="28" width="64" height="22"/><text class="sub" x="102" y="43" text-anchor="middle">PML4 9b</text>
    <rect class="hi h1" x="70" y="28" width="64" height="22"/>
    <rect class="seg" x="134" y="28" width="64" height="22"/><text class="sub" x="166" y="43" text-anchor="middle">PDPT 9b</text>
    <rect class="hi h2" x="134" y="28" width="64" height="22"/>
    <rect class="seg" x="198" y="28" width="56" height="22"/><text class="sub" x="226" y="43" text-anchor="middle">PD 9b</text>
    <rect class="hi h3" x="198" y="28" width="56" height="22"/>
    <rect class="seg" x="254" y="28" width="56" height="22"/><text class="sub" x="282" y="43" text-anchor="middle">PT 9b</text>
    <rect class="hi h4" x="254" y="28" width="56" height="22"/>
    <rect class="seg" x="310" y="28" width="70" height="22"/><text class="sub" x="345" y="43" text-anchor="middle">offset 12b</text>
  </g>
  <text class="sub" x="90" y="70" text-anchor="middle">CR3</text>
  <rect class="bx" x="195" y="120" width="70" height="40" rx="5"/><text class="sub" x="230" y="115" text-anchor="middle">PML4</text>
  <rect class="bx" x="335" y="120" width="70" height="40" rx="5"/><text class="sub" x="370" y="115" text-anchor="middle">PDPT</text>
  <rect class="bx" x="475" y="120" width="70" height="40" rx="5"/><text class="sub" x="510" y="115" text-anchor="middle">PD → PT</text>
  <rect class="frame" x="600" y="186" width="62" height="36" rx="5"/>
  <rect class="bx" x="600" y="186" width="62" height="36" rx="5"/><text class="sub" x="631" y="180" text-anchor="middle">물리 프레임</text>
  <circle class="tok" r="6"/>
</svg>
</div>

> **현실 체크 — "다단계는 공간을 아끼는 대신 시간을 쓴다."** 단일 테이블이면 변환에 메모리 1번이면 됩니다. 4단계면 변환 한 번에 **메모리를 4번** 더 읽어야 합니다(각 단계 테이블이 메모리에 있으니까). 명령어 하나가 코드 fetch + 데이터 접근에 각각 변환이 필요하다고 생각하면, 변환 오버헤드만으로 프로그램이 몇 배 느려집니다. 이 시간 문제를 푸는 게 다음 주인공, TLB입니다.

## 페이지 테이블 엔트리: 변환 그 이상

각 엔트리는 다음 테이블(혹은 프레임)의 물리 주소만 담는 게 아니라, **권한과 상태 비트**를 함께 담습니다. 보호와 메모리 관리가 바로 여기서 일어납니다.

| 비트 | 의미 | 쓰임 |
|---|---|---|
| **P** (present) | 이 페이지가 물리 메모리에 있나 | 0이면 page fault → [12편]({% post_url 2023-07-25-os-page-fault-demand-paging %}) |
| **R/W** | 쓰기 가능? | 읽기 전용 페이지·COW 구현 |
| **U/S** | 유저 접근 가능? | 커널 페이지 보호([1편]({% post_url 2023-01-08-os-what-is-an-operating-system %})의 ring 보호) |
| **A** (accessed) | 접근된 적 있나 | 페이지 교체 알고리즘([13편]({% post_url 2023-08-12-os-page-replacement %})의 Clock) |
| **D** (dirty) | 수정됐나 | write-back 여부 판단 |
| **NX** | 실행 금지 | 스택·힙 코드 실행 차단(보안) |

즉 페이지 테이블은 단순 변환표가 아니라 **변환 + 보호 + 교체 정책의 메타데이터**가 한곳에 모인 자료구조입니다. COW도, 디맨드 페이징도, NX 보호도 전부 이 비트들의 조합으로 구현됩니다.

## TLB: 변환을 캐시한다

매 접근마다 4단계 워크를 한다면 답이 없습니다. 그래서 MMU 안에 **TLB**(Translation Lookaside Buffer)라는 작은 연관 캐시를 두고, 최근 변환한 `가상 페이지 번호 → 물리 프레임 번호`를 기억합니다. 프로그램은 지역성(locality)이 있어 같은 페이지를 반복 접근하므로, TLB 적중률은 보통 99% 이상입니다.

아래 애니메이션은 두 경로를 비교합니다. **TLB 히트**(<span style="color:#2f9e44;font-weight:600">초록</span>): 변환이 캐시에 있어 한 방에 물리 주소가 나옵니다. **TLB 미스**(<span style="color:#e03131;font-weight:600">빨강</span>): 캐시에 없어 4단계 페이지 워크를 돈 뒤, 그 결과를 TLB에 채워 넣고 다음을 대비합니다.

<div class="os-tlb" markdown="0">
<style>
.os-tlb{margin:1.4rem 0;overflow-x:auto}
.os-tlb svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.os-tlb .bx{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.5}
.os-tlb .lbl{fill:currentColor;font-size:11px;font-weight:600}
.os-tlb .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.os-tlb .ln{stroke:currentColor;stroke-width:1.3;opacity:.25;fill:none}
.os-tlb .hit{fill:#2f9e44;animation:ostlbhit 6s ease-in-out infinite}
.os-tlb .hit{offset-path:path('M 70,70 L 250,70 L 660,70');}
@keyframes ostlbhit{0%{offset-distance:0%;opacity:0}4%{opacity:1}46%{offset-distance:100%;opacity:1}50%{opacity:0}100%{opacity:0}}
.os-tlb .miss{fill:#e03131;animation:ostlbmiss 6s ease-in-out infinite}
.os-tlb .miss{offset-path:path('M 70,170 L 250,170 L 250,210 L 660,210 L 660,170 L 250,170 L 250,130 L 250,170');}
@keyframes ostlbmiss{0%{offset-distance:0%;opacity:0}50%{offset-distance:0%;opacity:0}54%{opacity:1}96%{offset-distance:100%;opacity:1}100%{opacity:0}}
.os-tlb .fill{fill:#f08c00;opacity:0;animation:ostlbfill 6s ease-in-out infinite}
@keyframes ostlbfill{0%,86%{opacity:0}90%{opacity:.9}96%{opacity:.9}100%{opacity:0}}
</style>
<svg viewBox="0 0 720 250" role="img" aria-label="TLB 히트는 캐시에서 한 번에 물리 주소를 얻고, 미스는 4단계 페이지 워크를 거친 뒤 결과를 TLB에 채우는 두 경로 비교 애니메이션">
  <text class="lbl" x="20" y="40">TLB 히트 (빠른 경로)</text>
  <line class="ln" x1="70" y1="70" x2="660" y2="70"/>
  <circle class="bx" cx="70" cy="70" r="4"/><text class="sub" x="70" y="92" text-anchor="middle">가상주소</text>
  <rect class="bx" x="220" y="56" width="60" height="28" rx="5"/><text class="sub" x="250" y="74" text-anchor="middle">TLB</text>
  <circle class="bx" cx="660" cy="70" r="4"/><text class="sub" x="640" y="92" text-anchor="middle">물리주소</text>
  <circle class="hit" r="6"/>

  <text class="lbl" x="20" y="150">TLB 미스 (느린 경로 — 페이지 워크)</text>
  <line class="ln" x1="70" y1="170" x2="250" y2="170"/>
  <rect class="bx" x="220" y="156" width="60" height="28" rx="5"/><text class="sub" x="250" y="174" text-anchor="middle">TLB ✕</text>
  <line class="ln" x1="250" y1="210" x2="660" y2="210"/>
  <rect class="bx" x="320" y="196" width="280" height="28" rx="5"/><text class="sub" x="460" y="214" text-anchor="middle">4단계 페이지 워크 (메모리 ×4)</text>
  <line class="ln" x1="660" y1="210" x2="660" y2="170"/>
  <rect class="fill" x="222" y="158" width="56" height="24" rx="4"/>
  <text class="sub" x="250" y="138" text-anchor="middle">결과를 TLB에 채움 ↑</text>
  <circle class="miss" r="6"/>
</svg>
</div>

미스 한 번의 비용은 수십~수백 사이클입니다(실제로는 MMU 내부 캐시가 중간 단계를 일부 캐싱해 줄여줍니다). 그래서 **TLB 미스율을 줄이는 것**이 메모리 집약적 워크로드의 핵심 튜닝 포인트입니다.

## 컨텍스트 스위치와 TLB, 그리고 huge page

TLB 엔트리는 "가상 → 물리"인데, 가상 주소는 프로세스마다 의미가 다릅니다. 그래서 옛날엔 **프로세스를 전환할 때마다 TLB를 통째로 비웠습니다(flush)** — 전환 직후 한동안 모든 접근이 미스가 되는 이유([6편]({% post_url 2023-04-08-os-context-switch %})의 "캐시·TLB 오염"). 현대 CPU는 **PCID/ASID**(주소 공간 태그)를 TLB 엔트리에 붙여, 전환해도 비우지 않고 태그로 구분합니다.

또 하나의 무기가 **huge page**입니다. 4KB 대신 2MB(또는 1GB) 페이지를 쓰면, 같은 메모리를 **훨씬 적은 TLB 엔트리**로 덮습니다(2MB면 PT 단계 생략, 1GB면 PD까지 생략 → 워크도 짧아짐). 큰 힙을 쓰는 DB·JVM·과학계산에서 TLB 미스가 병목일 때 즉효입니다.

> **현실 체크 — huge page는 만능이 아니다.** 페이지 단위가 커지면 내부 단편화가 늘고, Transparent Huge Pages(THP)의 백그라운드 압축(khugepaged)이 지연 스파이크를 만들기도 합니다. 그래서 Redis 같은 지연 민감 서비스는 THP를 끄라고 권고합니다. "TLB 미스가 실제 병목임을 측정으로 확인한 뒤" 켜는 게 정석입니다.

## 직접 들여다보기

```bash
# 프로세스가 huge page를 쓰는지, 각 매핑의 페이지 크기
cat /proc/<pid>/smaps | grep -E 'AnonHugePages|KernelPageSize'
# 시스템 전체 huge page 현황
grep -i huge /proc/meminfo
# THP 정책 확인/변경 (지연 민감 서비스는 보통 never)
cat /sys/kernel/mm/transparent_hugepage/enabled

# CPU의 TLB 구성 보기
cpuid | grep -i tlb        # 또는: cat /proc/cpuinfo

# TLB 미스를 실제로 측정 — 튜닝의 출발점
perf stat -e dTLB-load-misses,dtlb_load_misses.miss_causes_a_walk ./app
```

## 면접/리뷰 단골 질문

- **Q. 왜 다단계 페이지 테이블을 쓰나?** → 64비트 주소 공간의 단일 테이블은 수백 GB로 비현실적. 주소 공간은 대부분 비어 있으니, 쓰는 가지만 테이블을 만들어 공간을 아낀다. 대가는 변환당 메모리 접근 횟수 증가 → TLB로 상쇄.
- **Q. TLB가 뭐고 왜 필요한가?** → 가상→물리 변환을 캐시하는 MMU 내부 연관 캐시. 지역성 덕에 적중률이 높아, 매 접근마다 페이지 워크 하는 비용을 없앤다.
- **Q. 컨텍스트 스위치가 TLB에 주는 영향은?** → 주소 공간이 바뀌므로 과거엔 TLB flush가 필요했고, 전환 직후 미스가 폭증했다. PCID/ASID 태그로 flush 없이 공존시켜 완화한다.
- **Q. huge page는 왜 빠른가? 단점은?** → 큰 페이지로 같은 메모리를 더 적은 TLB 엔트리로 덮어 미스·워크를 줄인다. 단점은 내부 단편화와 THP 압축에 의한 지연 스파이크.
- **Q. 페이지 테이블 엔트리의 present 비트가 0이면?** → 그 페이지가 물리 메모리에 없다는 뜻 → 접근 시 page fault가 발생해 커널이 처리(디맨드 페이징/스왑).

## 정리

- 64비트 단일 페이지 테이블은 비현실적 → **다단계**(x86-64 4레벨)로 쓰는 가지만 만들어 공간 절약. 대가는 변환당 메모리 접근 증가.
- 페이지 테이블 엔트리는 변환 주소 + **권한·상태 비트**(P/RW/US/A/D/NX) → 보호·COW·교체·디맨드 페이징의 토대.
- **TLB**는 변환 캐시. 히트는 한 방, 미스는 페이지 워크 후 채움. 미스율 줄이기가 메모리 집약 워크로드 튜닝의 핵심.
- 컨텍스트 스위치는 TLB를 무력화 → **PCID/ASID**로 완화.
- **huge page**는 TLB 압력을 줄이지만 단편화·THP 지연이라는 비용이 있어 측정 후 적용.

> 다음 글: 페이지 테이블의 present 비트가 0일 때 — 즉 "없는 페이지를 건드렸을 때" 커널이 어떻게 채워 넣는지, **[페이지 폴트·디맨드 페이징·스왑]({% post_url 2023-07-25-os-page-fault-demand-paging %})**으로 이어집니다.

---
title: 블록 I/O와 페이지 캐시 — 같은 파일을 두 번째 읽으면 왜 빠른가
date: 2023-11-10 10:00:00 +0900
description: "같은 파일을 두 번째 읽으면 빠른 이유 — 페이지 캐시와 라이트백, readahead, 블록 I/O 스케줄러, O_DIRECT를 깊이 있게 다룹니다."
series: "운영체제 A-Z"
categories: [OS]
tags: [os, page-cache, block-io, writeback, readahead, io-scheduler, direct-io]
mermaid: true
image:
  path: /assets/img/posts/os-block-io-page-cache.png
  lqip: "data:image/jpeg;base64,/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAIDBv/EACIQAAMBAAAEBwAAAAAAAAAAAAABAgMEERIxITNRUnGRof/EABYBAQEBAAAAAAAAAAAAAAAAAAEAAv/EABYRAQEBAAAAAAAAAAAAAAAAAAABIf/aAAwDAQACEQMRAD8A598Nrbq5yupdNJr1MNIedualzS7pm1cRpLqJWfLqfeJb+2Y627t1SlN+1JL8N1iJKvG4lVU8kyDS9quOmn4IsWo18y/lkABTAAAX/9k="
  alt: "블록 I/O와 페이지 캐시 — 운영체제 A-Z"
---

## "두 번째가 빠른데, 디스크가 빨라졌을 리는 없고"

큰 로그 파일을 `grep` 합니다. 처음엔 몇 초가 걸리는데, 곧바로 다시 돌리면 **눈 깜짝할 사이**에 끝납니다. 디스크가 그새 빨라졌을 리는 없습니다. 답은 하나뿐입니다 — **두 번째 읽기는 디스크에 가지 않았습니다.** 데이터는 이미 RAM 안, 커널이 관리하는 **페이지 캐시(page cache)** 에 들어 있었고, 두 번째 `read()`는 디스크 컨트롤러 근처도 가지 않고 메모리에서 즉시 복사돼 돌아왔습니다.

이 한 가지 사실이 리눅스 I/O 성능의 90%를 설명합니다. 디스크는 CPU보다 수만~수십만 배 느립니다([앞 글]({% post_url 2023-10-23-os-io-interrupt-dma %})에서 본 그 격차). 운영체제의 핵심 전략은 "느린 디스크를 빠른 메모리 뒤에 숨기는 것"이고, 그 숨김막이 페이지 캐시입니다. 이 글은 `read`/`write` 한 번이 블록 장치까지 내려가는 길 전체 — 페이지 캐시, readahead, 더티 페이지 라이트백, 블록 레이어, I/O 스케줄러 — 를 따라가며, **왜 `free`의 그 "사라진 메모리"가 사실은 당신 편인지**까지 풉니다.

## read() 한 번이 거치는 길

응용이 `read(fd, buf, n)`을 부르면, 그 데이터는 디스크에서 곧장 오지 않습니다. 커널은 먼저 **페이지 캐시에 이미 있는지** 확인합니다. 있으면(**캐시 히트**) 메모리→메모리 복사로 끝. 없으면(**캐시 미스**) 블록 레이어를 통해 디스크에서 읽어와 페이지 캐시에 **채운 뒤** 복사해 줍니다. 그래서 첫 읽기가 캐시를 데우고, 두 번째 읽기가 그 온기를 누립니다.

아래에서 첫 `read`는 페이지 캐시를 지나(미스) 느린 디스크까지 내려갔다 오지만, 두 번째 `read`는 <span style="color:#2f9e44;font-weight:600">페이지 캐시에서 즉시</span> 반환됩니다. 두 경로의 길이 차이가 곧 속도 차이입니다.

<div class="os-pcache-hit" markdown="0">
<style>
.os-pcache-hit{margin:1.4rem 0;overflow-x:auto}
.os-pcache-hit svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.os-pcache-hit .bx{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.5}
.os-pcache-hit .lbl{fill:currentColor;font-size:12px;font-weight:600}
.os-pcache-hit .sub{fill:currentColor;font-size:10px;opacity:.6}
.os-pcache-hit .path{stroke:currentColor;opacity:.15;stroke-width:1.6;fill:none;stroke-dasharray:4 4}
.os-pcache-hit .miss{fill:#e03131;animation:ospcmiss 6s linear infinite}
.os-pcache-hit .miss{offset-path:path('M 95,70 L 300,70 L 300,150 L 560,150 L 560,70 L 300,70 L 95,70');}
@keyframes ospcmiss{0%{offset-distance:0%;opacity:0}2%{opacity:1}48%{opacity:1}50%,100%{opacity:0}}
.os-pcache-hit .hit{fill:#2f9e44;animation:ospchit 6s linear infinite}
.os-pcache-hit .hit{offset-path:path('M 95,70 L 300,70 L 95,70');}
@keyframes ospchit{0%,52%{offset-distance:0%;opacity:0}54%{opacity:1}74%{opacity:1}76%,100%{opacity:0}}
.os-pcache-hit .tag{fill:currentColor;font-size:11px;font-weight:600;opacity:0}
.os-pcache-hit .t1{animation:ospct1 6s linear infinite}
.os-pcache-hit .t2{animation:ospct2 6s linear infinite}
@keyframes ospct1{0%,2%{opacity:0}6%,49%{opacity:1;fill:#e03131}51%,100%{opacity:0}}
@keyframes ospct2{0%,53%{opacity:0}57%,75%{opacity:1;fill:#2f9e44}77%,100%{opacity:0}}
</style>
<svg viewBox="0 0 720 200" role="img" aria-label="첫 번째 read는 페이지 캐시 미스로 느린 디스크까지 내려갔다 오고, 두 번째 read는 페이지 캐시에서 즉시 반환되는 캐시 히트 애니메이션">
  <rect class="bx" x="20" y="50" width="80" height="40" rx="6"/>
  <text class="lbl" x="60" y="74" text-anchor="middle">응용</text>
  <text class="sub" x="60" y="106" text-anchor="middle">read()</text>
  <rect class="bx" x="240" y="50" width="130" height="40" rx="6" style="stroke:#2f9e44;opacity:.8"/>
  <text class="lbl" x="305" y="68" text-anchor="middle">페이지 캐시</text>
  <text class="sub" x="305" y="83" text-anchor="middle">(RAM)</text>
  <rect class="bx" x="500" y="130" width="130" height="40" rx="6"/>
  <text class="lbl" x="565" y="148" text-anchor="middle">디스크</text>
  <text class="sub" x="565" y="163" text-anchor="middle">(느림·블록 장치)</text>
  <path class="path" d="M 95,70 L 300,70 L 300,150 L 560,150 L 560,70"/>
  <text class="tag t1" x="430" y="142" text-anchor="middle">① 1차: 미스 → 디스크 왕복(느림)</text>
  <text class="tag t2" x="180" y="40" text-anchor="middle">② 2차: 히트 → 즉시 반환(빠름)</text>
  <circle class="miss" r="7"/>
  <circle class="hit" r="7"/>
</svg>
</div>

> **현실 체크 — "`free`가 보여주는 부족한 메모리는 착시다."** `free -m`의 `buff/cache` 칸은 페이지 캐시가 쓰는 메모리입니다. 이걸 보고 "메모리가 꽉 찼다"고 놀랄 필요 없습니다. 페이지 캐시는 **언제든 회수 가능한(reclaimable) 메모리**라, 응용이 더 필요로 하면 커널이 즉시 내어 줍니다. 그래서 진짜 봐야 할 값은 `used`가 아니라 `available`입니다. "남는 RAM은 낭비된 RAM" — 리눅스는 빈 메모리를 캐시로 꽉 채워 두는 게 정상입니다.

## readahead: 순차 읽기를 미리 당겨오기

파일을 처음부터 순서대로 읽는 패턴은 너무 흔해서, 커널은 이를 감지하면 **요청보다 앞서** 다음 블록들을 미리 읽어 캐시에 넣어 둡니다 — **readahead**. `read` 4KB를 호출했는데 커널이 뒤이어 128KB를 당겨오는 식입니다. 덕분에 다음 `read`는 이미 캐시 히트가 됩니다. 무작위 접근(랜덤 I/O)이라고 판단되면 readahead 창을 줄입니다.

이 동작은 응용이 의도를 알려주면 더 똑똑해집니다. `posix_fadvise(fd, ..., POSIX_FADV_SEQUENTIAL)`로 "순차로 읽을 거야"라고 힌트를 주면 창을 키우고, `POSIX_FADV_RANDOM`이면 readahead를 끕니다. 큰 파일을 한 번만 훑고 버릴 땐 `POSIX_FADV_DONTNEED`로 캐시를 더럽히지 않게 할 수도 있습니다(백업 작업이 전체 캐시를 밀어내는 사고를 막는 실전 기법).

## write()는 더 교활하다 — 라이트백

읽기보다 쓰기가 더 흥미롭습니다. `write()`가 반환됐다고 데이터가 디스크에 적힌 게 **아닙니다.** 커널은 데이터를 페이지 캐시의 **더티 페이지(dirty page)** 로 표시만 하고 곧바로 반환합니다. 실제 디스크 기록은 나중에 **flusher 스레드**가 모아서 한꺼번에 합니다 — 이것이 **라이트백(write-back) / 지연 쓰기** 입니다.

왜 이렇게 할까요? **(1)** 응용이 디스크 속도에 묶이지 않습니다(쓰기가 즉시 반환). **(2)** 같은 블록을 여러 번 고치면 마지막 한 번만 디스크에 적히면 됩니다(쓰기 병합·흡수). **(3)** 흩어진 쓰기를 모아 정렬해 한 번에 보내면 디스크 효율이 올라갑니다.

아래에서 `write`는 더티 페이지(<span style="color:#f08c00;font-weight:600">주황</span>)를 만들고 **즉시 반환**됩니다. 더티 페이지가 쌓이다가, flusher가 주기적으로(혹은 임계치 도달 시) 이들을 디스크로 **일괄 기록**하며 깨끗한(clean) 상태로 되돌립니다.

<div class="os-pcache-wb" markdown="0">
<style>
.os-pcache-wb{margin:1.4rem 0;overflow-x:auto}
.os-pcache-wb svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.os-pcache-wb .bx{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.5}
.os-pcache-wb .lbl{fill:currentColor;font-size:12px;font-weight:600}
.os-pcache-wb .sub{fill:currentColor;font-size:10px;opacity:.6}
.os-pcache-wb .ret{fill:#1971c2;animation:oswbret 7s ease-out infinite}
@keyframes oswbret{0%{transform:translateX(0);opacity:0}3%{opacity:1}18%{transform:translateX(150px);opacity:1}24%{transform:translateX(150px);opacity:0}100%{opacity:0}}
.os-pcache-wb .pg{opacity:0}
.os-pcache-wb .d1{animation:oswbd 7s linear infinite}
.os-pcache-wb .d2{animation:oswbd 7s linear infinite .6s}
.os-pcache-wb .d3{animation:oswbd 7s linear infinite 1.2s}
@keyframes oswbd{0%{opacity:0;fill:#f08c00}5%{opacity:.9;fill:#f08c00}62%{opacity:.9;fill:#f08c00}70%{opacity:.9;fill:#2f9e44}80%{opacity:.4;fill:#2f9e44}100%{opacity:.4;fill:#2f9e44}}
.os-pcache-wb .flush{fill:#2f9e44;opacity:0;animation:oswbflush 7s ease-in infinite}
@keyframes oswbflush{0%,64%{opacity:0;transform:translateX(0)}68%{opacity:1}88%{opacity:1;transform:translateX(190px)}92%,100%{opacity:0}}
.os-pcache-wb .note{fill:currentColor;font-size:11px;font-weight:600;opacity:0}
.os-pcache-wb .n1{animation:oswbn1 7s linear infinite}
.os-pcache-wb .n2{animation:oswbn2 7s linear infinite}
@keyframes oswbn1{0%,4%{opacity:0}10%,22%{opacity:1}28%,100%{opacity:0}}
@keyframes oswbn2{0%,64%{opacity:0}70%,88%{opacity:1}94%,100%{opacity:0}}
</style>
<svg viewBox="0 0 720 210" role="img" aria-label="write가 더티 페이지를 만들고 즉시 반환되며, 나중에 flusher 스레드가 더티 페이지를 디스크로 일괄 기록해 클린 상태로 되돌리는 라이트백 애니메이션">
  <rect class="bx" x="20" y="60" width="80" height="40" rx="6"/>
  <text class="lbl" x="60" y="84" text-anchor="middle">응용</text>
  <text class="sub" x="60" y="116" text-anchor="middle">write()</text>
  <rect class="bx" x="250" y="40" width="180" height="90" rx="8"/>
  <text class="lbl" x="340" y="34" text-anchor="middle">페이지 캐시</text>
  <text class="sub" x="340" y="146" text-anchor="middle">더티(주황)→플러시→클린(초록)</text>
  <rect class="bx" x="560" y="60" width="130" height="40" rx="6"/>
  <text class="lbl" x="625" y="84" text-anchor="middle">디스크</text>
  <circle class="ret" cx="110" cy="80" r="7"/>
  <text class="note n1" x="180" y="50" text-anchor="middle" style="fill:#1971c2">즉시 반환</text>
  <rect class="pg d1" x="270" y="70" width="40" height="22" rx="3"/>
  <rect class="pg d2" x="320" y="70" width="40" height="22" rx="3"/>
  <rect class="pg d3" x="370" y="70" width="40" height="22" rx="3"/>
  <rect class="flush" x="436" y="70" width="40" height="22" rx="3"/>
  <text class="note n2" x="500" y="55" text-anchor="middle" style="fill:#2f9e44">flusher 일괄 기록</text>
</svg>
</div>

라이트백의 대가는 **휘발성**입니다. `write`가 반환됐어도 디스크엔 아직 없으니, 그 사이 전원이 나가면 데이터가 사라집니다. 그래서 데이터베이스·저널처럼 내구성이 생명인 코드는 `fsync(fd)`로 **"지금 디스크에 확실히 적어라"** 라고 강제하고, 그게 반환돼야 비로소 "기록됐다"고 칩니다. 이 fsync의 순서·장벽 보장이 [저널링 파일시스템]({% post_url 2023-10-05-os-filesystem-journaling %})의 크래시 일관성을 떠받칩니다.

더티 페이지가 무한정 쌓이게 둘 수는 없습니다(전원 사고 시 손실량·라이트백 폭주). 그래서 두 임계치가 있습니다.

- `vm.dirty_background_ratio` — 더티가 이 비율을 넘으면 flusher가 **백그라운드로** 조용히 쓰기 시작.
- `vm.dirty_ratio` — 더티가 이 비율을 넘으면 **쓰는 프로세스 자신을 블로킹**해 강제로 디스크에 받아 적게 함(throttling). 갑자기 쓰기가 멈칫거리면 이 한계에 부딪힌 것.

## 그 아래: 블록 레이어와 I/O 스케줄러

페이지 캐시 미스나 라이트백이 실제 디스크에 닿을 땐 **블록 레이어**를 지납니다. 커널은 요청을 `bio` 구조로 표현하고, 이들을 큐에 모아 **병합(merge)** 하고 **정렬(sort)** 한 뒤 장치로 보냅니다. 이 정책을 정하는 게 **I/O 스케줄러**입니다.

```mermaid
flowchart LR
  A["응용 read/write"] --> B["VFS / 페이지 캐시"]
  B -->|미스·라이트백| C["블록 레이어 (bio)"]
  C --> D["I/O 스케줄러<br/>mq-deadline · bfq · none"]
  D --> E["장치 드라이버 → 디스크/SSD"]
```

| 스케줄러 | 특징 | 어울리는 곳 |
|---|---|---|
| **none** (noop) | 정렬 안 함, 큐만 | NVMe SSD(자체 병렬·재정렬) |
| **mq-deadline** | 요청에 만료시각 → 기아 방지, 가벼움 | 일반 SSD·SATA, DB |
| **bfq** | 프로세스별 공정 분배, 지연 최적 | 데스크톱·대화형 |

옛 회전 디스크(HDD) 시절엔 헤드 이동을 줄이려 **정렬(엘리베이터 알고리즘)** 이 결정적이었습니다. 그러나 NVMe SSD는 내부에 수많은 큐를 두고 스스로 병렬 처리·재정렬하므로, 커널이 굳이 줄 세우는 게 오히려 방해가 됩니다 — 그래서 NVMe 기본값이 **none**인 것이죠. 이게 **blk-mq(멀티 큐 블록 레이어)** 가 등장한 배경입니다: CPU 코어마다 제출 큐를 둬 잠금 경합 없이 수백만 IOPS를 흘려보냅니다.

## 캐시를 우회하고 싶을 때: O_DIRECT

데이터베이스는 종종 자기만의 버퍼 풀로 캐싱을 직접 관리합니다. 이럴 때 커널 페이지 캐시까지 거치면 **이중 캐싱**이라 메모리가 낭비됩니다. `open(..., O_DIRECT)`는 페이지 캐시를 건너뛰고 응용 버퍼↔디스크를 직접 잇습니다(정렬 제약이 붙음). `O_SYNC`는 매 `write`가 디스크 기록까지 끝나야 반환되게 합니다(라이트백 비활성화에 가까움). 대부분의 일반 응용은 페이지 캐시를 누리는 게 이득이고, O_DIRECT는 "내가 OS보다 내 접근 패턴을 잘 안다"고 확신할 때만 씁니다.

## 직접 들여다보기

```bash
# 페이지 캐시가 쓰는 메모리 — used가 아니라 available을 보라
free -m            # buff/cache 칸이 페이지 캐시. available이 진짜 여유

# 캐시 효과 실측: 캐시 비우고 1차 vs 2차
sync; echo 3 | sudo tee /proc/sys/vm/drop_caches   # 페이지 캐시 비우기(테스트용)
time grep -c foo big.log     # 1차: 디스크 (느림)
time grep -c foo big.log     # 2차: 페이지 캐시 히트 (빠름)

# 더티 페이지·라이트백 임계치
cat /proc/sys/vm/dirty_ratio /proc/sys/vm/dirty_background_ratio
grep -E 'Dirty|Writeback' /proc/meminfo    # 지금 쌓인 더티 양

# 실제 디스크에 닿는 I/O량(캐시 히트는 여기 안 잡힘)
iostat -x 1        # %util, r/s w/s, await
vmstat 1           # bi/bo(블록 in/out), wa(I/O 대기)

# 현재 I/O 스케줄러 확인/변경
cat /sys/block/nvme0n1/queue/scheduler   # [none] mq-deadline bfq
```

`iostat`의 디스크 I/O가 응용이 읽는 양보다 훨씬 적다면, 그 차이가 곧 **페이지 캐시가 흡수해 준 양**입니다.

## 면접/리뷰 단골 질문

- **Q. 같은 파일 두 번째 읽기가 빠른 이유는?** → 첫 읽기가 데이터를 페이지 캐시(RAM)에 채워서. 두 번째는 디스크에 안 가고 캐시 히트로 메모리 복사만 한다.
- **Q. `write()` 반환 = 디스크 기록 완료인가?** → 아니다. 더티 페이지로 표시만 하고 즉시 반환(라이트백). 실제 기록은 flusher가 나중에. 내구성이 필요하면 `fsync()`로 강제해야 한다.
- **Q. `free`에서 메모리가 거의 안 남는데 문제인가?** → 대개 아니다. buff/cache는 회수 가능한 페이지 캐시다. `available`을 봐야 한다. "빈 RAM은 낭비된 RAM."
- **Q. NVMe SSD의 기본 I/O 스케줄러가 none인 이유는?** → 장치가 내부에서 병렬 처리·재정렬을 하므로 커널의 정렬이 불필요·방해. blk-mq로 코어별 큐를 둬 경합 없이 흘려보낸다.
- **Q. O_DIRECT는 언제 쓰나?** → DB처럼 자체 캐시를 가진 응용이 이중 캐싱을 피하려 할 때. 일반 응용은 페이지 캐시를 누리는 게 이득.
- **Q. dirty_ratio에 도달하면?** → 쓰는 프로세스가 블로킹되어 강제로 디스크에 받아 적게 된다(throttling). 쓰기가 갑자기 멈칫하는 원인.

## 정리

- 페이지 캐시는 느린 디스크를 빠른 RAM 뒤에 숨기는 커널의 핵심 장치다 — 두 번째 읽기가 빠른 이유.
- 읽기는 **히트/미스**로 갈리고, **readahead**가 순차 패턴을 미리 당겨 히트율을 높인다.
- 쓰기는 **라이트백**: 더티 페이지로 즉시 반환하고 flusher가 일괄 기록 → 빠르지만 휘발성, `fsync`로 내구성 확보. `dirty_ratio`가 폭주를 막는다.
- 그 아래 **블록 레이어 + I/O 스케줄러**가 요청을 병합·정렬한다. NVMe는 blk-mq + none으로 장치 병렬성을 살린다.
- `free`의 buff/cache는 착시다 — `available`을 보라. 캐시는 언제든 회수된다.

> 다음 글: 한 대의 물리 머신을 통째로 나누는 [가상화와 컨테이너]({% post_url 2023-11-28-os-virtualization-containers %})로 넘어갑니다. 페이지 캐시·블록 I/O가 여러 게스트/컨테이너 사이에서 어떻게 공유·격리되는지가 다음 무대입니다.

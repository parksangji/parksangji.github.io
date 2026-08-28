---
title: "Bitmap Scan이 lossy로 떨어질 때: work_mem과 실행계획의 단위"
date: 2026-08-28 10:30:00 +0900
series: "PostgreSQL"
categories: [Database]
tags: [postgresql, explain, bitmap-scan, work-mem, shared-buffers, memory, index, query-tuning]
description: "work_mem이 메모리 계층 어디에 있는지부터 시작해, buffer hit와 read의 차이, lossy 비트맵과 Index Recheck의 인과, 그리고 파라미터 튜닝과 인덱스 설계 중 무엇이 진짜 처방인지 다룬다."
---

실행계획을 읽다가 가장 자주 미끄러지는 지점은 노드 이름이 아니라 **숫자의 단위**다. 블록으로 찍힌 값을 행으로 읽는 순간 진단 전체가 어긋난다. 그런데 그 단위를 제대로 읽으려면 먼저 알아야 할 게 있다 — **PostgreSQL이 메모리를 어떻게 나눠 쓰는가.** 거기서부터 시작한다.

아래가 이 글에서 계속 돌아올 계획 조각이다.

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

## work_mem은 대체 어디에 있는 메모리인가

`work_mem`을 "설정값 하나"로만 알면 왜 위험한지 감이 안 온다. 물리적으로 어디에 있는 무엇인지부터 보자.

<div class="pg-mem" markdown="0">
<style>
.pg-mem{margin:1.5rem 0;overflow-x:auto}
.pg-mem svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.pg-mem .lbl{fill:currentColor;font-size:13px;font-weight:600}
.pg-mem .sub{fill:currentColor;font-size:10px;opacity:.62}
.pg-mem .tier{fill:currentColor;font-size:11px;font-weight:700;opacity:.5;letter-spacing:.08em}
.pg-mem rect.box{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.35}
.pg-mem rect.shared{stroke:#1971c2;opacity:.85}
.pg-mem rect.wm{stroke:#f08c00;opacity:.85}
.pg-mem .cshared{fill:#1971c2}
.pg-mem .cwm{fill:#f08c00}
.pg-mem .fast{fill:#2f9e44;font-size:11px;font-weight:700}
.pg-mem .mid{fill:#1971c2;font-size:11px;font-weight:700}
.pg-mem .slow{fill:#e03131;font-size:11px;font-weight:700}
.pg-mem .arr{stroke:currentColor;opacity:.28;stroke-width:1.5;fill:none}
.pg-mem circle.io{fill:#e03131;animation:pgmio 4.5s ease-in-out infinite}
@keyframes pgmio{0%{transform:translate(0,0);opacity:0}10%{opacity:1}45%{transform:translate(0,-116px);opacity:1}70%{transform:translate(0,-116px);opacity:1}100%{transform:translate(0,-116px);opacity:0}}
</style>
<svg viewBox="0 0 720 316" role="img" aria-label="CPU 캐시, RAM 안의 shared_buffers와 work_mem, 그리고 디스크로 이어지는 메모리 계층과 각 계층의 접근 속도 차이">
  <text class="tier" x="20" y="16">빠름</text>
  <rect class="box" x="18" y="24" width="500" height="38" rx="8"/>
  <text class="lbl" x="36" y="48">CPU 캐시 · 레지스터</text>
  <text class="fast" x="540" y="48">~1 ns</text>

  <rect class="box" x="18" y="78" width="500" height="126" rx="8"/>
  <text class="tier" x="34" y="98">RAM (물리 메모리)</text>
  <rect class="box shared" x="34" y="108" width="222" height="80" rx="6"/>
  <text class="lbl cshared" x="145" y="130" text-anchor="middle">shared_buffers</text>
  <text class="sub" x="145" y="149" text-anchor="middle">공유 — 테이블·인덱스 페이지 캐시</text>
  <text class="sub" x="145" y="165" text-anchor="middle">서버 기동 시 한 덩어리로 잡음</text>
  <text class="sub" x="145" y="181" text-anchor="middle">모든 커넥션이 같이 쓴다</text>
  <rect class="box wm" x="280" y="108" width="222" height="80" rx="6"/>
  <text class="lbl cwm" x="391" y="130" text-anchor="middle">work_mem</text>
  <text class="sub" x="391" y="149" text-anchor="middle">사설 — 정렬·해시·비트맵 작업대</text>
  <text class="sub" x="391" y="165" text-anchor="middle">필요할 때 그때그때 잡음</text>
  <text class="sub" x="391" y="181" text-anchor="middle">연산 노드마다 따로</text>
  <text class="mid" x="540" y="146">~100 ns</text>

  <rect class="box" x="18" y="228" width="500" height="62" rx="8"/>
  <text class="lbl" x="36" y="252">디스크 (SSD / HDD)</text>
  <text class="sub" x="36" y="271">테이블·인덱스 본체 · 정렬 임시 파일</text>
  <text class="slow" x="540" y="262">~100 µs — 10 ms</text>
  <text class="tier" x="20" y="308">느림</text>

  <line class="arr" x1="640" y1="30" x2="640" y2="286"/>
  <polygon class="arr" points="640,292 636,282 644,282" fill="currentColor" opacity=".28"/>
  <text class="sub" x="656" y="160">약 10만 배</text>
  <circle class="io" cx="268" cy="250" r="5"/>
</svg>
</div>

핵심은 **RAM 안에서 성격이 완전히 다른 두 구획**이다.

| | shared_buffers | work_mem |
|---|---|---|
| 성격 | 공유 (모든 커넥션) | 사설 (연산 노드별) |
| 담는 것 | 테이블·인덱스 **페이지 사본** | 정렬·해시·비트맵 **중간 결과** |
| 잡는 시점 | 서버 기동 시 한 번 | 쿼리 실행 중 필요할 때 |
| 넘치면 | 오래된 페이지를 evict | **디스크로 흘리거나 정밀도를 버림** |
| 총량 | 고정 | `설정값 × 노드 수 × 커넥션 수` |

> `shared_buffers`는 **공용 창고**다. 디스크에서 꺼내온 페이지를 다 같이 쓰라고 쌓아둔다. `work_mem`은 **개인 작업 책상**이다. 정렬하려고 꺼낸 카드를 늘어놓는 자리라서, 책상이 좁으면 바닥(디스크)에 쏟거나 카드를 뭉뚱그려 쥔다.
{: .prompt-tip }

이 글의 두 증상 — **lossy 비트맵**과 **external merge** — 은 전부 "책상이 좁아서" 생기는 일이다. 하나는 정밀도를 버렸고, 하나는 바닥에 쏟았다.

## Buffers: shared hit=83201 은 무슨 뜻인가

계획에 `Buffers:`가 찍히면 대개 `hit`와 `read` 두 숫자가 나온다. 둘 다 **블록(페이지) 개수**인데, 의미가 완전히 다르다.

<div class="pg-hit" markdown="0">
<style>
.pg-hit{margin:1.5rem 0;overflow-x:auto}
.pg-hit svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.pg-hit .lbl{fill:currentColor;font-size:12.5px;font-weight:600}
.pg-hit .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.pg-hit rect.box{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.38}
.pg-hit rect.sb{stroke:#1971c2;opacity:.8}
.pg-hit .arr{stroke:currentColor;opacity:.26;stroke-width:1.5;fill:none}
.pg-hit .hitc{fill:#2f9e44;font-size:11.5px;font-weight:700}
.pg-hit .readc{fill:#e03131;font-size:11.5px;font-weight:700}
.pg-hit circle.h{fill:#2f9e44;animation:pghit 3s linear infinite}
.pg-hit circle.r{fill:#e03131;animation:pgread 6s linear infinite .5s}
@keyframes pghit{0%{transform:translate(0,0);opacity:0}12%{opacity:1}55%{transform:translate(196px,0)}92%{transform:translate(430px,0);opacity:1}100%{transform:translate(430px,0);opacity:0}}
@keyframes pgread{0%{transform:translate(0,0);opacity:0}6%{opacity:1}22%{transform:translate(196px,0)}38%{transform:translate(196px,88px)}56%{transform:translate(340px,88px)}74%{transform:translate(196px,0)}94%{transform:translate(430px,0);opacity:1}100%{transform:translate(430px,0);opacity:0}}
</style>
<svg viewBox="0 0 720 232" role="img" aria-label="buffer hit은 shared_buffers에서 바로 반환되고, buffer read는 디스크까지 왕복한 뒤 shared_buffers에 적재되고 반환되는 흐름 비교">
  <rect class="box" x="14" y="52" width="104" height="44" rx="8"/>
  <text class="lbl" x="66" y="72" text-anchor="middle">블록 요청</text>
  <text class="sub" x="66" y="87" text-anchor="middle">스캔 노드</text>

  <rect class="box sb" x="176" y="46" width="132" height="56" rx="8"/>
  <text class="lbl" x="242" y="70" text-anchor="middle">shared_buffers</text>
  <text class="sub" x="242" y="87" text-anchor="middle">있나 찾아본다</text>

  <rect class="box" x="576" y="52" width="118" height="44" rx="8"/>
  <text class="lbl" x="635" y="79" text-anchor="middle">블록 반환</text>

  <rect class="box" x="330" y="146" width="150" height="50" rx="8"/>
  <text class="lbl" x="405" y="168" text-anchor="middle">디스크 I/O</text>
  <text class="sub" x="405" y="184" text-anchor="middle">읽어서 버퍼에 적재</text>

  <text class="hitc" x="440" y="36" text-anchor="middle">hit — 메모리에 이미 있음 · 즉시 반환</text>
  <text class="readc" x="242" y="126" text-anchor="middle">read ↓ 없음</text>

  <line class="arr" x1="118" y1="74" x2="176" y2="74"/>
  <line class="arr" x1="308" y1="74" x2="576" y2="74"/>
  <line class="arr" x1="242" y1="102" x2="242" y2="171"/>
  <line class="arr" x1="242" y1="171" x2="330" y2="171"/>
  <line class="arr" x1="480" y1="171" x2="560" y2="171"/>
  <line class="arr" x1="560" y1="171" x2="560" y2="86"/>
  <line class="arr" x1="560" y1="86" x2="576" y2="80"/>
  <circle class="h" cx="132" cy="74" r="5"/>
  <circle class="r" cx="132" cy="74" r="5"/>
</svg>
</div>

- **`hit`** — 찾는 블록이 `shared_buffers` 안에 이미 있었다. 디스크에 안 간다. **메모리 접근(~100ns)** 으로 끝난다.
- **`read`** — 없어서 OS/디스크까지 갔다. **디스크 접근(~100µs~10ms)**, 즉 hit보다 **1,000배 이상** 비싸다. 읽어온 블록은 `shared_buffers`에 채워지므로, 같은 블록을 다시 찾으면 그때는 hit가 된다.

여기서 이 글 전체를 관통하는 함정이 하나 나온다.

> `read=0`, `hit=83201`을 보고 "전부 메모리에서 읽었으니 문제없다"고 넘기기 쉽다. 아니다. **hit도 공짜가 아니다.** 블록 하나를 hit 하려면 버퍼 해시 테이블을 뒤지고, 핀을 걸고, 락을 잡고, 그 8KB 안에서 튜플을 하나씩 꺼내 조건을 판정한다. **83,201번 반복하면 그 CPU 비용이 곧 쿼리 시간이 된다.**
{: .prompt-warning }

`hit`가 줄여주는 건 **I/O 비용**이지 **읽어야 하는 블록 수** 자체가 아니다. 블록 수를 줄이는 건 인덱스의 일이다. 이 구분이 마지막 절의 결론으로 그대로 이어진다.

## 계획의 숫자는 줄마다 단위가 다르다

이제 처음 그 계획으로 돌아간다. 줄마다 단위가 다르다는 걸 눈으로 붙여 두자.

<div class="pg-unit" markdown="0">
<style>
.pg-unit{margin:1.5rem 0;overflow-x:auto}
.pg-unit svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.pg-unit .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;fill:currentColor}
.pg-unit .chip{font-size:11px;font-weight:700}
.pg-unit .cblk{fill:#1971c2}
.pg-unit .crow{fill:#2f9e44}
.pg-unit .ckb{fill:#f08c00}
.pg-unit rect.cb{fill:none;stroke-width:1.4}
.pg-unit rect.blk{stroke:#1971c2;opacity:.75}
.pg-unit rect.row{stroke:#2f9e44;opacity:.75}
.pg-unit rect.kb{stroke:#f08c00;opacity:.75}
.pg-unit .arr{stroke:currentColor;opacity:.22;stroke-width:1.3;stroke-dasharray:3 3}
.pg-unit .g{animation:pgu 8s ease-in-out infinite}
.pg-unit .g1{animation-delay:0s}.pg-unit .g2{animation-delay:2s}
.pg-unit .g3{animation-delay:4s}.pg-unit .g4{animation-delay:6s}
@keyframes pgu{0%,100%{opacity:.62}6%,20%{opacity:1}}
</style>
<svg viewBox="0 0 720 208" role="img" aria-label="실행계획 각 줄의 숫자가 블록, 행, 블록, KB로 서로 다른 단위임을 표시한 대응표">
  <g class="g g1">
    <text class="mono" x="16" y="34">Heap Blocks: exact=12081 lossy=71120</text>
    <line class="arr" x1="420" y1="30" x2="486" y2="30"/>
    <rect class="cb blk" x="492" y="18" width="126" height="22" rx="11"/>
    <text class="chip cblk" x="555" y="33" text-anchor="middle">블록 (페이지)</text>
  </g>
  <g class="g g2">
    <text class="mono" x="16" y="78">(actual rows=284102 loops=1)</text>
    <line class="arr" x1="420" y1="74" x2="486" y2="74"/>
    <rect class="cb row" x="492" y="62" width="126" height="22" rx="11"/>
    <text class="chip crow" x="555" y="77" text-anchor="middle">행</text>
  </g>
  <g class="g g3">
    <text class="mono" x="16" y="122">Buffers: shared hit=83201</text>
    <line class="arr" x1="420" y1="118" x2="486" y2="118"/>
    <rect class="cb blk" x="492" y="106" width="126" height="22" rx="11"/>
    <text class="chip cblk" x="555" y="121" text-anchor="middle">블록 (페이지)</text>
  </g>
  <g class="g g4">
    <text class="mono" x="16" y="166">Sort Method: external merge  Disk: 141920kB</text>
    <line class="arr" x1="420" y1="162" x2="486" y2="162"/>
    <rect class="cb kb" x="492" y="150" width="126" height="22" rx="11"/>
    <text class="chip ckb" x="555" y="165" text-anchor="middle">KB</text>
  </g>
  <text class="mono" x="16" y="196" opacity=".55">노드 이름과 단위를 같이 읽는다 — 숫자만 보면 반드시 틀린다</text>
</svg>
</div>

즉 `lossy=71120`은 "버려진 행 71,120건"이 아니라 **lossy 방식으로 기록된 페이지가 71,120개**라는 뜻이다. 버려진 행 수는 바로 위 `Rows Removed by Index Recheck: 1902884` 쪽이다.

## exact와 lossy — 비트맵이 해상도를 잃는 순간

Bitmap Index Scan은 조건에 맞는 튜플의 위치(TID)를 메모리에 비트맵으로 모은다. 그 비트맵이 사는 곳이 바로 아까 본 **`work_mem`(개인 작업 책상)** 이다. 책상을 넘기려 하면 PostgreSQL은 비트맵을 버리는 대신 **해상도를 떨어뜨린다.**

<div class="pg-lossy" markdown="0">
<style>
.pg-lossy{margin:1.5rem 0;overflow-x:auto}
.pg-lossy svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.pg-lossy .lbl{fill:currentColor;font-size:12.5px;font-weight:600}
.pg-lossy .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.pg-lossy .note{font-size:10.5px;font-weight:600}
.pg-lossy rect.pg{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.32}
.pg-lossy rect.mark{fill:none;stroke:#f08c00;stroke-width:2;opacity:.9}
.pg-lossy circle.t{fill:currentColor;opacity:.22}
.pg-lossy circle.on{fill:#2f9e44;opacity:1}
.pg-lossy circle.chk{fill:#f08c00;animation:pgchk 3.6s linear infinite}
.pg-lossy .cok{fill:#2f9e44}
.pg-lossy .cwarn{fill:#f08c00}
.pg-lossy .c1{animation-delay:0s}.pg-lossy .c2{animation-delay:.14s}.pg-lossy .c3{animation-delay:.28s}
.pg-lossy .c4{animation-delay:.42s}.pg-lossy .c5{animation-delay:.56s}.pg-lossy .c6{animation-delay:.7s}
.pg-lossy .c7{animation-delay:.84s}.pg-lossy .c8{animation-delay:.98s}
@keyframes pgchk{0%,72%,100%{opacity:.22;r:4}8%,20%{opacity:1;r:5.5}}
</style>
<svg viewBox="0 0 720 268" role="img" aria-label="exact 비트맵은 튜플 단위로 정확히 지목하고, lossy 비트맵은 페이지 단위로만 기록해 그 페이지의 모든 튜플을 다시 판정해야 함을 보여주는 비교">
  <text class="lbl cok" x="16" y="22">exact — 튜플 단위</text>
  <text class="sub" x="16" y="38">"3번 페이지의 2번, 5번 튜플"  →  그 두 개만 꺼낸다</text>
  <rect class="pg" x="16" y="50" width="180" height="52" rx="6"/>
  <text class="sub" x="106" y="115" text-anchor="middle">page 3</text>
  <circle class="t" cx="42" cy="68" r="4"/><circle class="on" cx="70" cy="68" r="4"/>
  <circle class="t" cx="98" cy="68" r="4"/><circle class="t" cx="126" cy="68" r="4"/>
  <circle class="t" cx="154" cy="68" r="4"/><circle class="t" cx="182" cy="68" r="4"/>
  <circle class="t" cx="42" cy="88" r="4"/><circle class="t" cx="70" cy="88" r="4"/>
  <circle class="on" cx="98" cy="88" r="4"/><circle class="t" cx="126" cy="88" r="4"/>
  <circle class="t" cx="154" cy="88" r="4"/><circle class="t" cx="182" cy="88" r="4"/>
  <text class="note cok" x="216" y="82">2건만 힙에서 꺼냄 · recheck 없음</text>

  <text class="lbl cwarn" x="16" y="162">lossy — 페이지 단위</text>
  <text class="sub" x="16" y="178">"3번 페이지 어딘가에 있음"  →  어느 튜플인지 잃어버렸다</text>
  <rect class="pg" x="16" y="190" width="180" height="52" rx="6"/>
  <rect class="mark" x="12" y="186" width="188" height="60" rx="8"/>
  <text class="sub" x="106" y="256" text-anchor="middle">page 3</text>
  <circle class="chk c1" cx="42" cy="208" r="4"/><circle class="chk c2" cx="70" cy="208" r="4"/>
  <circle class="chk c3" cx="98" cy="208" r="4"/><circle class="chk c4" cx="126" cy="208" r="4"/>
  <circle class="chk c5" cx="154" cy="208" r="4"/><circle class="chk c6" cx="182" cy="208" r="4"/>
  <circle class="chk c7" cx="42" cy="228" r="4"/><circle class="chk c8" cx="70" cy="228" r="4"/>
  <circle class="chk c1" cx="98" cy="228" r="4"/><circle class="chk c2" cx="126" cy="228" r="4"/>
  <circle class="chk c3" cx="154" cy="228" r="4"/><circle class="chk c4" cx="182" cy="228" r="4"/>
  <text class="note cwarn" x="216" y="216">페이지의 모든 튜플을 꺼내 다시 판정 → Recheck</text>
  <text class="sub" x="216" y="234">대부분은 조건 불일치로 탈락한다</text>
</svg>
</div>

## Recheck Cond는 장식이 아니다

lossy 페이지는 "어느 튜플인지 모르니 그 페이지의 튜플을 전부 꺼내서 다시 판정"해야 한다. 그래서 `Recheck Cond`라는 줄이 있는 것이고, 그건 표시가 아니라 **실제로 다시 도는 판정**이다.

페이지당 30개쯤 들어있다고 치면 숫자가 맞아떨어진다.

```text
71,120 페이지 × 약 30 튜플  ≈  213만 건 재판정
                            → 190만 건 조건 불일치로 탈락
                            = Rows Removed by Index Recheck: 1,902,884
```

**비트맵이 커지면 recheck가 폭발한다.** lossy와 recheck는 별개 증상이 아니라 하나의 인과다.

## work_mem은 서버 예산이 아니라 노드당 한도

비트맵이 `work_mem` 안에 들어가면 전부 exact로 유지되어 `lossy=0`, `Rows Removed by Index Recheck: 0`이 된다.

```sql
SET work_mem = '256MB';   -- 세션 단위
```

대가가 진짜 포인트다. 첫 그림에서 `work_mem`을 "**연산 노드마다 따로** 잡는 사설 메모리"라고 했다. 그 말은 이렇게 곱해진다는 뜻이다.

<div class="pg-mult" markdown="0">
<style>
.pg-mult{margin:1.5rem 0;overflow-x:auto}
.pg-mult svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.pg-mult .lbl{fill:currentColor;font-size:12px;font-weight:600}
.pg-mult .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.pg-mult .big{fill:#e03131;font-size:17px;font-weight:700}
.pg-mult .op{fill:currentColor;font-size:15px;font-weight:700;opacity:.45}
.pg-mult rect.box{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.35}
.pg-mult rect.node{fill:none;stroke:#f08c00;stroke-width:1.5;opacity:.85}
.pg-mult rect.conn{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.3}
.pg-mult .cwm{fill:#f08c00;font-size:9.5px;font-weight:700}
.pg-mult .stack{animation:pgstk 5s ease-in-out infinite}
.pg-mult .k1{animation-delay:0s}.pg-mult .k2{animation-delay:.5s}.pg-mult .k3{animation-delay:1s}
@keyframes pgstk{0%,100%{opacity:.25}25%,60%{opacity:.95}}
</style>
<svg viewBox="0 0 720 250" role="img" aria-label="work_mem이 연산 노드마다 잡히고 커넥션 수만큼 곱해져 전체 메모리 사용량이 폭증하는 구조">
  <text class="lbl" x="16" y="20">커넥션 1개가 돌리는 쿼리 하나</text>
  <rect class="conn" x="14" y="30" width="330" height="86" rx="8"/>
  <rect class="node" x="28" y="44" width="72" height="26" rx="5"/>
  <text class="cwm" x="64" y="61" text-anchor="middle">Sort</text>
  <rect class="node" x="110" y="44" width="72" height="26" rx="5"/>
  <text class="cwm" x="146" y="61" text-anchor="middle">Sort</text>
  <rect class="node" x="192" y="44" width="82" height="26" rx="5"/>
  <text class="cwm" x="233" y="61" text-anchor="middle">HashJoin</text>
  <rect class="node" x="28" y="78" width="82" height="26" rx="5"/>
  <text class="cwm" x="69" y="95" text-anchor="middle">Bitmap</text>
  <text class="sub" x="122" y="96">노드 하나하나가 각자 work_mem 한도까지 잡는다</text>
  <text class="lbl" x="360" y="62">→</text>
  <text class="big" x="386" y="66">work_mem × 4</text>
  <text class="sub" x="386" y="84">= 한 쿼리가 쓰는 양</text>

  <text class="lbl" x="16" y="152">여기에 커넥션 수가 곱해진다</text>
  <rect class="conn stack k1" x="14" y="162" width="96" height="30" rx="6"/>
  <text class="sub" x="62" y="181" text-anchor="middle">커넥션 1</text>
  <rect class="conn stack k2" x="122" y="162" width="96" height="30" rx="6"/>
  <text class="sub" x="170" y="181" text-anchor="middle">커넥션 2</text>
  <rect class="conn stack k3" x="230" y="162" width="96" height="30" rx="6"/>
  <text class="sub" x="278" y="181" text-anchor="middle">…  커넥션 100</text>

  <text class="big" x="16" y="228">256MB × 4 노드 × 100 커넥션 = 100 GB</text>
  <text class="sub" x="400" y="228">← 이론적 최악. OOM Killer가 postmaster를 잡아간다</text>
</svg>
</div>

실제로 전부 동시에 최대치를 쓰진 않지만, `postgresql.conf`에서 전역으로 올리는 건 OOM으로 가는 가장 흔한 경로다. 원칙은 하나다.

> **전역은 보수적으로(4~64MB), 무거운 배치·리포트 쿼리에만 세션 단위로 올린다.** 배치 전용 커넥션에서는 정당한 패턴이고, 사용자 API 커넥션에서는 위험하다.
{: .prompt-warning }

## Sort Method의 두 얼굴

정렬 노드도 같은 책상을 쓴다. 다만 정렬은 정밀도를 버릴 수가 없으니(정렬 결과를 뭉뚱그릴 방법은 없다) **바닥에 쏟는다.**

<div class="pg-sort" markdown="0">
<style>
.pg-sort{margin:1.5rem 0;overflow-x:auto}
.pg-sort svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.pg-sort .lbl{fill:currentColor;font-size:12.5px;font-weight:600}
.pg-sort .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.pg-sort .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;fill:currentColor}
.pg-sort rect.box{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.35}
.pg-sort rect.wm{fill:none;stroke:#f08c00;stroke-width:1.6;opacity:.85}
.pg-sort rect.dsk{fill:none;stroke:#e03131;stroke-width:1.6;opacity:.85}
.pg-sort rect.d{fill:#2f9e44;opacity:.75}
.pg-sort rect.o{fill:#e03131;opacity:.8}
.pg-sort .cok{fill:#2f9e44;font-size:11px;font-weight:700}
.pg-sort .cbad{fill:#e03131;font-size:11px;font-weight:700}
.pg-sort .cwm{fill:#f08c00;font-size:9.5px;font-weight:700}
.pg-sort .spill{animation:pgspill 4s ease-in-out infinite}
.pg-sort .p1{animation-delay:0s}.pg-sort .p2{animation-delay:.3s}.pg-sort .p3{animation-delay:.6s}
@keyframes pgspill{0%,18%{transform:translate(0,0);opacity:1}55%,100%{transform:translate(0,74px);opacity:1}}
</style>
<svg viewBox="0 0 720 250" role="img" aria-label="정렬 대상이 work_mem 안에 들어가면 quicksort로 끝나고, 넘치면 external merge로 디스크 임시 파일에 스필되는 비교">
  <text class="cok" x="16" y="20">들어감 — quicksort</text>
  <rect class="wm" x="14" y="30" width="200" height="58" rx="8"/>
  <text class="cwm" x="24" y="46">work_mem</text>
  <rect class="d" x="30" y="54" width="26" height="24" rx="3"/>
  <rect class="d" x="62" y="54" width="26" height="24" rx="3"/>
  <rect class="d" x="94" y="54" width="26" height="24" rx="3"/>
  <rect class="d" x="126" y="54" width="26" height="24" rx="3"/>
  <text class="mono" x="232" y="52">Sort Method: quicksort  Memory: 8210kB</text>
  <text class="sub" x="232" y="70">메모리 안에서 전부 끝난다 · 디스크 접근 0</text>

  <text class="cbad" x="16" y="132">넘침 — external merge</text>
  <rect class="wm" x="14" y="142" width="200" height="58" rx="8"/>
  <text class="cwm" x="24" y="158">work_mem</text>
  <rect class="d" x="30" y="166" width="26" height="24" rx="3"/>
  <rect class="d" x="62" y="166" width="26" height="24" rx="3"/>
  <rect class="o spill p1" x="94" y="166" width="26" height="24" rx="3"/>
  <rect class="o spill p2" x="126" y="166" width="26" height="24" rx="3"/>
  <rect class="o spill p3" x="158" y="166" width="26" height="24" rx="3"/>
  <rect class="dsk" x="14" y="216" width="200" height="28" rx="6"/>
  <text class="sub" x="114" y="235" text-anchor="middle">디스크 임시 파일</text>
  <text class="mono" x="232" y="164">Sort Method: external merge  Disk: 141920kB</text>
  <text class="sub" x="232" y="182">약 142MB를 디스크에 쏟았다는 뜻</text>
  <text class="sub" x="232" y="199">→ work_mem을 그 이상으로 올려야 메모리 정렬</text>
</svg>
</div>

`external merge Disk:`가 보이면 **스필 신호**다. `quicksort Memory:`면 메모리 안에서 끝난 것이다.

## 그래서 파라미터냐, 인덱스냐

`work_mem`을 올리면 lossy도 없어지고 external merge도 없어진다. 계획은 확실히 빨라진다. 하지만 **이 쿼리가 하는 일의 양 자체는 그대로다.** `LIMIT 20`이 붙은 위 쿼리를 두 처방으로 비교하면 이렇다.

| | work_mem 증설 | 복합 인덱스 |
|---|---|---|
| 힙 블록 읽기 | 83,201 (그대로) | 약 24 |
| 정렬 대상 행 | 284,102 (그대로) | 0 — 정렬 자체가 없음 |
| 최종 반환 | 20 | 20 |
| 비용 성격 | O(전체 매칭 건수) | O(LIMIT) |

앞에서 "`hit`가 줄여주는 건 I/O 비용이지 읽어야 하는 블록 수가 아니다"라고 했다. `work_mem`도 똑같다. **정밀도를 되찾아 주고 스필을 막아줄 뿐, 28만 건을 읽고 정렬해서 20건만 남기고 버리는 구조는 그대로다.** 데이터가 두 배로 늘면 다시 느려진다.

<div class="pg-fix" markdown="0">
<style>
.pg-fix{margin:1.5rem 0;overflow-x:auto}
.pg-fix svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.pg-fix .lbl{fill:currentColor;font-size:12px;font-weight:600}
.pg-fix .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.pg-fix rect.box{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.32}
.pg-fix rect.w{fill:#f08c00;opacity:.75}
.pg-fix rect.g{fill:#2f9e44;opacity:.8}
.pg-fix .cwarn{fill:#f08c00;font-size:11.5px;font-weight:700}
.pg-fix .cok{fill:#2f9e44;font-size:11.5px;font-weight:700}
.pg-fix .grow{animation:pgg 5s ease-in-out infinite}
@keyframes pgg{0%,100%{opacity:.4}30%,70%{opacity:1}}
</style>
<svg viewBox="0 0 720 214" role="img" aria-label="work_mem 증설은 같은 작업량을 빠르게 처리할 뿐이고, 인덱스는 읽어야 하는 작업량 자체를 없앤다는 비교">
  <text class="cwarn" x="16" y="22">work_mem 증설 — 낭비를 빠르게 만든다</text>
  <rect class="w grow" x="16" y="34" width="470" height="26" rx="5"/>
  <text class="sub" x="500" y="52">28만 건 읽고 정렬 (그대로)</text>
  <rect class="g" x="16" y="66" width="12" height="18" rx="3"/>
  <text class="sub" x="38" y="80">20건만 남기고 전부 버림</text>
  <text class="sub" x="16" y="104" opacity=".8">데이터가 2배가 되면 막대도 2배가 된다 — 다시 느려진다</text>

  <text class="cok" x="16" y="146">복합 인덱스 — 낭비를 없앤다</text>
  <rect class="g" x="16" y="158" width="34" height="26" rx="5"/>
  <text class="sub" x="62" y="176">필요한 20건만 읽는다 · 정렬 노드 자체가 사라짐</text>
  <text class="sub" x="16" y="202" opacity=".8">데이터가 10배가 되어도 막대는 그대로 — O(LIMIT)</text>
</svg>
</div>

> **파라미터 튜닝은 낭비를 빠르게 만들고, 인덱스 설계는 낭비를 없앤다.**
{: .prompt-tip }

## 운영 함정

**함정 1 — `LIMIT`이 계획 해석을 왜곡한다.** 최종 반환이 20건이라고 가벼운 쿼리가 아니다. 정렬 노드 아래에서 이미 28만 건을 읽고 정렬한 뒤 20건만 남긴 것이다. 반환 행 수가 아니라 **정렬·스캔 노드의 입력 행 수**를 봐야 한다.

**함정 2 — `hit`가 많다고 안심하기.** `read=0`이어도 블록 83,201개를 훑는 CPU 비용은 그대로다. `hit`는 I/O를 없앨 뿐 작업량을 없애지 않는다.

**함정 3 — `BitmapAnd (actual rows=0)`은 버그가 아니다.** 비트맵 노드는 행을 반환하지 않고 비트맵만 만들기 때문에 항상 0으로 찍힌다. 여기서 "행이 안 나온다"고 진단하면 엉뚱한 곳을 판다.

**함정 4 — 전역 `work_mem` 증설.** 세션에서 효과를 봤다고 그대로 `postgresql.conf`에 옮기면, 노드당 한도라는 성질 때문에 노드 수 × 커넥션 수만큼 곱해져 터진다.

## 면접 한 줄 Q&A

- **Q. `work_mem`과 `shared_buffers`의 차이는?** A. `shared_buffers`는 모든 커넥션이 공유하는 **테이블·인덱스 페이지 캐시**로 기동 시 한 번 잡힌다. `work_mem`은 정렬·해시·비트맵 같은 **연산의 작업 공간**으로, 연산 노드마다 따로 잡히는 사설 메모리다.
- **Q. `Buffers: shared hit`과 `read`의 차이는?** A. `hit`은 `shared_buffers`에 이미 있어 메모리에서 바로 얻은 블록, `read`는 디스크까지 간 블록이다. 1,000배 이상 차이가 나지만, `hit`도 버퍼 조회·락·튜플 판정 CPU 비용이 들어 블록 수 자체가 많으면 여전히 느리다.
- **Q. `Heap Blocks: lossy=71120`은 무슨 뜻인가?** A. lossy 방식으로 기록된 **페이지가 71,120개**라는 뜻이다. 비트맵이 `work_mem`을 넘겨 튜플 단위 해상도를 잃고 페이지 단위로 떨어진 것이고, 그래서 해당 페이지의 모든 튜플을 다시 판정해야 한다.
- **Q. `Rows Removed by Index Recheck`가 큰데 어떻게 하나?** A. 원인은 lossy 비트맵이다. `work_mem`을 세션 단위로 올리면 exact로 유지되어 사라지지만 그건 증상 처방이다. 접근 경로 자체가 O(전체 매칭 건수)면 인덱스로 O(LIMIT)을 만들어야 한다.
- **Q. `work_mem`을 전역으로 올리면 왜 위험한가?** A. 서버 전체 예산이 아니라 **연산 노드당** 한도이기 때문이다. 한 쿼리가 Sort·HashJoin·Bitmap을 동시에 쓰면 그 배수만큼 잡히고, 커넥션 수까지 곱해지면 OOM으로 이어진다.
- **Q. `Sort Method: external merge Disk:`는?** A. 정렬 대상이 `work_mem`에 안 들어가 디스크 임시 파일로 스필했다는 신호다. `quicksort Memory:`면 메모리 안에서 끝난 것이다.

---
title: 파일 시스템 (2) — 쓰는 중 전원이 꺼지면? 저널링과 크래시 일관성
date: 2023-10-05 10:00:00 +0900
description: "쓰는 도중 전원이 꺼지면? write-ahead 저널링과 크래시 일관성, ext4의 journal/ordered/writeback 모드, fsync의 의미를 정리합니다."
series: "운영체제 A-Z"
categories: [OS]
tags: [os, journaling, crash-consistency, ext4, fsync, write-ahead-log, copy-on-write]
mermaid: true
image:
  path: /assets/img/posts/os-filesystem-journaling.png
  lqip: "data:image/jpeg;base64,/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAAIDBAb/xAAiEAACAgEDBAMAAAAAAAAAAAABAgADERMhMQQzUWFxkfD/xAAWAQEBAQAAAAAAAAAAAAAAAAABAAL/xAAWEQEBAQAAAAAAAAAAAAAAAAAAASH/2gAMAwEAAhEDEQA/APPHp7HZnWpmUsQCPMztperGojLnjP73NGvddSsCsgk7lRn7nOduZusQlPS6KGZcAyJo9zOgVjsJYdRb3H+TIiIVQiIgX//Z"
  alt: "파일 시스템: 저널링 — 운영체제 A-Z"
---

## "파일 하나 늘리는 데 디스크 쓰기가 세 번"

[앞 글](/posts/os-filesystem-inode-vfs/)에서 파일에 한 블록을 덧붙이는 일이 사실은 **여러 군데를 고치는 일**이라는 걸 봤습니다. 데이터 블록에 내용을 쓰고, inode의 크기·블록 포인터를 갱신하고, 블록 비트맵에서 그 블록을 "사용 중"으로 표시해야 합니다. 최소 **세 곳**의 디스크 쓰기입니다.

그런데 디스크 쓰기는 한 번에 하나씩 일어나고, 그 사이 어느 순간에 **전원이 나갈 수 있습니다.** 비트맵은 "사용 중"이라 표시했는데 inode는 아직 그 블록을 안 가리킨다면? 그 블록은 영영 아무에게도 속하지 않은 채 새어 나갑니다(누수). 반대로 inode는 블록을 가리키는데 비트맵엔 "비어 있음"이라면? 나중에 다른 파일이 같은 블록을 덮어써 **두 파일이 한 블록을 공유**하는 데이터 파괴가 일어납니다.

이 글은 "전원이 언제 꺼져도 파일 시스템이 망가지지 않게" 만드는 기술 — **크래시 일관성(crash consistency)** 과 그 표준 해법인 **저널링** 을 끝까지 따라갑니다. 외울 건 없습니다. "여러 쓰기를 어떻게 **하나의 원자적 사건**처럼 보이게 하나"라는 한 질문만 쫓으면 됩니다.

## fsck의 시대 — 그리고 왜 버렸나

저널링 이전의 답은 **사후 수습**이었습니다. 부팅할 때 `fsck`(file system check)가 디스크 전체를 훑어 모순을 찾아 고칩니다 — 비트맵과 inode를 대조하고, 어디에도 안 속한 블록을 회수하고, 링크 카운트를 다시 셉니다.

문제는 두 가지입니다.

- **느리다**: fsck는 **파일 시스템 전체**를 스캔합니다. 수 TB 디스크라면 부팅이 수십 분~수 시간 멈춥니다. 서버 한 대가 재부팅 때마다 한 시간씩 죽는다면 받아들일 수 없습니다.
- **불완전하다**: fsck는 "구조적 모순"은 고치지만 **무엇이 옳은 값이었는지는 모릅니다.** 절반만 쓰인 파일의 나머지 절반을 복원해 주지 못합니다. "일관성"은 되찾아도 "내 데이터"는 못 되찾습니다.

> **현실 체크 — "일관성 ≠ 최신성."** 크래시 복구가 보장하는 건 "파일 시스템 메타데이터가 모순 없는 상태"이지, "방금 쓴 데이터가 살아남음"이 아닙니다. `fsync()`로 명시적으로 디스크에 박지 않은 쓰기는 크래시 때 사라질 수 있습니다 — 파일 시스템은 멀쩡한데도요. 이 구분을 놓치면 "DB가 커밋했다는데 데이터가 날아갔다" 같은 사고가 납니다.

저널링은 발상을 뒤집습니다. **사고가 난 뒤 디스크 전체를 뒤지지 말고, 사고가 나기 전에 "내가 무엇을 할 것인지"를 먼저 적어두자.** 데이터베이스의 WAL(Write-Ahead Log)과 똑같은 아이디어입니다.

## Write-Ahead Logging: 본 위치에 손대기 전에 저널에 먼저

저널링 파일 시스템은 디스크 한쪽에 **순차적인 로그 영역(저널)** 을 둡니다. 모든 변경은 다음 순서를 지킵니다.

1. **저널에 기록**: 바꿀 블록들을 저널에 먼저 쓴다(트랜잭션 시작 마크 `TxB` + 변경 내용).
2. **커밋**: 저널의 트랜잭션 끝에 **커밋 레코드 `TxE`** 를 쓴다. 이 한 번의 쓰기가 "이 트랜잭션은 완결됐다"는 **원자적 스위치**다.
3. **체크포인트**: 그 뒤 느긋하게 저널 내용을 **본 위치(home location)** 에 반영한다.

핵심은 **커밋 레코드가 분기점**이라는 데 있습니다. 크래시가 나면 복구 루틴이 저널만 훑어서 — 디스크 전체가 아니라 **저널만** — 이렇게 판단합니다.

- 커밋 레코드까지 **있는** 트랜잭션 → 본 위치에 다시 반영(**redo, 재생**). 두 번 해도 결과가 같으므로(멱등) 안전.
- 커밋 레코드가 **없는**(중간에 끊긴) 트랜잭션 → **버린다.** 본 위치는 아직 손대지 않았으니 옛 상태 그대로, 여전히 일관적.

아래에서 변경이 ① 저널에 먼저 쌓이고 → ② 커밋 마크가 찍히고 → ③ 본 위치로 체크포인트되는 흐름을 보세요. 가운데에서 ⚡크래시가 났을 때, **커밋 전이면 통째로 폐기**되어 본 위치가 안전하게 유지됩니다.

<div class="os-jrnl" markdown="0">
<style>
.os-jrnl{margin:1.4rem 0;overflow-x:auto}
.os-jrnl svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.os-jrnl .bx{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.5}
.os-jrnl .lbl{fill:currentColor;font-size:12px;font-weight:600}
.os-jrnl .sub{fill:currentColor;font-size:10px;opacity:.6}
.os-jrnl .head{fill:currentColor;font-size:11px;font-weight:600}
.os-jrnl .jb{fill:#1971c2;opacity:0}
.os-jrnl .j1{animation:osjw 8s ease-in-out infinite}
.os-jrnl .j2{animation:osjw 8s ease-in-out infinite .5s}
.os-jrnl .commit{fill:#2f9e44;opacity:0;animation:osjc 8s ease-in-out infinite}
.os-jrnl .home{fill:#f08c00;opacity:0}
.os-jrnl .h1{animation:osjh 8s ease-in-out infinite}
.os-jrnl .h2{animation:osjh 8s ease-in-out infinite .4s}
.os-jrnl .bolt{fill:#e03131;opacity:0;animation:osjbolt 8s ease-in-out infinite}
.os-jrnl .safe{fill:#2f9e44;opacity:0;animation:osjsafe 8s ease-in-out infinite}
@keyframes osjw{0%,4%{opacity:0;transform:translateY(-8px)}12%,100%{opacity:.9;transform:translateY(0)}}
@keyframes osjc{0%,26%{opacity:0}32%,100%{opacity:.95}}
@keyframes osjh{0%,52%{opacity:0;transform:translateX(-10px)}60%,100%{opacity:.9;transform:translateX(0)}}
@keyframes osjbolt{0%,40%{opacity:0}44%,50%{opacity:1}56%,100%{opacity:0}}
@keyframes osjsafe{0%,58%{opacity:0}66%,92%{opacity:1}100%{opacity:0}}
</style>
<svg viewBox="0 0 720 250" role="img" aria-label="변경이 저널에 먼저 기록되고 커밋 마크가 찍힌 뒤 본 위치로 체크포인트되는 write-ahead 로깅 과정과, 커밋 전 크래시 시 트랜잭션이 폐기되어 본 위치가 안전하게 유지되는 복구 애니메이션">
  <text class="head" x="120" y="28" text-anchor="middle">① 저널 (순차 로그)</text>
  <rect class="bx" x="30" y="40" width="300" height="70" rx="8"/>
  <rect class="bx" x="44" y="58" width="40" height="34" rx="3"/><text class="sub" x="64" y="79" text-anchor="middle">TxB</text>
  <rect class="jb j1" x="92" y="58" width="56" height="34" rx="3"/><text class="sub" x="120" y="79" text-anchor="middle" fill="#fff" style="opacity:1">데이터</text>
  <rect class="jb j2" x="156" y="58" width="56" height="34" rx="3"/><text class="sub" x="184" y="79" text-anchor="middle" fill="#fff" style="opacity:1">메타</text>
  <rect class="commit" x="220" y="58" width="56" height="34" rx="3"/><text class="sub" x="248" y="79" text-anchor="middle" fill="#fff" style="opacity:1">커밋 TxE</text>
  <text class="sub" x="248" y="106" text-anchor="middle">② 커밋 = 원자적 스위치</text>

  <text class="head" x="610" y="28" text-anchor="middle">③ 본 위치 (실제 블록)</text>
  <rect class="bx" x="500" y="40" width="190" height="70" rx="8"/>
  <rect class="home h1" x="516" y="58" width="76" height="34" rx="3"/><text class="sub" x="554" y="79" text-anchor="middle" fill="#fff" style="opacity:1">데이터</text>
  <rect class="home h2" x="600" y="58" width="76" height="34" rx="3"/><text class="sub" x="638" y="79" text-anchor="middle" fill="#fff" style="opacity:1">메타</text>

  <path d="M 340,75 L 496,75" stroke="currentColor" stroke-width="1.4" opacity=".3" fill="none"/>
  <polygon points="496,75 486,70 486,80" fill="currentColor" opacity=".3"/>
  <text class="sub" x="418" y="66" text-anchor="middle">체크포인트</text>

  <g class="bolt"><polygon points="410,120 396,150 414,150 400,180 432,142 414,142 426,120" /><text class="sub" x="414" y="198" text-anchor="middle" fill="#e03131" style="opacity:1">⚡ 커밋 전 크래시</text></g>
  <text class="safe" x="414" y="222" text-anchor="middle" fill="#2f9e44" style="opacity:1">→ 미완 트랜잭션 폐기, 본 위치는 옛 상태 그대로 (일관)</text>
</svg>
</div>

> **현실 체크 — "저널은 두 번 쓴다."** 모든 데이터를 저널에 한 번, 본 위치에 또 한 번 쓰면 디스크 쓰기가 **두 배**입니다. 그래서 대부분의 파일 시스템은 기본적으로 **메타데이터만** 저널링합니다. 데이터까지 저널링하면 가장 안전하지만 가장 느립니다 — 안전성과 성능의 저울이 여기서 갈립니다.

## ext4의 세 가지 저널 모드 — 무엇을 어떤 순서로

리눅스 ext4는 이 저울을 세 단으로 제공합니다.

| 모드 | 저널에 넣는 것 | 데이터-메타 순서 | 안전성 / 성능 |
|---|---|---|---|
| `journal` | **데이터 + 메타데이터** | 데이터도 저널 먼저 | 가장 안전 / 가장 느림(쓰기 2배) |
| `ordered` (기본) | 메타데이터만 | **데이터를 본 위치에 먼저 쓴 뒤** 메타 커밋 | 균형 — 메타가 가리키는 데이터는 이미 디스크에 있음 |
| `writeback` | 메타데이터만 | 순서 보장 없음 | 가장 빠름 / 크래시 시 새 블록에 **옛 쓰레기**가 보일 수 있음 |

`ordered`가 기본인 이유가 핵심입니다. 메타데이터만 저널링하면 "데이터 블록"과 "그걸 가리키는 메타데이터" 사이에 시간차가 생기는데, **어느 쪽을 먼저 디스크에 박느냐**가 크래시 결과를 가릅니다.

아래에서 두 모드를 비교합니다. `ordered`(위)는 **데이터(D)를 본 위치에 먼저** 쓰고 그 다음 메타 커밋(M) — 크래시가 어디서 나든 메타는 항상 **이미 존재하는 데이터**를 가리킵니다. `writeback`(아래)은 메타 커밋(M)이 데이터(D)보다 **먼저** 디스크에 닿을 수 있어, 그 사이 크래시가 나면 새로 늘어난 파일 영역에서 **남이 쓰던 옛 데이터(쓰레기·때론 보안 누설)** 가 보입니다.

<div class="os-jmode" markdown="0">
<style>
.os-jmode{margin:1.4rem 0;overflow-x:auto}
.os-jmode svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.os-jmode .lbl{fill:currentColor;font-size:12px;font-weight:600}
.os-jmode .sub{fill:currentColor;font-size:10px;opacity:.6}
.os-jmode .axis{stroke:currentColor;opacity:.25;stroke-width:1.4}
.os-jmode .d{fill:#1971c2}.os-jmode .m{fill:#2f9e44}
.os-jmode .blk{opacity:0}
.os-jmode .od1{animation:osjm 6s ease-in-out infinite}
.os-jmode .od2{animation:osjm 6s ease-in-out infinite 1.2s}
.os-jmode .wb1{animation:osjm 6s ease-in-out infinite .9s}
.os-jmode .wb2{animation:osjm 6s ease-in-out infinite .2s}
@keyframes osjm{0%,3%{opacity:0;transform:scale(.6)}10%,100%{opacity:.92;transform:scale(1)}}
.os-jmode .good{fill:#2f9e44}.os-jmode .bad{fill:#e03131}
.os-jmode .verdict{opacity:0;animation:osjv 6s ease-in-out infinite}
@keyframes osjv{0%,55%{opacity:0}65%,100%{opacity:1}}
</style>
<svg viewBox="0 0 720 240" role="img" aria-label="ordered 모드는 데이터를 먼저 쓰고 메타를 커밋해 항상 유효한 데이터를 가리키는 반면, writeback 모드는 메타 커밋이 데이터보다 먼저 디스크에 닿아 크래시 시 새 영역에 옛 쓰레기가 노출될 수 있음을 비교하는 애니메이션">
  <text class="lbl" x="20" y="30">ordered (기본): 데이터 D → 그 다음 메타 M</text>
  <line class="axis" x1="40" y1="64" x2="520" y2="64"/>
  <rect class="blk d od1" x="120" y="48" width="60" height="32" rx="4"/><text class="sub" x="150" y="69" text-anchor="middle" fill="#fff" style="opacity:1">D 데이터</text>
  <rect class="blk m od2" x="330" y="48" width="60" height="32" rx="4"/><text class="sub" x="360" y="69" text-anchor="middle" fill="#fff" style="opacity:1">M 커밋</text>
  <text class="sub" x="530" y="68">시간 →</text>
  <text class="verdict good" x="150" y="100" text-anchor="middle" style="fill:#2f9e44">✓ 어디서 끊겨도 M은 유효한 D만 가리킴</text>

  <text class="lbl" x="20" y="150">writeback: 순서 보장 없음 → M이 D보다 먼저 디스크에</text>
  <line class="axis" x1="40" y1="184" x2="520" y2="184"/>
  <rect class="blk m wb2" x="120" y="168" width="60" height="32" rx="4"/><text class="sub" x="150" y="189" text-anchor="middle" fill="#fff" style="opacity:1">M 커밋</text>
  <rect class="blk d wb1" x="330" y="168" width="60" height="32" rx="4"/><text class="sub" x="360" y="189" text-anchor="middle" fill="#fff" style="opacity:1">D 데이터</text>
  <text class="sub" x="530" y="188">시간 →</text>
  <text class="verdict bad" x="240" y="220" text-anchor="middle" style="fill:#e03131">⚡ 그 사이 크래시 → 새 영역에 옛 쓰레기 노출</text>
</svg>
</div>

`writeback`은 메타데이터 일관성 자체는 지키므로 fsck가 필요 없지만, **데이터 일관성**은 포기합니다. 그래서 보안·정합성이 중요한 시스템은 기본값 `ordered`를 그대로 둡니다.

## 순서를 강제하는 하드웨어: 배리어와 FUA

저널링의 모든 보장은 **"커밋 레코드가 그 앞의 모든 저널 쓰기보다 늦게 디스크에 닿는다"** 는 순서 위에 서 있습니다. 그런데 현대 디스크·SSD는 성능을 위해 **쓰기를 자기 캐시에 모았다가 순서를 재배열**해 버립니다. 그러면 커밋이 데이터보다 먼저 박혀 모든 보장이 무너집니다.

그래서 파일 시스템은 **쓰기 배리어(write barrier)** / **FUA(Force Unit Access)** / `flush` 명령으로 장치에게 "여기까지는 진짜로 비휘발성 매체에 박은 뒤에 다음으로 넘어가라"고 강제합니다. 이게 저널링이 실제로 작동하기 위한 마지막 못입니다.

```bash
# 파일 시스템의 저널 모드·기능 확인
sudo dumpe2fs -h /dev/sda1 | grep -iE 'journal|features'
sudo tune2fs -l /dev/sda1 | grep -i 'mount options'

# 마운트 시 저널 데이터 모드 지정
sudo mount -o remount,data=ordered /dev/sda1 /mnt   # 기본
# data=journal(최대 안전) / data=writeback(최고 속도)

# 더티 페이지가 디스크로 내려가는 정책(저널 체크포인트와 함께 동작)
cat /proc/sys/vm/dirty_ratio /proc/sys/vm/dirty_background_ratio
```

## fsync: "지금, 진짜로, 디스크에 박아라"

저널은 "파일 시스템이 안 망가짐"을 보장할 뿐, **"내 데이터가 살아남음"** 은 보장하지 않습니다(앞의 현실 체크). 내가 쓴 바이트가 정말 매체에 도달했음을 확신하려면 직접 `fsync()`를 불러야 합니다.

```c
int fd = open("data.tmp", O_WRONLY | O_CREAT, 0644);
write(fd, buf, len);
fsync(fd);                 /* ← 이 데이터를 저널/디스크까지 강제로 내린다 */

/* 원자적 교체의 정석: 임시 파일에 쓰고 fsync한 뒤 rename */
rename("data.tmp", "data");/* rename은 원자적 — 독자는 옛/새 둘 중 하나만 본다 */
int dir = open(".", O_RDONLY);
fsync(dir);                /* 디렉터리 엔트리(이름→inode) 변경도 내려야 완성 */
```

> **현실 체크 — "fsync를 빼먹은 DB·로그는 거짓말을 한다."** 수많은 데이터 유실 사고의 진짜 원인은 파일 시스템이 아니라 **애플리케이션이 fsync를 안 불러서** 입니다. "write가 리턴했으니 저장됐다"는 착각 — 사실은 커널 페이지 캐시에만 있고 디스크엔 없습니다. 그래서 DB의 커밋, 메시지 큐의 ack은 반드시 fsync(또는 O_DSYNC) 뒤에 응답해야 합니다.

## 또 다른 길: Copy-on-Write 파일 시스템

저널링은 "본 위치를 제자리에서 덮어쓰되(in-place update), 그 전에 로그를 남기는" 전략입니다. btrfs·ZFS는 아예 다른 길을 갑니다 — **절대 제자리를 덮어쓰지 않습니다(Copy-on-Write).** 변경된 블록을 **새 위치에 쓰고**, 다 쓴 다음 루트 포인터를 **한 번에 새 트리로 교체**합니다. 옛 데이터는 교체가 끝날 때까지 멀쩡히 살아 있으므로, 크래시가 나면 그냥 옛 루트가 남습니다 — 저널이라는 별도 영역 없이도 원자성이 성립합니다. 대신 단편화·쓰기 증폭이라는 새로운 비용을 집니다. **"제자리 수정 + 로그" vs "새로 쓰고 포인터 교체"** — 크래시 일관성을 푸는 두 큰 철학입니다.

## 면접/리뷰 단골 질문

- **Q. 저널링은 무엇을 보장하나?** → 크래시 후 **메타데이터 일관성**. 커밋된 트랜잭션은 재생(redo), 미완은 폐기. fsck로 전체 스캔하지 않고 **저널만** 훑어 빠르게 복구한다. 단, 일관성이지 최신성이 아니다.
- **Q. ext4 ordered가 기본인 이유는?** → 메타데이터만 저널링하되 **데이터를 본 위치에 먼저** 쓴 뒤 메타를 커밋 → 메타는 항상 유효한 데이터를 가리킨다. journal(2배 쓰기)보다 빠르고 writeback(쓰레기 노출)보다 안전한 균형점.
- **Q. 저널링이 있는데 fsync가 왜 필요한가?** → 저널은 파일 시스템 구조만 지킨다. 내가 쓴 **데이터가 매체에 도달**했는지는 fsync로 직접 강제해야 한다. 안 부르면 페이지 캐시에만 있다 크래시로 사라진다.
- **Q. 쓰기 배리어/FUA는 왜 필요한가?** → 디스크·SSD가 쓰기를 재배열하면 "커밋이 데이터보다 먼저" 박혀 저널 보장이 깨진다. 배리어로 순서를 강제해야 저널링이 실제로 작동한다.
- **Q. 저널링 FS와 CoW FS의 차이는?** → 저널링은 제자리 덮어쓰기 + 사전 로그(redo). CoW(btrfs/ZFS)는 새 위치에 쓰고 루트 포인터를 원자 교체 → 별도 저널 없이 원자성, 대신 단편화·쓰기 증폭.

## 정리

- 파일 한 번 수정 = 데이터·inode·비트맵 등 **여러 블록 쓰기**. 그 사이 크래시가 부분 갱신을 남겨 파일 시스템을 망친다.
- 옛 해법 fsck는 **전체 스캔(느림) + 무엇이 옳은지 모름(불완전)**. 저널링은 **사전에** 할 일을 로그에 적어두는 WAL 방식으로 이를 뒤집는다.
- 순서는 **저널 기록 → 커밋(원자적 스위치) → 체크포인트**. 복구는 저널만 보고 커밋된 건 재생, 미완은 폐기.
- ext4는 `journal`(최대 안전)·`ordered`(기본·균형)·`writeback`(최고 속도) 세 모드로 안전성↔성능을 조절한다. 모든 보장은 **쓰기 배리어**로 강제한 순서 위에 선다.
- 저널은 일관성을, **fsync는 데이터 영속성**을 책임진다 — 둘은 다른 문제다. btrfs/ZFS는 CoW로 같은 문제를 다르게 푼다.

> 다음 글: 이 모든 블록 쓰기가 실제 장치에 닿는 길 — 느린 디스크와 빠른 CPU를 잇는 [입출력·인터럽트·DMA]({% post_url 2023-10-23-os-io-interrupt-dma %})로 내려갑니다. 파일의 구조 자체가 궁금하면 [inode·VFS 편]({% post_url 2023-09-17-os-filesystem-inode-vfs %})으로 돌아가세요.

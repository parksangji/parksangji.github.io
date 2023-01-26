---
title: 부팅 — 전원 버튼에서 커널까지, 그 1초 사이에 일어나는 모든 일
date: 2023-01-26 10:00:00 +0900
description: "전원 버튼을 누른 순간부터 UEFI/BIOS, 부트로더(GRUB), 커널 적재, init·systemd(PID 1)까지 — 리눅스 부팅 과정 전체를 단계별 애니메이션으로 정리합니다."
series: "운영체제 A-Z"
categories: [OS]
tags: [os, boot, uefi, bios, bootloader, grub, kernel-init, systemd, init]
mermaid: true
image:
  path: /assets/img/posts/os-boot-process.png
  lqip: "data:image/jpeg;base64,/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAGQABAQADAQAAAAAAAAAAAAAAAAIBAwQG/8QAIhAAAgICAQMFAAAAAAAAAAAAAQIAAxESIQQTFDEzUXGh/8QAFgEBAQEAAAAAAAAAAAAAAAAAAQAC/8QAFhEBAQEAAAAAAAAAAAAAAAAAAAEh/9oADAMBAAIRAxEAPwDzr0ud7O2xTYjI9MzFvS3UrtZUyr8kSvIetnVRWRseWRSf2c7E55m6xCU9LooZlwDImx7mdNWOQJYtRb7j/ZkREKYREQL/2Q=="
  alt: "부팅: 전원에서 커널까지 — 운영체제 A-Z"
---

## "커널을 메모리에 올리는 프로그램은, 누가 올리나"

[1편]({% post_url 2023-01-08-os-what-is-an-operating-system %})에서 OS는 하드웨어 위에 올라앉아 자원을 추상화·중재·보호하는 계층이라고 했습니다. 그런데 그 OS(커널)도 결국 디스크에 저장된 한 덩어리의 프로그램입니다. **그 프로그램을 디스크에서 메모리로 올려 실행시키는 일은 누가 하나요?** OS가 한다? OS는 아직 메모리에 없습니다. 이게 부팅의 **부트스트랩 역설**입니다 — 자기 신발 끈을 잡고 자기를 들어 올리는(bootstrap) 모순.

전원 버튼을 누르고 로그인 화면이 뜨기까지의 1~2초. 그 사이에 CPU는 **펌웨어 → 부트로더 → 커널 → 첫 유저 프로세스**로 이어지는 정교한 릴레이를 달립니다. 각 주자는 "다음 주자를 메모리에 올려 실행시키고 바통을 넘기는" 단 하나의 임무를 가집니다. 이 글은 그 릴레이를 한 구간씩, **누가 어떤 권한(ring)으로, 무엇을 다음 주자에게 넘기는지** 끝까지 따라갑니다.

## 1주자: 펌웨어 — ROM에 박혀 있어 항상 거기 있다

부트스트랩 역설의 답은 **펌웨어**입니다. 메인보드에는 전원이 들어오면 CPU가 **무조건 점프하는 고정 주소**가 있고, 그 주소에는 디스크가 아니라 **ROM/플래시에 미리 구워진 펌웨어**가 있습니다. 디스크에서 뭘 읽어올 필요가 없으니 "누가 올리나" 문제가 없습니다 — 전원이 곧 시작입니다.

- **POST(Power-On Self-Test)**: CPU·RAM·키보드 등 핵심 하드웨어가 살아 있는지 점검합니다. 망가졌으면 비프음으로 알리고 멈춥니다.
- **하드웨어 초기화**: 메모리 컨트롤러, PCIe, 기본 그래픽을 깨웁니다.
- **부트 디바이스 선택**: 부트 순서(NVMe → USB → 네트워크…)대로 "부팅 가능한" 디스크를 찾습니다.

여기서 **BIOS와 UEFI**가 갈립니다. 옛 BIOS는 16비트 실모드로 동작하고, 디스크의 첫 섹터(MBR, 512바이트)에 있는 부트코드를 통째로 읽어 실행합니다. 현대 UEFI는 32/64비트로 동작하고, **EFI 시스템 파티션(ESP)**이라는 실제 FAT 파일시스템에서 `*.efi` 부트로더 **파일**을 읽어 실행합니다. UEFI는 파일시스템을 이해하기 때문에 부팅이 더 유연하고, **Secure Boot**(서명된 부트로더만 실행)로 부팅 체인 변조를 막습니다.

## 2주자: 부트로더 — 커널을 골라 메모리에 올린다

펌웨어가 바통을 넘기는 상대가 **부트로더**(리눅스의 GRUB, 윈도우의 Windows Boot Manager)입니다. 부트로더의 임무는 단 하나 — **어떤 커널을, 어떤 옵션으로 부팅할지 정해 메모리에 적재하고 점프**하는 것.

- 여러 커널/OS 중 선택(듀얼부트 메뉴가 이것).
- 커널 이미지(`vmlinuz`)와 **initramfs**를 메모리로 적재.
- 커널에 부트 파라미터를 전달(`root=`, `quiet`, `ro` 등 — `/proc/cmdline`에서 확인 가능).

> **MBR vs GPT — 파티션 테이블의 세대 차이.** MBR은 디스크 크기 **최대 2TB**, 주 파티션 4개 제한. GPT(GUID Partition Table)는 사실상 무제한 크기에 파티션 128개, 헤더 백업·CRC로 손상에 강합니다. UEFI는 GPT와, 레거시 BIOS는 MBR과 짝을 이룹니다. 2TB 넘는 디스크가 안 잡히면 십중팔구 MBR/레거시 부팅입니다.

## 릴레이를 눈으로: 바통이 넘어가는 순간

아래 애니메이션에서 바통(⬤)이 **펌웨어 → 부트로더 → 커널 → PID 1**로 넘어가며 각 단계가 차례로 점등됩니다. 위쪽 "CPU 모드"를 보세요 — 펌웨어부터 커널까지는 모두 **ring 0(특권)**에서 달리고, 마지막에 첫 유저 프로세스가 뜨는 순간 비로소 **ring 3(유저)**로 내려옵니다. 이게 부팅의 본질입니다: **전권으로 시작해, 일을 끝내면 권한을 내려놓고 유저 세계를 연다.**

<div class="boot-relay" markdown="0">
<style>
.boot-relay{margin:1.4rem 0;overflow-x:auto}
.boot-relay svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.boot-relay .bx{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.45}
.boot-relay .lbl{fill:currentColor;font-size:11px;font-weight:600}
.boot-relay .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.boot-relay .lit{opacity:0}
.boot-relay .l1{fill:#f08c00;animation:brl1 9s linear infinite}
.boot-relay .l2{fill:#1971c2;animation:brl2 9s linear infinite}
.boot-relay .l3{fill:#2f9e44;animation:brl3 9s linear infinite}
.boot-relay .l4{fill:#e03131;animation:brl4 9s linear infinite}
@keyframes brl1{0%{opacity:0}2%{opacity:.85}99%{opacity:.85}100%{opacity:0}}
@keyframes brl2{0%,27%{opacity:0}31%{opacity:.85}99%{opacity:.85}100%{opacity:0}}
@keyframes brl3{0%,57%{opacity:0}61%{opacity:.85}99%{opacity:.85}100%{opacity:0}}
@keyframes brl4{0%,87%{opacity:0}91%{opacity:.85}99%{opacity:.85}100%{opacity:0}}
.boot-relay .baton{fill:currentColor;animation:brbaton 9s linear infinite}
.boot-relay .baton{offset-path:path('M 93,102 L 690,102');}
@keyframes brbaton{0%{offset-distance:0%;opacity:0}3%{opacity:1}97%{opacity:1}100%{offset-distance:100%;opacity:0}}
.boot-relay .r0{fill:#e03131;animation:brr0 9s linear infinite}
.boot-relay .r3{fill:#1971c2;animation:brr3 9s linear infinite;opacity:0}
@keyframes brr0{0%,85%{opacity:1}90%,100%{opacity:0}}
@keyframes brr3{0%,85%{opacity:0}90%,100%{opacity:1}}
</style>
<svg viewBox="0 0 720 200" role="img" aria-label="바통이 펌웨어에서 부트로더, 커널, PID1로 넘어가며 단계가 차례로 점등되고 CPU 모드가 ring0에서 ring3으로 바뀌는 부팅 릴레이 애니메이션">
  <text class="lbl" x="20" y="24">CPU 모드:</text>
  <rect class="r0" x="100" y="12" width="118" height="18" rx="4"/>
  <rect class="r3" x="100" y="12" width="118" height="18" rx="4"/>
  <text class="sub" x="159" y="25" text-anchor="middle" fill="#fff" style="opacity:1">ring 0 → ring 3</text>
  <rect class="bx" x="18"  y="70" width="150" height="64" rx="8"/>
  <rect class="lit l1" x="18"  y="70" width="150" height="64" rx="8"/>
  <rect class="bx" x="192" y="70" width="150" height="64" rx="8"/>
  <rect class="lit l2" x="192" y="70" width="150" height="64" rx="8"/>
  <rect class="bx" x="366" y="70" width="160" height="64" rx="8"/>
  <rect class="lit l3" x="366" y="70" width="160" height="64" rx="8"/>
  <rect class="bx" x="550" y="70" width="150" height="64" rx="8"/>
  <rect class="lit l4" x="550" y="70" width="150" height="64" rx="8"/>
  <text class="lbl" x="93"  y="100" text-anchor="middle">① 펌웨어</text>
  <text class="sub" x="93"  y="118" text-anchor="middle">UEFI·POST (ring0)</text>
  <text class="lbl" x="267" y="100" text-anchor="middle">② 부트로더</text>
  <text class="sub" x="267" y="118" text-anchor="middle">GRUB (ring0)</text>
  <text class="lbl" x="446" y="100" text-anchor="middle">③ 커널</text>
  <text class="sub" x="446" y="118" text-anchor="middle">압축해제·초기화 (ring0)</text>
  <text class="lbl" x="625" y="100" text-anchor="middle">④ PID 1</text>
  <text class="sub" x="625" y="118" text-anchor="middle">systemd (ring3)</text>
  <circle class="baton" r="6"/>
  <text class="sub" x="360" y="160" text-anchor="middle">전권으로 시작 → 다음 주자를 메모리에 올려 점프 → 마지막에 권한을 내려놓고 유저 세계를 연다</text>
</svg>
</div>

## 3주자: 커널 — 압축을 풀고, 진짜 OS가 깨어난다

부트로더가 점프하면 드디어 커널이 달립니다. `vmlinuz`는 사실 **압축된** 이미지라, 가장 먼저 하는 일이 **자기 압축 해제(self-decompression)** 입니다. 풀린 커널은 이제 [1편]({% post_url 2023-01-08-os-what-is-an-operating-system %})에서 말한 그 모든 기반을 세웁니다.

- **메모리 관리 기동**: 페이지 테이블·MMU를 설정해 가상 메모리를 켭니다(10·11편).
- **스케줄러·인터럽트 설정**: 타이머 인터럽트를 걸어 시분할의 심장을 뛰게 합니다.
- **드라이버 초기화**: CPU·버스·필수 장치 드라이버를 올립니다.
- **initramfs 마운트**: 진짜 루트 디스크를 읽으려면 그 디스크의 드라이버(NVMe·RAID·암호화)가 필요한데, 그게 또 디스크에 있는 역설을 풉니다. 부트로더가 **메모리에 같이 올려준 임시 루트 파일시스템(initramfs)**으로 일단 부팅해, 필요한 드라이버를 적재하고 **진짜 루트(`/`)로 전환**합니다.

## 4주자: PID 1 — 첫 유저 프로세스, 그리고 권한을 내려놓다

커널이 마지막으로 하는 일은 **첫 유저 프로세스를 생성**하는 것입니다. 이 프로세스가 **PID 1**(`init` 또는 `systemd`)이고, 모든 유저 프로세스의 조상입니다. 이 순간 CPU는 처음으로 **ring 0 → ring 3**으로 내려갑니다 — 커널은 무대 뒤로 물러나 이제부터 시스템콜로만 불려 나옵니다.

PID 1은 서비스들을 기동합니다(네트워크·로그·디스플레이 매니저…). systemd는 **의존성 그래프**를 풀어 가능한 것을 **병렬로** 띄워 부팅을 단축합니다(옛 SysV init의 순차 실행과의 결정적 차이). 마지막으로 로그인 프롬프트나 GUI가 떠 릴레이가 끝납니다.

```mermaid
flowchart LR
  A["전원 ON<br/>(고정 주소로 점프)"] --> B["펌웨어<br/>UEFI·POST<br/>ring 0"]
  B --> C["부트로더<br/>GRUB / ESP의 .efi<br/>ring 0"]
  C --> D["커널 적재·압축해제<br/>vmlinuz + initramfs<br/>ring 0"]
  D --> E["커널 초기화<br/>MMU·스케줄러·드라이버<br/>ring 0"]
  E --> F["루트(/) 전환<br/>initramfs → 실제 디스크"]
  F --> G["PID 1 생성<br/>systemd / init<br/>★ ring 3 진입"]
  G --> H["서비스 병렬 기동<br/>→ 로그인 / 셸"]
```

## BIOS vs UEFI를 움직임으로

같은 디스크라도 누가 부팅하느냐에 따라 속도와 능력이 갈립니다. 아래에서 두 부팅 막대가 채워지는데, **UEFI(<span style="color:#2f9e44;font-weight:600">초록</span>)가 BIOS(<span style="color:#868e96;font-weight:600">회색</span>)보다 먼저 "부팅 완료"에 도달**합니다 — 병렬 초기화와 파일시스템 인식 덕입니다.

<div class="boot-fw" markdown="0">
<style>
.boot-fw{margin:1.4rem 0;overflow-x:auto}
.boot-fw svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.boot-fw .lbl{fill:currentColor;font-size:11px;font-weight:600}
.boot-fw .sub{fill:currentColor;font-size:10px;opacity:.65}
.boot-fw .trk{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.35}
.boot-fw .bios{fill:#868e96;transform-box:fill-box;transform-origin:left center;animation:bfbios 5s ease-in-out infinite}
.boot-fw .uefi{fill:#2f9e44;transform-box:fill-box;transform-origin:left center;animation:bfuefi 5s ease-in-out infinite}
@keyframes bfbios{0%{transform:scaleX(0)}80%{transform:scaleX(1)}100%{transform:scaleX(1)}}
@keyframes bfuefi{0%{transform:scaleX(0)}42%{transform:scaleX(1)}100%{transform:scaleX(1)}}
.boot-fw .ckb{opacity:0;animation:bfckb 5s ease-in-out infinite}
.boot-fw .cku{opacity:0;animation:bfcku 5s ease-in-out infinite}
@keyframes bfckb{0%,80%{opacity:0}84%,100%{opacity:1}}
@keyframes bfcku{0%,42%{opacity:0}46%,100%{opacity:1}}
</style>
<svg viewBox="0 0 700 220" role="img" aria-label="UEFI 막대가 BIOS 막대보다 먼저 부팅 완료에 도달하는 비교 애니메이션과 두 펌웨어의 기능 차이 표">
  <text class="lbl" x="20" y="34">BIOS (레거시)</text>
  <rect class="trk" x="150" y="22" width="420" height="22" rx="4"/>
  <rect class="bios" x="150" y="22" width="420" height="22" rx="4"/>
  <text class="ckb lbl" x="582" y="39">완료</text>

  <text class="lbl" x="20" y="86">UEFI</text>
  <rect class="trk" x="150" y="74" width="420" height="22" rx="4"/>
  <rect class="uefi" x="150" y="74" width="420" height="22" rx="4"/>
  <text class="cku lbl" x="582" y="91">완료</text>

  <line x1="20" y1="120" x2="680" y2="120" stroke="currentColor" stroke-width="1" opacity=".2"/>
  <text class="sub" x="20" y="146">BIOS&#160;&#160;· 16비트 실모드 · MBR(≤2TB·주4개) · 순차 초기화 · Secure Boot ✗</text>
  <text class="sub" x="20" y="170">UEFI&#160;&#160;· 32/64비트 · GPT(&gt;2TB·128개) · 병렬 초기화 · Secure Boot ✓ · ESP에서 .efi 파일 부팅</text>
  <text class="sub" x="20" y="200" style="opacity:.5">막대 = 부팅 진행도. UEFI가 먼저 완료에 도달한다(개념적 비교).</text>
</svg>
</div>

## 직접 들여다보기: 내 부팅을 해부하기

부팅은 끝나고 나면 안 보이지만, 커널과 systemd가 **로그를 남겨** 둡니다. 다음 명령으로 방금 일어난 릴레이를 되감아 볼 수 있습니다.

```bash
# 커널이 부팅 중 남긴 메시지 (드라이버 초기화·장치 인식의 타임라인)
dmesg | less
journalctl -k -b           # 이번 부팅(-b)의 커널 로그

# 누가 부팅을 느리게 했나 — 서비스별 소요 시간 (성능 튜닝의 시작)
systemd-analyze              # 펌웨어/로더/커널/유저공간 단계별 총합
systemd-analyze blame        # 오래 걸린 서비스 순위
systemd-analyze critical-chain   # 부팅 임계 경로(의존성 체인)

# 커널에 전달된 부트 파라미터 (부트로더가 넘긴 그 옵션들)
cat /proc/cmdline            # root=... ro quiet splash ...

# UEFI로 부팅했는지 한 방에 확인
[ -d /sys/firmware/efi ] && echo "UEFI" || echo "Legacy BIOS"
efibootmgr -v                # UEFI 부트 항목·순서 (UEFI일 때)
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,PARTTYPENAME   # ESP·파티션 구조
```

> **현실 체크 — "부팅이 느리다"의 90%는 유저공간이다.** `systemd-analyze`를 찍어 보면 펌웨어·커널은 보통 수백 ms고, 시간 대부분은 서비스 기동(유저공간)에서 먹습니다. `blame`·`critical-chain`으로 범인 서비스를 찾아 비활성화(`systemctl disable`)하거나 의존성을 끊는 게 정석입니다. 커널이 안 뜨는 진짜 부팅 실패는 보통 **initramfs에 루트 디스크 드라이버가 빠진 경우**(NVMe·RAID·LUKS) — `dmesg`에 "Cannot open root device"가 찍힙니다.

## 면접/리뷰 단골 질문

- **Q. 부트스트랩 역설이 뭐고 어떻게 푸나?** → 커널을 메모리에 올리는 주체가 필요한데 OS는 아직 없다. ROM/플래시에 구워진 **펌웨어**가 전원과 함께 고정 주소에서 실행되며 릴레이를 시작해 푼다.
- **Q. BIOS와 UEFI의 차이는?** → UEFI는 32/64비트·GPT·파일시스템(ESP)에서 .efi 부팅·Secure Boot 지원·병렬적. BIOS는 16비트 실모드·MBR(≤2TB)·첫 섹터 부트코드. 2TB↑ 디스크나 Secure Boot가 필요하면 UEFI.
- **Q. initramfs는 왜 있나?** → 진짜 루트 디스크를 읽을 드라이버(NVMe·RAID·암호화)가 그 디스크 안에 있는 역설을 풀려고, 부트로더가 메모리에 함께 올려준 임시 루트 FS. 드라이버 적재 후 실제 루트로 전환한다.
- **Q. PID 1이 특별한 이유는?** → 커널이 만든 첫 유저 프로세스이자 모든 프로세스의 조상. 죽으면 커널 패닉. 고아 프로세스를 거두고(reaping) 서비스를 기동한다(systemd).
- **Q. 부팅 중 ring은 어떻게 바뀌나?** → 펌웨어~커널 초기화까지 ring 0(특권), PID 1을 띄우는 순간 ring 3(유저)로 내려간다. 이후 커널은 시스템콜·인터럽트로만 불려 나온다.

## 정리

- 부팅은 **펌웨어 → 부트로더 → 커널 → PID 1**의 릴레이다. 각 주자의 임무는 "다음 주자를 메모리에 올려 점프"하는 것.
- 부트스트랩 역설은 **ROM의 펌웨어**가 푼다 — 전원이 곧 시작점이라 "누가 올리나" 문제가 없다.
- **UEFI**(GPT·ESP·.efi·Secure Boot·병렬)는 **BIOS**(MBR·16비트·순차)의 현대적 후계자다.
- 커널은 압축을 풀고 MMU·스케줄러·드라이버를 세운 뒤, **initramfs**로 임시 부팅해 실제 루트로 전환한다.
- 권한은 **ring 0으로 시작해 PID 1에서 ring 3으로 내려놓는다.** 부팅 분석은 `dmesg`·`systemd-analyze`로.

> 다음 글: 그렇게 태어난 첫 프로세스, 그리고 그것이 자식을 낳는 `fork`/`exec`까지 — **프로세스: 주소공간·PCB·fork/exec**로 이어집니다. 거기서 "프로세스란 정확히 무엇인가"를 메모리 레이아웃과 함께 해부합니다.

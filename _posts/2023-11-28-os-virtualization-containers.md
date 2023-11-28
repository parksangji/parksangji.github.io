---
title: 가상화와 컨테이너 — VM과 컨테이너, 격리 스펙트럼의 양 끝
date: 2023-11-28 10:00:00 +0900
description: "VM과 컨테이너의 차이 — 하이퍼바이저, 리눅스 namespace와 cgroups, overlayfs, seccomp로 보는 격리의 스펙트럼을 그림으로 정리합니다."
series: "운영체제 A-Z"
categories: [OS]
tags: [os, virtualization, container, hypervisor, namespace, cgroups, seccomp]
mermaid: true
image:
  path: /assets/img/posts/os-virtualization-containers.png
  lqip: "data:image/jpeg;base64,/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAAIDBAb/xAAgEAADAAEEAgMAAAAAAAAAAAAAAQIDBBIhMREyM2Fx/8QAFgEBAQEAAAAAAAAAAAAAAAAAAQAC/8QAFhEBAQEAAAAAAAAAAAAAAAAAAAEh/9oADAMBAAIRAxEAPwDz602XNdvHiu1ua8o53w+jd6jJDuJWNrc/aJb7+znrvk3WIFXhuJVVPhMg0vNVxtp8IsWoy/Jf6yAApgAAL//Z"
  alt: "가상화와 컨테이너 — 운영체제 A-Z"
---

## "둘 다 격리인데, 무엇이 다른가"

`docker run nginx`는 1초 만에 뜨는데, VM은 부팅에 수십 초가 걸립니다. 둘 다 "격리된 환경"을 준다는데, 한쪽은 깃털처럼 가볍고 한쪽은 묵직합니다. 이 차이를 "도커가 그냥 빠른 기술"로 외우면 컨테이너 탈출(container escape)이 왜 VM 탈출보다 위험한지, AWS Lambda가 왜 컨테이너가 아니라 **마이크로 VM** 위에서 도는지를 영영 설명하지 못합니다.

핵심 질문 하나로 모든 게 갈립니다: **무엇을 가상화하는가.** VM은 *하드웨어*를 흉내 내서 그 위에 **통째로 다른 커널**을 올립니다. 컨테이너는 하드웨어를 흉내 내지 않고, **하나의 커널을 공유**하면서 프로세스에게 "너 혼자 쓰는 시스템"이라는 **뷰(view)만** 보여줍니다. 이 글은 그 두 철학을, 그리고 둘을 절충한 마이크로 VM까지를 끝까지 따라갑니다.

## 격리의 스펙트럼

가상화는 "있다/없다"가 아니라 **얼마나 강하게 격리하느냐**의 연속선입니다. 강한 격리는 안전하지만 무겁고(밀도↓), 약한 격리는 가볍지만(밀도↑) 공격면이 넓습니다.

```mermaid
flowchart LR
  A["물리 서버<br/>격리 최강·밀도 최악"] --> B["VM<br/>게스트 커널 포함"]
  B --> C["마이크로 VM<br/>Firecracker·경량 게스트"]
  C --> D["컨테이너<br/>커널 공유·namespace"]
  D --> E["프로세스<br/>격리 거의 없음"]
```

왼쪽으로 갈수록 "내 것"이 많아지고(전용 커널·전용 하드웨어 뷰), 오른쪽으로 갈수록 "공유"가 많아집니다(커널을 나눠 씀). **정답은 없고**, 워크로드가 요구하는 격리 강도와 집적 밀도 사이에서 한 점을 고르는 일입니다.

## VM: 하드웨어를 통째로 흉내 낸다

가상 머신은 **하이퍼바이저**가 가짜 하드웨어(가상 CPU·메모리·디스크·NIC)를 만들어 주고, 그 위에 게스트 OS가 **자기가 진짜 기계 위에 있는 줄 알고** 부팅합니다.

- **Type 1 (베어메탈)**: 하드웨어 위에 하이퍼바이저가 직접 — ESXi, Xen, Hyper-V, 그리고 리눅스 커널을 하이퍼바이저로 바꾸는 **KVM**. 클라우드 인스턴스 대부분(AWS Nitro 포함)이 여기.
- **Type 2 (호스티드)**: 일반 OS 위 응용으로 — VirtualBox, VMware Workstation. 개발용.

문제는 x86이 원래 가상화에 친화적이지 않았다는 점입니다. 게스트 커널이 ring 0인 줄 알고 특권 명령을 실행하면, 진짜로 실행되면 안 됩니다. 고전적 해법이 **트랩&에뮬레이트** — 특권 명령이 폴트를 일으키면 하이퍼바이저가 가로채 흉내 냅니다. 일부 명령은 트랩조차 안 돼서 VMware는 **바이너리 변환**, Xen은 게스트를 고치는 **반가상화(paravirtualization)** 로 우회했습니다. 지금은 **하드웨어 보조 가상화**(Intel VT-x / AMD-V)와 **중첩 페이지 테이블**(EPT/NPT)로 CPU가 직접 게스트를 지원해, 오버헤드가 크게 줄었습니다. I/O는 가짜 장치를 에뮬레이트하면 느리니, 게스트에 **virtio** 드라이버를 넣어 "나 가상이야"를 인정하고 빠른 경로를 씁니다.

> **현실 체크 — "VM이 무거운 진짜 이유는 커널이 N개라서다."** VM 10대 = 게스트 커널 10개가 각자 메모리에 상주하고, 각자 부팅하고, 각자 페이지 캐시를 따로 관리합니다. CPU 가상화 오버헤드는 VT-x로 거의 사라졌지만, **중복된 커널의 메모리·부팅 비용**은 남습니다. 이게 같은 서버에 컨테이너는 수백 개 띄워도 VM은 수십 개에서 막히는 이유입니다.

## 컨테이너: 커널은 하나, 뷰만 쪼갠다

컨테이너는 새로운 커널을 띄우지 않습니다. **호스트 커널을 그대로 공유**하면서, 리눅스 커널의 두 기능을 조합해 프로세스를 가둡니다.

- **namespaces** — *무엇이 보이는가*를 격리. `pid`(자기 프로세스만 보임), `mnt`(자기 파일시스템 뷰), `net`(전용 네트워크 스택·IP), `uts`(호스트명), `ipc`, `user`(UID 매핑), `cgroup`. 같은 커널이 프로세스마다 **다른 뷰**를 보여줍니다.
- **cgroups** — *얼마나 쓰는가*를 제한. CPU·메모리·I/O·PID 수에 상한을 걸어 한 컨테이너가 자원을 독식하지 못하게 합니다.

여기에 **overlayfs**(레이어 이미지를 합쳐 보이는 union mount), **capabilities/seccomp-bpf**(쓸 수 있는 시스템콜·권한을 깎기)가 더해지면 우리가 아는 컨테이너가 됩니다. 즉 **컨테이너라는 단일 커널 객체는 없습니다** — namespace + cgroup + 파일시스템 격리가 만든 **착시**입니다.

아래에서 두 스택을 나란히 보세요. 왼쪽 VM은 게스트 커널(<span style="color:#e03131;font-weight:600">빨강</span>)을 **VM마다** 짊어지고, 오른쪽 컨테이너는 커널(<span style="color:#2f9e44;font-weight:600">초록</span>)을 **하나만** 공유해 스택이 짧습니다.

<div class="os-virt-stack" markdown="0">
<style>
.os-virt-stack{margin:1.4rem 0;overflow-x:auto}
.os-virt-stack svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.os-virt-stack .bx{stroke:currentColor;stroke-width:1.2;fill:currentColor;opacity:.10}
.os-virt-stack .ttl{fill:currentColor;font-size:13px;font-weight:700}
.os-virt-stack .bl{fill:currentColor;font-size:10px;font-weight:600}
.os-virt-stack .cap{fill:currentColor;font-size:10px;opacity:.6}
.os-virt-stack .vmk{fill:#e03131;stroke:#e03131;stroke-width:1;animation:osvmk 2.6s ease-in-out infinite}
.os-virt-stack .hostk{fill:#2f9e44;stroke:#2f9e44;stroke-width:1;animation:oshostk 2.6s ease-in-out infinite}
@keyframes osvmk{0%,100%{opacity:.5}50%{opacity:.92}}
@keyframes oshostk{0%,100%{opacity:.5}50%{opacity:.92}}
.os-virt-stack .wl{fill:#fff;font-size:10px;font-weight:600}
</style>
<svg viewBox="0 0 700 250" role="img" aria-label="VM 스택과 컨테이너 스택 비교: VM은 게스트 커널을 VM마다 갖고, 컨테이너는 호스트 커널 하나를 공유해 스택이 짧음">
  <text class="ttl" x="182" y="18" text-anchor="middle">가상 머신 (VM)</text>
  <text class="ttl" x="518" y="18" text-anchor="middle">컨테이너</text>

  <!-- VM stack -->
  <rect class="bx" x="44" y="56" width="130" height="26" rx="4"/><text class="bl" x="109" y="73" text-anchor="middle">App A</text>
  <rect class="bx" x="44" y="84" width="130" height="22" rx="4"/><text class="bl" x="109" y="99" text-anchor="middle">Bins/Libs</text>
  <rect class="vmk" x="44" y="108" width="130" height="30" rx="4"/><text class="wl" x="109" y="127" text-anchor="middle">Guest 커널</text>
  <rect class="bx" x="192" y="56" width="130" height="26" rx="4"/><text class="bl" x="257" y="73" text-anchor="middle">App B</text>
  <rect class="bx" x="192" y="84" width="130" height="22" rx="4"/><text class="bl" x="257" y="99" text-anchor="middle">Bins/Libs</text>
  <rect class="vmk" x="192" y="108" width="130" height="30" rx="4"/><text class="wl" x="257" y="127" text-anchor="middle">Guest 커널</text>
  <rect class="bx" x="30" y="142" width="305" height="26" rx="4"/><text class="bl" x="182" y="159" text-anchor="middle">하이퍼바이저</text>
  <rect class="bx" x="30" y="170" width="305" height="30" rx="4"/><text class="bl" x="182" y="189" text-anchor="middle">물리 하드웨어 (CPU·RAM·디스크)</text>
  <text class="cap" x="182" y="220" text-anchor="middle">게스트 커널 N개 → 무겁다 · 부팅 느림 · 이미지 큼</text>

  <!-- Container stack -->
  <rect class="bx" x="379" y="56" width="130" height="26" rx="4"/><text class="bl" x="444" y="73" text-anchor="middle">App C</text>
  <rect class="bx" x="379" y="84" width="130" height="22" rx="4"/><text class="bl" x="444" y="99" text-anchor="middle">Bins/Libs</text>
  <rect class="bx" x="527" y="56" width="130" height="26" rx="4"/><text class="bl" x="592" y="73" text-anchor="middle">App D</text>
  <rect class="bx" x="527" y="84" width="130" height="22" rx="4"/><text class="bl" x="592" y="99" text-anchor="middle">Bins/Libs</text>
  <rect class="bx" x="365" y="110" width="305" height="24" rx="4"/><text class="bl" x="517" y="126" text-anchor="middle">컨테이너 런타임 (containerd)</text>
  <rect class="hostk" x="365" y="136" width="305" height="30" rx="4"/><text class="wl" x="517" y="155" text-anchor="middle">호스트 OS · 커널 (단 하나, 공유)</text>
  <rect class="bx" x="365" y="170" width="305" height="30" rx="4"/><text class="bl" x="517" y="189" text-anchor="middle">물리 하드웨어 (CPU·RAM·디스크)</text>
  <text class="cap" x="517" y="220" text-anchor="middle">커널 1개 공유 → 가볍다 · 즉시 시작 / 격리는 약함</text>
</svg>
</div>

## namespace가 만드는 착시: 같은 프로세스, 다른 PID

가장 직관적인 예가 **PID namespace**입니다. 컨테이너 안에서 `ps`를 치면 내 프로세스가 **PID 1**입니다. 그런데 호스트에서 보면 같은 프로세스가 **PID 4012**입니다. 둘은 **완전히 동일한 커널 태스크**이고, 단지 namespace에 따라 다른 번호로 보일 뿐입니다.

아래에서 토큰이 호스트의 `4012`와 컨테이너의 `1` 사이를 오갑니다 — **하나의 태스크가 두 개의 뷰**를 가진다는 뜻입니다. 격리는 새 실체가 아니라 **'보이는 것'의 분리**입니다.

<div class="os-virt-ns" markdown="0">
<style>
.os-virt-ns{margin:1.4rem 0;overflow-x:auto}
.os-virt-ns svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.os-virt-ns .frame{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.45}
.os-virt-ns .ttl{fill:currentColor;font-size:12px;font-weight:700}
.os-virt-ns .row{fill:currentColor;opacity:.08;stroke:currentColor;stroke-width:.8}
.os-virt-ns .rl{fill:currentColor;font-size:11px}
.os-virt-ns .cap{fill:currentColor;font-size:10px;opacity:.6}
.os-virt-ns .hl{fill:#1971c2;stroke:#1971c2;stroke-width:1;animation:osnshl 3s ease-in-out infinite}
@keyframes osnshl{0%,100%{opacity:.45}50%{opacity:.9}}
.os-virt-ns .hlw{fill:#fff;font-size:11px;font-weight:600}
.os-virt-ns .map{stroke:#1971c2;stroke-width:1.4;fill:none;opacity:.4;stroke-dasharray:4 4}
.os-virt-ns .faint{stroke:currentColor;stroke-width:1;fill:none;opacity:.18;stroke-dasharray:3 3}
.os-virt-ns .tok{fill:#1971c2;offset-path:path('M 296,151 C 350,151 360,123 414,123');animation:osnstok 3s ease-in-out infinite}
@keyframes osnstok{0%{offset-distance:0%}50%{offset-distance:100%}100%{offset-distance:0%}}
</style>
<svg viewBox="0 0 700 290" role="img" aria-label="호스트 PID namespace의 PID 4012가 컨테이너 PID namespace 안에서는 PID 1로 보이는, 같은 커널 태스크의 두 뷰를 토큰이 오가는 애니메이션">
  <rect class="frame" x="30" y="44" width="280" height="214" rx="8"/>
  <text class="ttl" x="170" y="36" text-anchor="middle">호스트 PID namespace</text>
  <rect class="row" x="44" y="56" width="252" height="26" rx="3"/><text class="rl" x="54" y="73">PID 1 · systemd</text>
  <rect class="row" x="44" y="90" width="252" height="26" rx="3"/><text class="rl" x="54" y="107">PID 982 · containerd</text>
  <rect class="hl" x="44" y="138" width="252" height="26" rx="3"/><text class="hlw" x="54" y="155">PID 4012 · 컨테이너 init</text>
  <rect class="row" x="44" y="172" width="252" height="26" rx="3"/><text class="rl" x="54" y="189">PID 4013 · nginx</text>
  <rect class="row" x="44" y="206" width="252" height="26" rx="3"/><text class="rl" x="54" y="223">PID 4014 · worker</text>

  <rect class="frame" x="400" y="92" width="270" height="150" rx="8"/>
  <text class="ttl" x="535" y="84" text-anchor="middle">컨테이너 PID namespace</text>
  <rect class="hl" x="414" y="110" width="242" height="26" rx="3"/><text class="hlw" x="424" y="127">PID 1 · init  (= 호스트 4012)</text>
  <rect class="row" x="414" y="150" width="242" height="26" rx="3"/><text class="rl" x="424" y="167">PID 7 · nginx</text>
  <rect class="row" x="414" y="190" width="242" height="26" rx="3"/><text class="rl" x="424" y="207">PID 8 · worker</text>

  <path class="map" d="M 296,151 C 350,151 360,123 414,123"/>
  <path class="faint" d="M 296,185 C 350,185 360,163 414,163"/>
  <path class="faint" d="M 296,219 C 350,219 360,203 414,203"/>
  <circle class="tok" r="6"/>
  <text class="cap" x="350" y="278" text-anchor="middle">같은 커널 태스크 4012 = 컨테이너 안에선 PID 1 — 격리는 '뷰'일 뿐, 커널은 하나다</text>
</svg>
</div>

> **현실 체크 — "커널이 하나라서, 컨테이너 탈출은 VM 탈출보다 치명적이다."** VM에서 빠져나오려면 하이퍼바이저를 뚫어야 하지만, 컨테이너는 **호스트 커널을 그대로 공유**합니다. 따라서 **커널 취약점 하나**(권한 상승 syscall 버그 등)면 컨테이너 경계가 무너져 호스트와 옆 컨테이너까지 닿습니다. 그래서 멀티테넌트(남의 코드를 같은 호스트에서 실행)에서는 seccomp로 시스템콜을 깎고, user namespace로 root를 무력화하고, 더 강한 격리가 필요하면 아예 **VM 경계**를 다시 끌어옵니다.

## 다시 만난 양 끝: 마이크로 VM

"컨테이너의 가벼움 + VM의 격리"를 둘 다 원할 때 등장한 게 **마이크로 VM**입니다. AWS가 Lambda·Fargate를 위해 만든 **Firecracker**는, 불필요한 장치 에뮬레이션을 걷어낸 초경량 VM을 ~125ms 만에 띄웁니다 — 함수 하나하나에 **전용 커널(=VM 경계)** 을 주면서도 컨테이너에 가까운 시작 속도를 냅니다. **gVisor**는 반대 방향으로, 유저 공간에 커널을 다시 구현해 게스트 시스템콜이 호스트 커널에 직접 닿지 못하게 막습니다.

남의 코드를 초 단위로 수억 번 실행해야 하는 서버리스에서, "공유 커널 컨테이너"의 격리는 충분하지 않았습니다. **밀도를 조금 양보하고 격리를 사서** 스펙트럼의 가운데로 돌아온 셈입니다.

## 직접 들여다보기: namespace와 cgroup 만져 보기

컨테이너가 마법이 아니라 커널 기능 조합임을, 도커 없이 맨손으로 확인해 봅시다.

```bash
# 새 PID + 마운트 namespace에서 셸을 띄우면, 그 안의 ps는 자기만 본다
sudo unshare --pid --mount --fork --mount-proc bash
  ps -ef          # PID 1이 방금 띄운 bash — 격리된 뷰

# 한 프로세스가 들어가 있는 namespace 목록
lsns
ls -l /proc/$$/ns          # pid/net/mnt/uts/ipc/user/cgroup → 각 namespace의 inode

# cgroup v2로 메모리 상한 걸기 (200MB 넘으면 OOM)
sudo mkdir /sys/fs/cgroup/demo
echo 200M | sudo tee /sys/fs/cgroup/demo/memory.max
echo $$   | sudo tee /sys/fs/cgroup/demo/cgroup.procs

# 도커는 결국 이걸 묶어줄 뿐 — 확인
docker run --memory=200m --cpus=1.5 --rm nginx
nsenter -t <PID> -n -m bash   # 실행 중 컨테이너의 net+mnt namespace로 진입
```

`unshare` 한 줄로 "PID 1"을 만들어 내는 순간, 컨테이너가 **커널이 원래 갖고 있던 격리 기능의 사용자 친화적 포장**이라는 게 손에 잡힙니다.

## 면접/리뷰 단골 질문

- **Q. VM과 컨테이너의 본질적 차이는?** → 가상화 대상이 다르다. VM은 하드웨어를 가상화해 **게스트 커널을 통째로** 올리고, 컨테이너는 **호스트 커널을 공유**하며 namespace로 뷰만, cgroup으로 자원만 격리한다.
- **Q. 컨테이너가 "가볍다"는 게 정확히 뭐가 가벼운가?** → 게스트 커널이 없어 메모리 중복이 없고, 부팅 과정이 없어(프로세스 시작일 뿐) 즉시 뜬다. CPU 가상화 오버헤드 얘기가 아니다.
- **Q. namespace와 cgroup의 역할 구분은?** → namespace = *무엇이 보이는가*(PID·네트워크·마운트 뷰 격리), cgroup = *얼마나 쓰는가*(CPU·메모리·I/O 제한). 컨테이너는 이 둘의 조합이다.
- **Q. 컨테이너 탈출이 VM 탈출보다 위험한 이유는?** → 커널을 공유하므로 커널 취약점 하나로 경계가 무너진다. VM은 하이퍼바이저라는 더 작고 단단한 경계를 추가로 뚫어야 한다.
- **Q. 서버리스가 컨테이너 대신 마이크로 VM을 쓰는 이유는?** → 멀티테넌트에서 공유 커널 격리가 부족해서. Firecracker 같은 마이크로 VM은 전용 커널(VM 경계)을 주면서도 시작이 빨라, 격리와 밀도를 절충한다.

## 정리

- 가상화는 "무엇을 가상화하나"의 문제다 — VM은 **하드웨어**(게스트 커널 포함), 컨테이너는 **커널 뷰**(공유 커널).
- VM이 무거운 진짜 이유는 CPU 오버헤드가 아니라 **중복된 게스트 커널**의 메모리·부팅 비용이다.
- 컨테이너는 단일 실체가 아니라 **namespace(뷰 격리) + cgroup(자원 제한) + overlayfs + seccomp**가 만든 착시다.
- 커널을 공유하므로 컨테이너 격리는 VM보다 약하다 → **커널 취약점 = 탈출 위험**.
- 격리는 스펙트럼이고, **마이크로 VM**(Firecracker)은 격리와 밀도를 절충해 서버리스를 가능하게 했다.

> 다음 글: 시리즈의 마지막, 지금까지의 프로세스·메모리·I/O 지식을 하나로 묶어 "느려요"를 진단으로 바꾸는 [성능 관찰과 병목 분석]({% post_url 2023-12-16-os-performance-observability %})으로 갑니다. 컨테이너의 자원 제한이 실제로 어떻게 병목으로 나타나는지도 거기서 만납니다. (프로세스·PID의 기초가 흔들린다면 [프로세스 편]({% post_url 2023-02-13-os-process-address-space %})으로 돌아가세요.)

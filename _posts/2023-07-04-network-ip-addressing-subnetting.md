---
title: IP 주소와 서브넷팅 — /24를 /26으로 쪼갠다는 게 비트 단위로 무슨 뜻인가
description: "IPv4·IPv6 주소 체계, 서브넷 마스크와 CIDR(/24, /26) 표기, 서브넷팅 계산(네트워크·브로드캐스트·가용 호스트 수), 사설망 대역과 마스크 AND 연산을 비트 단위로 설명합니다."
date: 2023-07-04 10:00:00 +0900
series: "네트워크 A-Z"
categories: [Network]
tags: [network, ip-address, subnetting, cidr, ipv6, rfc1918]
mermaid: true
image:
  path: /assets/img/posts/network-ip-addressing-subnetting.png
  lqip: "data:image/jpeg;base64,/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAANABgDASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAgABBv/EACAQAAICAQMFAAAAAAAAAAAAAAECABESAzFREyFBwdH/xAAVAQEBAAAAAAAAAAAAAAAAAAABAv/EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAwDAQACEQMRAD8A5rpoTZ1EBvY38g1EVTSurit1v2IWYZHt55mZS6iFiMbsXxKDKUNL/9k="
  alt: "IP 주소와 서브넷팅"
---

## "10.0.1.0/24가 정확히 무슨 뜻이지?"

AWS VPC를 만들 때 `10.0.0.0/16`을 적고, 서브넷에 `10.0.1.0/24`를 적습니다. `/16`, `/24`가 "주소 범위"라는 건 어렴풋이 알지만, **왜 /24가 254개고**, /24를 /26으로 쪼개면 왜 정확히 4개가 되며, 호스트가 보낸 패킷이 "같은 서브넷인지 아닌지"를 어떻게 즉석에서 판단하는지는 의외로 안 짚고 넘어갑니다.

이건 전부 **비트 마스킹** 하나로 설명됩니다. [앞 글]({% post_url 2023-05-09-network-ethernet-mac-switch %})에서 "브로드캐스트 도메인 = 하나의 서브넷"이라고 했는데, 이 글은 그 서브넷이 비트 단위로 무엇인지, 그리고 주소 공간을 어떻게 계층적으로 쪼개는지를 끝까지 따라갑니다. 이게 [라우팅]({% post_url 2023-09-05-network-routing-bgp %})·[ARP]({% post_url 2023-11-07-network-arp-l2-l3 %})·[VPC]({% post_url 2025-09-09-network-vpc-cloud %})를 이해하는 토대입니다.

## IPv4 주소: 32비트를 둘로 가른다

IPv4 주소는 32비트입니다. 사람이 읽기 쉽게 8비트씩 끊어 점10진(dotted decimal)으로 씁니다.

```text
   192   .    168   .     1    .    10
11000000 . 10101000 . 00000001 . 00001010   (32비트)
```

핵심은 이 32비트가 **네트워크부 + 호스트부**로 나뉜다는 것입니다. 어디서 자르는지를 정하는 게 **서브넷 마스크**입니다.

- **네트워크부**: 어느 서브넷인지(같은 서브넷의 모든 호스트가 공유).
- **호스트부**: 그 서브넷 안에서 어느 장치인지.

## CIDR: 마스크를 비트 개수로 — `/n`

옛날엔 클래스(A/B/C)로 자르는 위치가 고정이었지만, 너무 낭비라 폐기되고 **CIDR**(Classless Inter-Domain Routing, RFC 4632)이 표준이 됐습니다. CIDR은 "**앞에서부터 몇 비트가 네트워크부인가**"를 `/n`으로 표기합니다.

```text
/24 → 앞 24비트가 네트워크부, 나머지 8비트가 호스트부
마스크: 11111111.11111111.11111111.00000000 = 255.255.255.0
호스트 비트 8개 → 2^8 = 256개 주소, 사용 가능 호스트는 256 − 2 = 254개
```

> **왜 −2 인가?** 호스트부가 **전부 0**인 주소는 **네트워크 주소**(서브넷 그 자체를 가리킴), **전부 1**인 주소는 **브로드캐스트 주소**(서브넷 전체에게)로 예약됩니다. 그래서 실제 장치에 줄 수 있는 건 (2^호스트비트 − 2)개입니다.

| CIDR | 마스크 | 호스트 비트 | 총 주소 | 사용 가능 호스트 |
|---|---|---|---|---|
| /24 | 255.255.255.0 | 8 | 256 | 254 |
| /25 | 255.255.255.128 | 7 | 128 | 126 |
| /26 | 255.255.255.192 | 6 | 64 | 62 |
| /27 | 255.255.255.224 | 5 | 32 | 30 |
| /30 | 255.255.255.252 | 2 | 4 | 2 (점대점 링크용) |

## 같은 서브넷인가? — 마스크 AND 연산

호스트가 "목적지가 나와 같은 서브넷인가"를 판단하는 방법은 단순합니다. **내 IP와 목적지 IP에 각각 마스크를 AND** 해서, 결과(네트워크 주소)가 같으면 같은 서브넷입니다. 같으면 [ARP]({% post_url 2023-11-07-network-arp-l2-l3 %})로 직접, 다르면 [라우터(게이트웨이)]({% post_url 2023-09-05-network-routing-bgp %})로 보냅니다.

아래 애니메이션: IP `192.168.1.10`에 마스크 `/24`(`255.255.255.0`)를 비트 AND 하면, 네트워크부(앞 24비트)는 그대로 남고 호스트부(뒤 8비트)는 **전부 0으로 깎여** 네트워크 주소 `192.168.1.0`이 추출됩니다.

<div class="sub-and" markdown="0">
<style>
.sub-and{margin:1.4rem 0;overflow-x:auto}
.sub-and svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.sub-and .lbl{fill:currentColor;font-size:12px;font-weight:600}
.sub-and .sub{fill:currentColor;font-size:10px;opacity:.6}
.sub-and .bit{font-family:ui-monospace,monospace;font-size:15px;font-weight:600;fill:currentColor}
.sub-and .net{fill:#1971c2}
.sub-and .host{fill:#f08c00}
.sub-and .zero{fill:#2f9e44;opacity:0;animation:subzero 5s ease-in-out infinite}
.sub-and .hostfade{animation:subfade 5s ease-in-out infinite}
.sub-and .mask{fill:currentColor;opacity:.45}
.sub-and .ln{stroke:currentColor;opacity:.3;stroke-width:1.2}
@keyframes subfade{0%,40%{opacity:1}55%,100%{opacity:0}}
@keyframes subzero{0%,45%{opacity:0}60%,100%{opacity:1}}
</style>
<svg viewBox="0 0 700 210" role="img" aria-label="IP에 서브넷 마스크를 AND 연산하면 호스트 비트가 0으로 깎여 네트워크 주소가 추출되는 과정 애니메이션">
  <text class="lbl" x="10" y="34">IP</text>
  <text class="bit net"  x="80"  y="38">11000000.10101000.00000001.</text>
  <text class="bit host" x="500" y="38">00001010</text>
  <text class="sub" x="80" y="54">192.168.1   (네트워크부 = 앞 24비트)</text>
  <text class="sub host" x="500" y="54">.10 (호스트부)</text>

  <text class="lbl" x="10" y="100">AND 마스크 /24</text>
  <text class="bit mask" x="80"  y="104">11111111.11111111.11111111.</text>
  <text class="bit mask" x="500" y="104">00000000</text>
  <line class="ln" x1="70" y1="120" x2="600" y2="120"/>

  <text class="lbl" x="10" y="166">= 네트워크 주소</text>
  <text class="bit net"  x="80"  y="170">11000000.10101000.00000001.</text>
  <text class="bit host hostfade" x="500" y="170">00001010</text>
  <text class="bit zero" x="500" y="170">00000000</text>
  <text class="sub" x="80" y="190">192.168.1.0  ← 호스트 비트가 전부 0으로 깎임</text>
</svg>
</div>

이 단순한 AND 연산이 라우팅의 핵심 동작입니다. 라우터도 똑같이 목적지 IP에 각 경로의 마스크를 AND 해서 일치하는 경로를 찾고, 그중 **가장 긴 마스크**(가장 구체적인 경로)를 택합니다 — [라우팅 글]({% post_url 2023-09-05-network-routing-bgp %})의 Longest Prefix Match입니다.

## 서브넷팅: /24 하나를 /26 네 개로 쪼개기

큰 블록을 작은 서브넷들로 나누는 게 서브넷팅입니다. `/24`(256개)를 `/26`(64개씩)으로 쪼개면 호스트 비트를 2개 빌려와 **2^2 = 4개**의 서브넷이 됩니다. 아래 애니메이션에서 하나의 `/24` 막대가 네 개의 `/26` 블록으로 갈라집니다.

<div class="sub-split" markdown="0">
<style>
.sub-split{margin:1.4rem 0;overflow-x:auto}
.sub-split svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.sub-split .lbl{fill:currentColor;font-size:12px;font-weight:600}
.sub-split .sub{fill:currentColor;font-size:10px;opacity:.7}
.sub-split .whole{fill:#1971c2;opacity:.8}
.sub-split .gap{animation:subgap 6s ease-in-out infinite}
.sub-split .b1{fill:#1971c2}.sub-split .b2{fill:#2f9e44}.sub-split .b3{fill:#f08c00}.sub-split .b4{fill:#e03131}
.sub-split .piece{opacity:0;animation:subpiece 6s ease-in-out infinite}
.sub-split .ptxt{opacity:0;animation:subpiece 6s ease-in-out infinite}
@keyframes subgap{0%,35%{opacity:.8}55%,100%{opacity:0}}
@keyframes subpiece{0%,40%{opacity:0}60%,100%{opacity:.85}}
</style>
<svg viewBox="0 0 700 180" role="img" aria-label="하나의 슬래시24 블록이 네 개의 슬래시26 서브넷으로 쪼개지는 애니메이션">
  <text class="lbl" x="10" y="34">10.0.1.0/24  (256개 주소)</text>
  <rect class="whole gap" x="20" y="44" width="660" height="34" rx="5"/>
  <text class="sub gap" x="350" y="66" text-anchor="middle" fill="#fff">하나의 /24</text>

  <text class="lbl piece" x="10" y="118">→ /26 네 개 (각 64개, 사용가능 62)</text>
  <rect class="piece b1" x="20"  y="128" width="158" height="34" rx="5"/>
  <rect class="piece b2" x="186" y="128" width="158" height="34" rx="5"/>
  <rect class="piece b3" x="352" y="128" width="158" height="34" rx="5"/>
  <rect class="piece b4" x="518" y="128" width="158" height="34" rx="5"/>
  <text class="sub ptxt" x="99"  y="150" text-anchor="middle" fill="#fff">.0/26</text>
  <text class="sub ptxt" x="265" y="150" text-anchor="middle" fill="#fff">.64/26</text>
  <text class="sub ptxt" x="431" y="150" text-anchor="middle" fill="#fff">.128/26</text>
  <text class="sub ptxt" x="597" y="150" text-anchor="middle" fill="#fff">.192/26</text>
</svg>
</div>

네 서브넷의 경계는 호스트부 6비트가 만드는 64 간격입니다.

| 서브넷 | 네트워크 주소 | 사용 가능 범위 | 브로드캐스트 |
|---|---|---|---|
| 1 | 10.0.1.0/26 | .1 ~ .62 | .63 |
| 2 | 10.0.1.64/26 | .65 ~ .126 | .127 |
| 3 | 10.0.1.128/26 | .129 ~ .190 | .191 |
| 4 | 10.0.1.192/26 | .193 ~ .254 | .255 |

```bash
ipcalc 10.0.1.0/26         # Network/Broadcast/HostMin/HostMax/호스트수 한 번에
ip addr show eth0          # inet 10.0.1.10/24 ← 내 IP와 prefix 길이
ip route get 8.8.8.8       # 이 목적지로 갈 때 어느 인터페이스/게이트웨이를 쓰는지
```

이 발상이 그대로 **AWS VPC**입니다: `10.0.0.0/16` VPC를 만들고, AZ별로 `/24` 서브넷을 잘라 퍼블릭/프라이빗으로 나눕니다 — 자세한 건 [VPC 글]({% post_url 2025-09-09-network-vpc-cloud %})에서.

## 사설 IP와 특수 대역 (RFC 1918)

공인 IPv4는 유한해서, 내부망은 **사설 대역**(RFC 1918)을 쓰고 인터넷으로 나갈 때 [NAT]({% post_url 2025-01-07-network-nat %})로 공인 IP로 바꿉니다.

| 대역 | 범위 | 크기 |
|---|---|---|
| 10.0.0.0/8 | 10.0.0.0 ~ 10.255.255.255 | 1670만 (대규모·클라우드 VPC) |
| 172.16.0.0/12 | 172.16.0.0 ~ 172.31.255.255 | 104만 |
| 192.168.0.0/16 | 192.168.0.0 ~ 192.168.255.255 | 6.5만 (가정용 공유기) |
| 127.0.0.0/8 | 루프백 (localhost) | — |
| 169.254.0.0/16 | 링크-로컬(APIPA). 클라우드 메타데이터(169.254.169.254)도 여기 | — |

## IPv6: 32비트가 부족해서 128비트로

IPv4 주소(약 43억 개)는 이미 고갈됐습니다(IANA 2011년 소진). 근본 해법이 **IPv6**입니다 — 32비트 → **128비트**(약 3.4×10^38개, 지구 모래알보다 많음).

```text
2001:0db8:0000:0000:0000:ff00:0042:8329
→ 2001:db8::ff00:42:8329   (앞 0 생략, 연속 0 블록은 :: 한 번)
```

- 표기: 16비트씩 8그룹, 콜론 구분. 각 그룹 앞 0 생략, 연속 0 그룹은 `::`로 한 번 압축.
- **앞 64비트 = 네트워크 프리픽스, 뒤 64비트 = 인터페이스 ID**(보통 /64가 한 서브넷). 서브넷 하나에 2^64개 — 사실상 무한.
- 브로드캐스트가 없고 **멀티캐스트/애니캐스트**로 대체. NAT 없이 모든 장치가 공인 주소를 가질 수 있어 end-to-end 연결성이 복원됩니다.
- 전환기에는 IPv4/IPv6 **듀얼 스택**으로 공존.

```bash
ip -6 addr show            # IPv6 주소 확인 (fe80::/10 = 링크-로컬)
ping6 2001:4860:4860::8888 # 구글 공개 IPv6 DNS
```

## 프로덕션 함정

- **서브넷 겹침(overlap)**: 두 네트워크가 같은 CIDR을 쓰면(예: 양쪽 다 192.168.1.0/24) VPN/피어링 시 라우팅이 충돌합니다. VPC 설계 시 대역을 **미리 겹치지 않게** 할당해야 합니다.
- **너무 작게 자른 서브넷**: `/28`(14개)로 쪼갰다가 오토스케일로 IP가 모자라는 경우. 클라우드는 게이트웨이·예약 IP까지 빼가므로 여유를 둬야 합니다(AWS는 서브넷당 5개를 예약).
- **off-by-one 계산 실수**: 네트워크/브로드캐스트 주소를 호스트에 할당하는 실수. `ipcalc`로 항상 검산하세요.

## 면접/리뷰 단골 질문

- **Q. /26은 호스트가 몇 개?** → 호스트 비트 6개 → 64주소 − 2(네트워크·브로드캐스트) = **62개**.
- **Q. 호스트가 같은 서브넷인지 어떻게 판단하나?** → 내 IP와 목적지 IP에 마스크를 각각 AND 해 네트워크 주소가 같은지 본다. 같으면 직접(ARP), 다르면 게이트웨이로.
- **Q. /24를 /26으로 쪼개면 몇 개?** → 호스트 비트 2개를 빌리니 2^2 = 4개 서브넷.
- **Q. IPv6가 필요한 이유는?** → IPv4 32비트(43억)는 고갈. 128비트로 사실상 무한 + NAT 없는 end-to-end 복원.
- **Q. 네트워크 주소와 브로드캐스트 주소는?** → 호스트부가 전부 0이면 네트워크 주소, 전부 1이면 브로드캐스트 주소. 둘 다 호스트에 할당 불가.

## 정리

- IPv4 32비트 = **네트워크부 + 호스트부**, 자르는 위치를 **CIDR `/n`**(= 서브넷 마스크)이 정한다.
- 사용 가능 호스트 = **2^호스트비트 − 2**(네트워크·브로드캐스트 예약).
- "같은 서브넷인가"는 **마스크 AND** 한 줄로 판단 — 라우팅의 Longest Prefix Match와 같은 원리.
- 서브넷팅 = 호스트 비트를 빌려 큰 블록을 작은 서브넷들로 쪼개기. **AWS VPC 설계가 곧 이것**.
- 사설 대역(RFC 1918) + NAT로 IPv4를 버티고, 근본 해법은 **IPv6 128비트**.

> 다음 글: 다른 서브넷으로 나간 패킷이 전 세계 라우터를 어떻게 건너가는지 — [라우팅과 BGP]({% post_url 2023-09-05-network-routing-bgp %}). 그리고 같은 서브넷 안에서 IP를 MAC으로 바꾸는 [ARP]({% post_url 2023-11-07-network-arp-l2-l3 %})가 이어집니다.

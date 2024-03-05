---
title: TCP는 얼마나 빨리 보낼까 — 흐름 제어 vs 혼잡 제어, 그리고 톱니파의 비밀
description: "흐름 제어(rwnd)와 혼잡 제어(cwnd)의 차이, 슬로스타트·혼잡 회피의 AIMD 톱니파, 손실 감지(타임아웃·3 dup ACK), Reno·CUBIC·BBR, 버퍼블로트와 BDP를 그림으로 설명합니다."
date: 2024-03-05 10:00:00 +0900
series: "네트워크 A-Z"
categories: [Network]
tags: [tcp, congestion-control, flow-control, aimd, cubic, bbr, bufferbloat]
mermaid: true
image:
  path: /assets/img/posts/network-tcp-flow-congestion-control.png
  lqip: "data:image/jpeg;base64,/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAANABgDASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAgABBv/EACAQAAICAgEFAQAAAAAAAAAAAAECABEDElEhMUFhwdH/xAAVAQEBAAAAAAAAAAAAAAAAAAABAv/EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAwDAQACEQMRAD8A5oY0aycmNTfY3+QZEVTQdX9rf0Qsw2PTzzM2l1ELUa3YviUG0oaX/9k="
  alt: "TCP 흐름·혼잡 제어"
---

## 두 개의 "멈춰"는 서로 다른 사람이 외친다

TCP가 데이터를 보낼 때, "지금 얼마나 보내도 되나"를 정하는 두 개의 브레이크가 있습니다. 자주 한 덩어리로 뭉뚱그리지만 **완전히 다른 문제**입니다.

- **흐름 제어(flow control)**: *수신자*가 감당 못 할까 봐 — "내 버퍼 넘치니 천천히." 수신 버퍼가 결정.
- **혼잡 제어(congestion control)**: *네트워크*가 막힐까 봐 — "중간 라우터 큐가 터지니 천천히." 패킷 손실/지연이 결정.

실제 송신량은 **둘 중 작은 쪽**입니다: `전송 가능 = min(rwnd, cwnd)`. 이 글은 이 두 윈도우가 어떻게 움직이는지, 왜 혼잡 제어 그래프가 **톱니파**를 그리는지, 그리고 BBR이 왜 그 톱니를 버렸는지까지 봅니다. 전제는 [TCP 핸드셰이크/신뢰성]({% post_url 2024-01-09-network-tcp-handshake-state %})입니다.

## 흐름 제어: 슬라이딩 윈도우와 rwnd

수신자는 매 ACK의 **윈도우 크기 필드(rwnd)** 로 "내 수신 버퍼에 이만큼 여유 있다"를 알립니다. 송신자는 ACK 안 된 데이터를 그 한도 내로만 유지합니다. 윈도우가 ACK를 따라 오른쪽으로 미끄러지는 모습:

<div class="cwnd-sw" markdown="0">
<style>
.cwnd-sw{margin:1.4rem 0;overflow-x:auto}
.cwnd-sw svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.cwnd-sw .seg{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.4}
.cwnd-sw .acked{fill:#2f9e44;opacity:.55}
.cwnd-sw .win{fill:#1971c2;opacity:.18;stroke:#1971c2;stroke-width:1.6}
.cwnd-sw .lbl{fill:currentColor;font-size:11px;font-weight:600}
.cwnd-sw .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.cwnd-sw .winbox{animation:cwndslide 6s ease-in-out infinite}
.cwnd-sw .a1{animation:cwndack 6s ease-in-out infinite}
.cwnd-sw .a2{animation:cwndack 6s ease-in-out infinite 1.5s}
.cwnd-sw .a3{animation:cwndack 6s ease-in-out infinite 3s}
@keyframes cwndslide{0%{transform:translateX(0)}30%{transform:translateX(0)}55%{transform:translateX(132px)}100%{transform:translateX(132px)}}
@keyframes cwndack{0%,30%{opacity:.08}45%,100%{opacity:.55}}
</style>
<svg viewBox="0 0 700 120" role="img" aria-label="슬라이딩 윈도우가 ACK를 받을 때마다 오른쪽으로 미끄러지며 송신 가능 범위가 전진하는 흐름 제어 애니메이션">
  <text class="lbl" x="6" y="22">바이트 스트림 · 윈도우가 ACK 따라 전진</text>
  <g>
    <rect class="seg" x="20"  y="40" width="40" height="34" rx="3"/>
    <rect class="seg" x="64"  y="40" width="40" height="34" rx="3"/>
    <rect class="seg" x="108" y="40" width="40" height="34" rx="3"/>
    <rect class="acked a1" x="20"  y="40" width="40" height="34" rx="3"/>
    <rect class="acked a2" x="64"  y="40" width="40" height="34" rx="3"/>
    <rect class="acked a3" x="108" y="40" width="40" height="34" rx="3"/>
    <rect class="seg" x="152" y="40" width="40" height="34" rx="3"/>
    <rect class="seg" x="196" y="40" width="40" height="34" rx="3"/>
    <rect class="seg" x="240" y="40" width="40" height="34" rx="3"/>
    <rect class="seg" x="284" y="40" width="40" height="34" rx="3"/>
    <rect class="seg" x="328" y="40" width="40" height="34" rx="3"/>
    <rect class="seg" x="372" y="40" width="40" height="34" rx="3"/>
    <rect class="seg" x="416" y="40" width="40" height="34" rx="3"/>
    <rect class="seg" x="460" y="40" width="40" height="34" rx="3"/>
    <rect class="win winbox" x="150" y="34" width="180" height="46" rx="5"/>
  </g>
  <text class="sub" x="40"  y="98">전송+ACK</text>
  <text class="sub" x="230" y="98">전송 가능 윈도우</text>
</svg>
</div>

`rwnd = 0`이면 송신자는 멈추고, 주기적으로 작은 **윈도우 프로브**를 보내 "이제 여유 생겼나" 확인합니다. 수신 앱이 데이터를 안 읽으면 윈도우가 0으로 닫혀 송신이 막히는 게 정상 동작입니다(누수 아님).

## 혼잡 제어: 네트워크는 자기 상태를 안 알려준다

흐름 제어와 달리, 라우터는 "나 막혔어"를 친절히 알려주지 않습니다(best-effort). TCP는 **간접 신호**로 혼잡을 추측합니다 — 주로 **패킷 손실**, 또는 지연 증가(BBR). 핵심 변수가 송신자만 아는 **혼잡 윈도우(cwnd)** 입니다.

### 슬로 스타트 → 혼잡 회피 → 손실 → 반복

고전 알고리즘(Reno 계열)은 이렇게 움직입니다.

1. **슬로 스타트**: `cwnd`를 1 MSS에서 시작, ACK마다 **지수적**(매 RTT 2배) 증가. "이름과 달리 빠르게" 가용 대역을 탐색.
2. `cwnd ≥ ssthresh`가 되면 **혼잡 회피**: 매 RTT **선형**(+1 MSS) 증가. 조심스럽게.
3. **손실 감지**:
   - **3 dup ACK**(같은 ack 3번) → 가벼운 혼잡 → `cwnd` 절반, **fast retransmit/recovery**(슬로 스타트로 안 돌아감).
   - **타임아웃(RTO)** → 심각 → `cwnd`를 1로, `ssthresh`를 절반으로, 슬로 스타트부터 다시.

이 "선형 증가 + 곱셈 감소"가 **AIMD**(Additive Increase, Multiplicative Decrease)이고, 그래서 cwnd는 톱니파를 그립니다. 직접 보세요 — <span style="color:#2f9e44;font-weight:600">초록</span> 곡선이 올라가다 손실에서 <span style="color:#e03131;font-weight:600">반토막</span> 납니다.

<div class="cwnd-tooth" markdown="0">
<style>
.cwnd-tooth{margin:1.4rem 0;overflow-x:auto}
.cwnd-tooth svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.cwnd-tooth .ax{stroke:currentColor;opacity:.4;stroke-width:1.4}
.cwnd-tooth .grid{stroke:currentColor;opacity:.12;stroke-width:1}
.cwnd-tooth .lbl{fill:currentColor;font-size:11px;font-weight:600}
.cwnd-tooth .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.cwnd-tooth .saw{fill:none;stroke:#2f9e44;stroke-width:2.4;stroke-dasharray:1400;stroke-dashoffset:1400;animation:cwnddraw 7s linear infinite}
.cwnd-tooth .drop{fill:#e03131;opacity:0}
.cwnd-tooth .d1{animation:cwnddot 7s linear infinite}
.cwnd-tooth .d2{animation:cwnddot 7s linear infinite}
@keyframes cwnddraw{0%{stroke-dashoffset:1400}90%{stroke-dashoffset:0}100%{stroke-dashoffset:0}}
@keyframes cwnddot{0%,33%{opacity:0}38%{opacity:1}48%{opacity:0}100%{opacity:0}}
</style>
<svg viewBox="0 0 700 230" role="img" aria-label="혼잡 윈도우가 슬로 스타트로 지수 증가, 혼잡 회피로 선형 증가하다 손실 시 절반으로 줄며 톱니파를 그리는 AIMD 애니메이션">
  <line class="ax" x1="50" y1="20" x2="50" y2="195"/>
  <line class="ax" x1="50" y1="195" x2="670" y2="195"/>
  <text class="lbl" x="14" y="105" transform="rotate(-90 14 105)" text-anchor="middle">cwnd</text>
  <text class="sub" x="360" y="218" text-anchor="middle">시간(RTT)</text>
  <line class="grid" x1="50" y1="90" x2="670" y2="90"/>
  <text class="sub" x="78" y="40">슬로스타트(지수)</text>
  <text class="sub" x="250" y="40">혼잡회피(선형)</text>
  <path class="saw" d="M50,190 L70,180 L90,160 L110,120 L130,55 L150,90 L200,72 L250,54 L260,150 L300,135 L350,120 L400,105 L405,165 L450,150 L500,135 L550,120 L600,105"/>
  <circle class="drop d1" cx="130" cy="55" r="5"/>
  <circle class="drop d2" cx="260" cy="54" r="5"/>
</svg>
</div>

> **왜 곱셈 감소인가?** 혼잡은 빠르게 악화됩니다(모두가 큐를 채우면 붕괴). 그래서 줄일 땐 과감하게 **절반**으로 물러나 빠르게 안정시키고, 늘릴 땐 +1씩 조심합니다. 여러 흐름이 같은 병목을 공유할 때 AIMD가 **공정성**(각자 비슷한 몫)으로 수렴한다는 게 수학적으로 증명돼 있습니다.

## Reno → CUBIC → BBR: 무엇이 바뀌었나

| 알고리즘 | 혼잡 신호 | 특징 | 어디서 |
|----------|----------|------|--------|
| **Reno/NewReno** | 손실 | 고전 AIMD 톱니 | 교과서 |
| **CUBIC** | 손실 | 시간의 3차 함수로 증가 → 고대역·고지연(BDP 큰) 링크에서 빠른 회복 | **리눅스 기본** |
| **BBR** | **대역폭·RTT 모델** | 손실을 기다리지 않고 병목 대역폭·최소 RTT를 추정해 그 지점에서 운전 | 구글, YouTube·여러 CDN |

BBR이 중요한 이유: 손실 기반 알고리즘은 **큐가 가득 찰 때까지** 보내다 손실을 봐야 물러납니다. 그래서 라우터 버퍼가 과도하게 크면(요즘 흔함) 큐에 패킷이 잔뜩 쌓여 **지연이 치솟습니다** — 이게 **버퍼블로트(bufferbloat)** 입니다. BBR은 손실이 아니라 "대역폭은 안 느는데 RTT만 늘기 시작하는 지점"을 병목으로 보고 거기서 멈춰, 큐를 거의 안 채우고도 대역을 다 씁니다.

## BDP: 윈도우가 얼마나 커야 하나

링크를 가득 채우려면 "**날아가는 중인** 데이터"가 파이프 부피만큼 있어야 합니다.

```
BDP(대역폭-지연 곱) = 대역폭 × RTT
예) 1 Gbps × 80 ms = 10⁹ × 0.08 / 8 ≈ 10 MB
```

윈도우(`min(rwnd, cwnd)`)가 BDP보다 작으면, 데이터를 다 보내고 ACK를 기다리느라 **링크가 놀아** 처리량이 떨어집니다. 그래서 고대역·고지연(LFN, "롱 팻 네트워크")에선 **윈도우 스케일링 옵션**(16비트 윈도우 한계 64 KB를 1 GB까지 확장)이 필수입니다. 이 관계는 [성능 글]({% post_url 2026-01-06-network-performance-bdp %})에서 더 깊게 다룹니다.

## 디버깅: cwnd와 RTT를 직접 본다

```bash
# 연결별 혼잡 상태 (cwnd, rtt, retrans, 알고리즘)
ss -ti dst 10.0.0.5
#  cubic wscale:7,7 rtt:42.3/5.1 mss:1448 cwnd:120 ssthresh:80
#  bytes_retrans:... retrans:0/3 ...

# 현재 기본 알고리즘과 사용 가능 목록
sysctl net.ipv4.tcp_congestion_control
sysctl net.ipv4.tcp_available_congestion_control

# BBR 켜기 (커널 4.9+)
sysctl -w net.ipv4.tcp_congestion_control=bbr
```

`ss -ti`의 `cwnd`가 작고 `retrans`가 계속 오르면 경로 어딘가에서 손실이 나고 있다는 뜻입니다. `rtt`가 평소의 몇 배로 부풀면 버퍼블로트를 의심합니다.

## 프로덕션 함정

- **큰 버퍼 ≠ 빠름**: 송수신 버퍼나 라우터 큐를 무작정 키우면 버퍼블로트로 **지연이 악화**됩니다. 손실 기반 알고리즘은 큐를 채워야 멈추기 때문.
- **rwnd만 보고 cwnd를 잊음**: "수신 버퍼 키웠는데 안 빨라요" — 병목이 네트워크면 cwnd가 한계라 소용없습니다. `ss -ti`로 어느 쪽이 작은지 확인하세요.
- **짧은 연결은 슬로 스타트에 갇힘**: 작은 요청은 cwnd가 커지기도 전에 끝나, 대역폭이 아니라 **RTT가 지배**합니다 → keep-alive/연결 재사용, [HTTP/2·3]({% post_url 2024-09-10-network-http-evolution %})의 멀티플렉싱이 중요한 이유.

## 면접/리뷰 단골 질문

- **Q. 흐름 제어와 혼잡 제어의 차이는?** → 흐름=수신자 보호(rwnd), 혼잡=네트워크 보호(cwnd). 실제 송신은 `min(rwnd, cwnd)`.
- **Q. cwnd가 왜 톱니파인가?** → AIMD: 선형 증가(탐색) + 손실 시 곱셈 감소(빠른 후퇴). 공정성·안정성에 유리.
- **Q. 3 dup ACK와 RTO 타임아웃의 처리가 왜 다른가?** → dup ACK는 후속 패킷이 도착 중이란 신호(가벼운 혼잡)라 절반만 줄이고 fast recovery. 타임아웃은 흐름이 끊긴 심각 상황이라 cwnd를 1로.
- **Q. BBR이 CUBIC보다 나은 점은?** → 손실을 기다리지 않고 대역폭·RTT를 모델링해, 버퍼블로트 환경에서 낮은 지연으로 높은 처리량을 낸다.

## 정리

- 송신량 = **min(rwnd, cwnd)** — 흐름 제어(수신자)와 혼잡 제어(네트워크)는 다른 브레이크다.
- 고전 혼잡 제어는 **AIMD** → cwnd 톱니파. 슬로 스타트(지수)→혼잡 회피(선형)→손실 시 반감.
- **CUBIC**(리눅스 기본)은 BDP 큰 링크에 최적화, **BBR**은 손실 대신 대역폭·RTT를 모델링해 버퍼블로트를 피한다.
- 처리량은 **윈도우 ≥ BDP**여야 보장된다 → 윈도우 스케일링.
- 진단은 `ss -ti`로 cwnd·rtt·retrans를 직접 본다.

> 다음: TCP의 한계(연결당 핸드셰이크, HOL blocking)를 정면으로 다루는 [UDP와 QUIC]({% post_url 2024-05-07-network-udp-quic %}).

---
title: 네트워크 성능 — 대역폭은 왜 빠름이 아닌가 (RTT·BDP·처리량의 진실)
description: "대역폭과 지연·RTT의 차이(파이프 굵기 vs 길이), BDP=대역폭×RTT, 윈도우와 처리량의 관계, Mathis 공식, 버퍼블로트, iperf3·traceroute·mtr 측정까지 네트워크 성능을 분석합니다."
date: 2026-01-06 10:00:00 +0900
series: "네트워크 A-Z"
categories: [Network]
tags: [bandwidth, latency, rtt, bdp, throughput, bufferbloat]
mermaid: true
image:
  path: /assets/img/posts/network-performance-bdp.png
  lqip: "data:image/jpeg;base64,/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAANABgDASIAAhEBAxEB/8QAGAAAAgMAAAAAAAAAAAAAAAAAAAIBAwb/xAAhEAABBAEDBQAAAAAAAAAAAAABAAIREgMTIVExQVKRof/EABYBAQEBAAAAAAAAAAAAAAAAAAIAAf/EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAwDAQACEQMRAD8AzeljO5y42mehtI+Kt7GtiHtfPiDt7CVzhY7d+VFk6JqisyJ4QkshZqf/2Q=="
  alt: "네트워크 성능과 BDP"
---

## "기가비트인데 왜 느리죠?"

회선을 1 Gbps로 올렸는데 서울↔프랑크푸르트 파일 전송이 여전히 답답합니다. 대역폭을 더 사도 안 빨라집니다. 이건 버그가 아니라 **대역폭과 지연이 서로 다른 축**이기 때문입니다. 이 글의 목표는 "느리다"는 막연한 말을 **대역폭 / 지연 / RTT / BDP / 손실**이라는 측정 가능한 양으로 분해하고, 왜 어떤 경우엔 더 넓은 파이프가 1바이트도 도움이 안 되는지를 끝까지 밝히는 것입니다.

[패킷 교환 글]({% post_url 2023-01-10-network-what-is-packet-switching %})에서 본 4가지 지연(전송·전파·처리·큐)이 여기서 성능 공식으로 합쳐집니다.

## 파이프 비유: 굵기 vs 길이

네트워크 경로를 **물 파이프**로 생각하면 모든 게 맞아떨어집니다.

- **대역폭(bandwidth)** = 파이프의 **굵기**. 단위 시간당 밀어 넣을 수 있는 비트(bps).
- **지연(latency)** = 파이프의 **길이**. 비트 하나가 끝까지 가는 시간. 주로 거리÷광속(전파 지연)이 지배.
- **RTT(왕복 시간)** = 보내고 응답이 돌아오기까지 = 대략 2 × 편도 지연.

<div class="bdp-pipe" markdown="0">
<style>
.bdp-pipe{margin:1.4rem 0;overflow-x:auto}
.bdp-pipe svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.bdp-pipe .lbl{fill:currentColor;font-size:12px;font-weight:600}
.bdp-pipe .sub{fill:currentColor;font-size:10px;opacity:.6}
.bdp-pipe .pipe{fill:none;stroke:currentColor;stroke-width:1.6;opacity:.4}
.bdp-pipe .bit{fill:#1971c2}
.bdp-pipe .f1{animation:bdpflow 3.4s linear infinite}
.bdp-pipe .f2{animation:bdpflow 3.4s linear infinite .42s}
.bdp-pipe .f3{animation:bdpflow 3.4s linear infinite .85s}
.bdp-pipe .f4{animation:bdpflow 3.4s linear infinite 1.27s}
.bdp-pipe .f5{animation:bdpflow 3.4s linear infinite 1.7s}
.bdp-pipe .f6{animation:bdpflow 3.4s linear infinite 2.12s}
.bdp-pipe .f7{animation:bdpflow 3.4s linear infinite 2.55s}
.bdp-pipe .f8{animation:bdpflow 3.4s linear infinite 2.97s}
@keyframes bdpflow{0%{transform:translateX(0);opacity:0}4%{opacity:1}96%{opacity:1}100%{transform:translateX(560px);opacity:0}}
</style>
<svg viewBox="0 0 720 140" role="img" aria-label="대역폭은 파이프 굵기 지연은 파이프 길이라는 비유로 비트가 흐르는 애니메이션">
  <text class="sub" x="40" y="30">송신</text>
  <text class="sub" x="650" y="30">수신</text>
  <rect class="pipe" x="80" y="40" width="560" height="56" rx="10"/>
  <text class="lbl" x="360" y="124" text-anchor="middle">길이 = 지연(거리÷광속) · 굵기 = 대역폭(bps)</text>
  <circle class="bit f1" cx="90" cy="68" r="7"/>
  <circle class="bit f2" cx="90" cy="68" r="7"/>
  <circle class="bit f3" cx="90" cy="68" r="7"/>
  <circle class="bit f4" cx="90" cy="68" r="7"/>
  <circle class="bit f5" cx="90" cy="68" r="7"/>
  <circle class="bit f6" cx="90" cy="68" r="7"/>
  <circle class="bit f7" cx="90" cy="68" r="7"/>
  <circle class="bit f8" cx="90" cy="68" r="7"/>
</svg>
</div>

핵심은 이것입니다. **파이프를 굵게 해도 길이는 안 줄어듭니다.** 서울↔프랑크푸르트 편도 전파는 광속 한계상 ~120 ms이고, 회선을 10배 넓혀도 첫 바이트 도착 시간은 그대로입니다. "빠르다"가 *지연*을 뜻하면 대역폭은 답이 아닙니다 — 답은 **거리를 줄이는 것**(CDN·엣지)입니다([CDN 글]({% post_url 2025-05-06-network-proxy-cdn %})).

## BDP — 파이프 안에 동시에 떠 있는 비트의 양

여기서 가장 중요한 양이 나옵니다. **대역폭-지연 곱(Bandwidth-Delay Product)**:

```text
BDP (비트) = 대역폭(bps) × RTT(초)
```

이건 "**전송했지만 아직 ACK를 못 받은**, 즉 파이프 안에 떠 있을 수 있는 데이터의 최대량"입니다. 파이프의 **부피**라고 생각하면 됩니다.

> **예시 — 왜 100 Mbps 회선이 12 Mbps밖에 안 나오나.**
> 대역폭 100 Mbps, RTT 80 ms 경로. BDP = 100 Mbps × 0.08 s = **8 Mbit = 1 MB**.
> 파이프를 가득 채우려면 송신 측이 ACK 없이 **1 MB를 앞서 보낼 수 있어야** 합니다.
> 그런데 TCP 윈도우가 64 KB(옛 기본)라면? 64 KB 보내고 ACK를 기다리느라 멈춥니다.
> 실효 처리량 = 윈도우 ÷ RTT = 64 KB ÷ 0.08 s ≈ **6.4 Mbps**. 대역폭의 6%만 씁니다.

이게 **LFN(Long Fat Network, 고대역폭·고지연 경로)** 의 함정입니다. 대역폭이 아니라 **윈도우가 병목**입니다.

## 윈도우가 BDP보다 작으면 — 파이프가 빈다

아래 위쪽은 윈도우가 BDP와 같아 파이프가 꽉 찬 경우, 아래쪽은 윈도우가 작아 보내고 멈추고(ACK 대기) 다시 보내며 **파이프에 빈 구간**이 생기는 경우입니다. 같은 회선인데 아래는 처리량이 절반 이하입니다.

<div class="bdp-win" markdown="0">
<style>
.bdp-win{margin:1.4rem 0;overflow-x:auto}
.bdp-win svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.bdp-win .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.bdp-win .sub{fill:currentColor;font-size:10px;opacity:.6}
.bdp-win .pipe{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.4}
.bdp-win .full{fill:#2f9e44}
.bdp-win .part{fill:#f08c00}
.bdp-win .a1{animation:bdpw 3s linear infinite}
.bdp-win .a2{animation:bdpw 3s linear infinite .3s}
.bdp-win .a3{animation:bdpw 3s linear infinite .6s}
.bdp-win .a4{animation:bdpw 3s linear infinite .9s}
.bdp-win .a5{animation:bdpw 3s linear infinite 1.2s}
.bdp-win .a6{animation:bdpw 3s linear infinite 1.5s}
.bdp-win .b1{animation:bdpw 3s linear infinite}
.bdp-win .b2{animation:bdpw 3s linear infinite .3s}
.bdp-win .b3{animation:bdpw 3s linear infinite 1.6s}
@keyframes bdpw{0%{transform:translateX(0);opacity:0}4%{opacity:1}96%{opacity:1}100%{transform:translateX(580px);opacity:0}}
</style>
<svg viewBox="0 0 720 200" role="img" aria-label="윈도우가 BDP와 같으면 파이프가 가득 차고 윈도우가 작으면 파이프에 빈 구간이 생겨 처리량이 떨어지는 비교 애니메이션">
  <text class="lbl" x="20" y="22" fill="#2f9e44">윈도우 = BDP · 파이프 꽉 참 (최대 처리량)</text>
  <rect class="pipe" x="40" y="32" width="600" height="34" rx="8"/>
  <rect class="full a1" x="48" y="40" width="20" height="18" rx="3"/>
  <rect class="full a2" x="48" y="40" width="20" height="18" rx="3"/>
  <rect class="full a3" x="48" y="40" width="20" height="18" rx="3"/>
  <rect class="full a4" x="48" y="40" width="20" height="18" rx="3"/>
  <rect class="full a5" x="48" y="40" width="20" height="18" rx="3"/>
  <rect class="full a6" x="48" y="40" width="20" height="18" rx="3"/>
  <text class="lbl" x="20" y="116" fill="#f08c00">윈도우 ≪ BDP · 빈 구간 (처리량 ↓)</text>
  <rect class="pipe" x="40" y="126" width="600" height="34" rx="8"/>
  <rect class="part b1" x="48" y="134" width="20" height="18" rx="3"/>
  <rect class="part b2" x="48" y="134" width="20" height="18" rx="3"/>
  <rect class="part b3" x="48" y="134" width="20" height="18" rx="3"/>
  <text class="sub" x="360" y="186" text-anchor="middle">같은 대역폭·같은 RTT — 차이는 오직 윈도우 크기</text>
</svg>
</div>

그래서 처리량의 근본 공식은 이렇습니다.

```text
실효 처리량 ≈ 윈도우 크기 / RTT      (윈도우가 병목일 때)
```

해법은 **윈도우를 BDP 이상으로** 키우는 것입니다. 리눅스는 `tcp_window_scaling`(RFC 1323)으로 64 KB 한계를 넘기고, **버퍼 자동 튜닝**(`tcp_rmem`/`tcp_wmem`의 max)으로 BDP에 맞춰 윈도우를 키웁니다. 송신 윈도우는 [혼잡 제어]({% post_url 2024-03-05-network-tcp-flow-congestion-control %})의 cwnd와 수신 윈도우 중 작은 쪽으로 정해지고, 이 버퍼는 [소켓 글]({% post_url 2025-11-04-network-socket-kernel-stack %})의 `SO_RCVBUF`와 같은 것입니다.

## 손실이 끼면 — Mathis 공식

패킷 손실이 있으면 이야기가 더 나빠집니다. AIMD 기반 TCP의 처리량 상한은 근사적으로:

```text
처리량 ≲ (MSS / RTT) × (1 / √p)        (p = 패킷 손실률)
```

손실률 `p`가 처리량을 **제곱근으로** 깎습니다. RTT 100 ms, MSS 1460 B에서 손실 0.01%(p=0.0001)면 상한은 약 117 Mbps지만, 손실이 1%로 오르면 같은 식이 **약 12 Mbps**로 떨어집니다. **고RTT 경로에서 약간의 손실이 처리량을 붕괴**시키는 이유입니다 — 그래서 장거리 전송에선 손실률 0.01%도 큰 문제입니다.

| 양 | 정의 | 키우면/줄이면 | 측정 |
|----|------|-------------|------|
| 대역폭 | 단위시간 비트(bps) | 처리량 상한↑ | `iperf3 -c` |
| RTT | 왕복 시간 | 작을수록 처리량↑·반응성↑ | `ping`, `ss -i`(rtt) |
| BDP | 대역폭×RTT | 필요한 윈도우 크기 | 계산 |
| 윈도우 | ACK 없이 보낼 양 | ≥BDP라야 파이프 채움 | `ss -i`(cwnd, wscale) |
| 손실률 p | drop 비율 | √p로 처리량 깎임 | `ss -i`(retrans), `mtr` |
| 지터 | RTT 변동 | 작을수록 실시간 품질↑ | `ping`, `iperf3 -u` |

## 버퍼블로트 — 큐가 너무 커서 생기는 지연

직관과 반대로, **라우터 버퍼가 너무 크면** 성능이 나빠집니다. 큐에 패킷이 잔뜩 쌓여도 drop이 안 나니 TCP가 혼잡을 늦게 알아채고, 그 사이 큐 대기 시간이 수백 ms~초로 폭증합니다 — **버퍼블로트(bufferbloat)**. 다운로드 중에 화상통화가 끊기는 전형적 원인입니다. 해법은 **AQM**(CoDel·FQ-CoDel·CAKE)으로, 큐가 오래 머문 패킷을 일찍 떨궈 지연을 낮춥니다.

## 측정 도구 — 추측 금지

```bash
ping -c 20 host                 # RTT 평균/최소/최대 + 지터(mdev)
mtr --report --report-cycles 50 host   # 홉별 손실률·RTT (traceroute+ping)
iperf3 -c host -t 30            # 실효 처리량(TCP), -u로 UDP 지터/손실
iperf3 -c host -P 8             # 병렬 8스트림 — 단일 윈도우 병목 우회 확인
ss -tin dst host                # cwnd, rtt, retrans, wscale 실시간
tcpdump -i eth0 -w cap.pcap     # 재전송·중복 ACK를 패킷 수준에서
```

> **진단 사고법**: ① `iperf3 -P 1` 처리량이 낮은데 `-P 8`이 빠르면 → **윈도우/BDP 병목**(버퍼 키워라). ② `mtr`에서 특정 홉부터 손실 누적 → 그 구간 혼잡/장애. ③ 다운로드 시 `ping` RTT가 급등 → **버퍼블로트**(AQM 적용).

## traceroute — RTT가 홉마다 쌓인다

`traceroute`는 TTL을 1,2,3…으로 늘려 각 홉이 보내는 ICMP `Time Exceeded`로 경로와 누적 RTT를 그립니다. 아래는 프로브가 한 홉씩 더 멀리 가며 RTT가 누적되는 모습입니다.

<div class="bdp-tr" markdown="0">
<style>
.bdp-tr{margin:1.4rem 0;overflow-x:auto}
.bdp-tr svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.bdp-tr .sub{fill:currentColor;font-size:10px;opacity:.6}
.bdp-tr .hop{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.5}
.bdp-tr .line{stroke:currentColor;opacity:.25;stroke-width:1.4}
.bdp-tr .pr{fill:#1971c2}
.bdp-tr .p1{animation:bdptr 4.5s ease-in-out infinite}
@keyframes bdptr{0%{transform:translateX(0);opacity:0}5%{opacity:1}20%{transform:translateX(150px)}25%{transform:translateX(0)}40%{transform:translateX(300px)}45%{transform:translateX(0)}60%{transform:translateX(450px)}65%{transform:translateX(0)}80%{transform:translateX(600px);opacity:1}90%{opacity:0;transform:translateX(600px)}100%{opacity:0}}
</style>
<svg viewBox="0 0 700 120" role="img" aria-label="traceroute가 TTL을 늘리며 홉마다 더 멀리 프로브를 보내 누적 RTT를 측정하는 애니메이션">
  <line class="line" x1="40" y1="60" x2="660" y2="60"/>
  <circle class="hop" cx="40"  cy="60" r="14"/>
  <circle class="hop" cx="190" cy="60" r="14"/>
  <circle class="hop" cx="340" cy="60" r="14"/>
  <circle class="hop" cx="490" cy="60" r="14"/>
  <circle class="hop" cx="640" cy="60" r="14"/>
  <text class="sub" x="40"  y="96" text-anchor="middle">출발</text>
  <text class="sub" x="190" y="96" text-anchor="middle">홉1 · 2ms</text>
  <text class="sub" x="340" y="96" text-anchor="middle">홉2 · 14ms</text>
  <text class="sub" x="490" y="96" text-anchor="middle">홉3 · 48ms</text>
  <text class="sub" x="640" y="96" text-anchor="middle">목적지 · 92ms</text>
  <rect class="pr p1" x="33" y="53" width="14" height="14" rx="3"/>
</svg>
</div>

## 면접/리뷰 단골 질문

- **Q. 대역폭을 늘렸는데 안 빨라진다. 왜?** → "빠름"이 지연이면 대역폭 무관(거리÷광속). "빠름"이 처리량인데 안 오르면 윈도우<BDP 병목이거나 손실이다.
- **Q. BDP를 한 줄로?** → 대역폭×RTT. 파이프에 떠 있을 수 있는 비트량. 윈도우가 이보다 작으면 파이프를 못 채운다.
- **Q. 처리량 공식은?** → 윈도우 병목 시 윈도우/RTT. 손실 있으면 Mathis로 (MSS/RTT)·(1/√p) 상한. RTT와 손실이 같이 처리량을 누른다.
- **Q. 버퍼가 큰데 왜 느려지나?** → 버퍼블로트. 큰 큐가 drop을 늦춰 혼잡 신호가 늦고 큐 지연이 폭증. AQM(CoDel)으로 해결.
- **Q. 단일 스트림은 느린데 병렬은 빠르다. 진단은?** → 윈도우/BDP 병목. 윈도우 스케일링·버퍼 자동튜닝으로 단일 스트림 윈도우를 키운다.

## 정리

- **대역폭(굵기) ≠ 지연(길이) ≠ 처리량(실제 흐른 양).** 셋을 분리 못 하면 원인을 못 찾는다.
- **BDP = 대역폭 × RTT.** 윈도우가 BDP보다 작으면 파이프가 비어 처리량 = 윈도우/RTT로 묶인다(LFN 함정).
- 손실은 **√p로 처리량을 깎는다**(Mathis). 고RTT에선 작은 손실도 치명적.
- 버퍼는 작아도(채움 부족) 커도(버퍼블로트) 문제다 → 윈도우는 BDP에 맞추고, 큐는 AQM으로.
- **추측 말고 `ping`/`mtr`/`iperf3`/`ss -i`로 측정**하라.

> 이 성능 원리는 [패킷 교환]({% post_url 2023-01-10-network-what-is-packet-switching %})의 4지연에서 출발해, [TCP 혼잡 제어]({% post_url 2024-03-05-network-tcp-flow-congestion-control %})의 cwnd, [소켓 버퍼]({% post_url 2025-11-04-network-socket-kernel-stack %}), 거리를 줄이는 [CDN]({% post_url 2025-05-06-network-proxy-cdn %})과 한 몸으로 묶입니다.

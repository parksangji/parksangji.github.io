/* 네트워크 20편에 SEO meta description 주입 (frontmatter title 다음 줄).
   Chirpy: page.description → <meta name=description> + og:description + JSON-LD description. */
const fs = require('fs');
const path = require('path');
const POSTS = '/Users/sangjipark/qrcode/blog/_posts';

const desc = {
  'network-what-is-packet-switching': '회선 교환과 패킷 교환의 차이, 통계적 다중화로 인터넷이 패킷을 선택한 이유, best-effort 전달과 store-and-forward, 전송·전파·처리·큐 4가지 지연까지 네트워크의 출발점을 정리합니다.',
  'network-osi-tcpip-layers': 'OSI 7계층과 TCP/IP 4계층의 매핑, 캡슐화·역캡슐화 과정, 각 계층의 PDU와 대표 프로토콜, 그리고 네트워크를 굳이 계층으로 나누는 이유(관심사 분리)를 그림과 함께 설명합니다.',
  'network-ethernet-mac-switch': '이더넷 프레임의 비트 구조, MAC 주소 48비트와 OUI, 스위치가 소스 학습과 플러딩으로 MAC 주소 테이블(CAM)을 채우는 원리, 충돌·브로드캐스트 도메인과 VLAN까지 2계층을 다룹니다.',
  'network-ip-addressing-subnetting': 'IPv4·IPv6 주소 체계, 서브넷 마스크와 CIDR(/24, /26) 표기, 서브넷팅 계산(네트워크·브로드캐스트·가용 호스트 수), 사설망 대역과 마스크 AND 연산을 비트 단위로 설명합니다.',
  'network-routing-bgp': '라우팅 테이블 구조와 Longest Prefix Match, 홉바이홉 포워딩, 정적·동적 라우팅, IGP(OSPF)와 EGP(BGP)의 차이, AS 경로 속성과 라우팅 정책까지 인터넷이 길을 찾는 방법을 정리합니다.',
  'network-arp-l2-l3': '같은 서브넷과 다른 서브넷 통신의 차이, ARP가 IP를 MAC으로 해석하는 과정(브로드캐스트→유니캐스트), ARP 캐시와 스푸핑, L2/L3 경계에서 목적지 MAC만 홉마다 바뀌는 원리를 설명합니다.',
  'network-tcp-handshake-state': 'TCP 3-way handshake가 왜 3번인지, SYN·ACK와 시퀀스 번호, 4-way 종료와 TIME_WAIT(2MSL), TCP 상태 머신, 순서번호·재전송으로 신뢰성을 만드는 방법, SYN flood 대응까지 다룹니다.',
  'network-tcp-flow-congestion-control': '흐름 제어(rwnd)와 혼잡 제어(cwnd)의 차이, 슬로스타트·혼잡 회피의 AIMD 톱니파, 손실 감지(타임아웃·3 dup ACK), Reno·CUBIC·BBR, 버퍼블로트와 BDP를 그림으로 설명합니다.',
  'network-udp-quic': 'UDP를 쓰는 이유와 8바이트 헤더, TCP의 HOL blocking 문제, QUIC이 UDP 위에서 TLS 1.3 통합·0-RTT·스트림 독립·연결 이동성으로 TCP를 넘어서는 방법(HTTP/3)을 설명합니다.',
  'network-dns': 'DNS 재귀·반복 질의로 루트→TLD→권한 서버를 따라가는 과정, A·CNAME·MX 등 레코드, 캐시와 TTL, GeoDNS·가중치 라우팅(Route 53), DoH·DoT까지 이름이 IP로 바뀌는 원리를 정리합니다.',
  'network-http-evolution': 'HTTP/1.1의 직렬 처리와 HOL blocking, HTTP/2의 스트림 멀티플렉싱·HPACK, TCP 레벨 HOL의 한계, HTTP/3(QUIC)가 전송 계층을 바꿔 이를 해결하는 과정을 비교합니다.',
  'network-tls-https': 'TLS/HTTPS 핸드셰이크(TLS 1.3 1-RTT·0-RTT), 비대칭으로 대칭키를 합의하는 원리, 인증서 체인과 CA 신뢰, forward secrecy, SNI·ALPN, mTLS까지 암호화 채널의 작동을 설명합니다.',
  'network-nat': 'NAT가 IPv4 고갈을 푸는 방법, NAPT 포트 다중화 변환 테이블, NAT 종류(full-cone·symmetric), 포트포워딩과 홀펀칭(STUN·TURN), conntrack, AWS NAT Gateway까지 사설망 통신을 다룹니다.',
  'network-load-balancing': 'L4와 L7 로드 밸런싱의 차이, 라운드로빈·least-conn·일관 해시 알고리즘, 헬스체크와 연결 드레이닝, 세션 고정, AWS ALB·NLB 매핑까지 트래픽 분산을 정리합니다.',
  'network-proxy-cdn': '포워드 프록시와 리버스 프록시의 차이, HTTP 캐싱(Cache-Control·ETag), CDN 엣지 캐싱과 Anycast로 가장 가까운 PoP 라우팅, origin shielding과 캐시 무효화(CloudFront)를 설명합니다.',
  'network-firewall-security-group': 'stateful과 stateless 방화벽의 차이, netfilter·iptables 체인, AWS 보안그룹(stateful·allow)과 네트워크 ACL(stateless·순서 평가)의 비교, 최소 권한과 ephemeral 포트 함정을 다룹니다.',
  'network-vpc-cloud': 'AWS VPC 구성요소 — CIDR·서브넷(퍼블릭·프라이빗)·라우팅 테이블·IGW·NAT GW, 가용영역 분산, VPC 피어링과 Transit Gateway, 엔드포인트(PrivateLink)까지 클라우드 네트워킹을 정리합니다.',
  'network-socket-kernel-stack': 'BSD 소켓 API 흐름, 블로킹과 논블로킹, select·poll·epoll의 차이와 C10K 문제, 커널 수신 경로(NIC→sk_buff→소켓 버퍼), zero-copy와 SO_REUSEPORT까지 시스템 레벨을 다룹니다.',
  'network-performance-bdp': '대역폭과 지연·RTT의 차이(파이프 굵기 vs 길이), BDP=대역폭×RTT, 윈도우와 처리량의 관계, Mathis 공식, 버퍼블로트, iperf3·traceroute·mtr 측정까지 네트워크 성능을 분석합니다.',
  'network-modern-service-mesh-ebpf': '서비스 메시(Envoy 사이드카)의 mTLS·재시도·관측, 데이터·컨트롤 플레인, eBPF·XDP로 커널에서 패킷을 처리하는 Cilium, gRPC, zero trust까지 현대 네트워킹을 정리합니다.',
};

function findPost(slug){
  const f = fs.readdirSync(POSTS).find(n=>/^\d{4}-\d{2}-\d{2}-/.test(n) && n.endsWith('-'+slug+'.md'));
  return f ? path.join(POSTS,f) : null;
}

let n=0;
for(const [slug,d] of Object.entries(desc)){
  const file = findPost(slug);
  if(!file){ console.log('POST 없음:', slug); continue; }
  let txt = fs.readFileSync(file,'utf8');
  if(/^description:/m.test(txt)){ console.log('이미 있음:', slug); continue; }
  const lines = txt.split('\n');
  const ti = lines.findIndex(l=>/^title:/.test(l));
  if(ti<0){ console.log('title 없음:', slug); continue; }
  lines.splice(ti+1, 0, `description: "${d}"`);
  fs.writeFileSync(file, lines.join('\n'));
  console.log('OK', slug, `(${d.length}자)`);
  n++;
}
console.log('완료:', n, '편');

---
title: DNS (Domain Name System)
category: Network
layout: note
---

DNS는 사람이 읽기 쉬운 도메인 이름을 컴퓨터가 통신할 때 사용하는 IP주소 (예: 172.217.160.142)로 변환해주는 시스템이다. 웹사이트 이름과 해당 서버의 IP 주소를 매핑하여 사용자가 복잡한 IP 주소를 외울 필요 없이 웹 사이트에 쉽게 접근할 수 있다. 

DNS 동작 방식 (계층 구조 및 질의 과정):
DNS는 전 세계적으로 분산된 계층적인 데이터베이스 시스템이다. 

1. DNS 계층 구조:
	 - 루트 DNS 서버: 전 세계에 13개가 있으며, 최상위 도메인 서버의 주소를 관리한다.
	 - 최상위 도메인 서버(Top-Level Domain Server):`.com`, `.org`, `.net`, `.kr` 등과 같은 TLD를 관리하며, 해당 TLD에 속한 도메인의 네임 서버 주소를 알려준다.
	 - 권한 있는 네임 서버(Authoritative Name Server): 특정 도메인(google.com)에 대한 실제 IP 주소 정보를 가지고 있는 최종 서버이다. 
2. DNS 질의 과정(일반적인 재귀적 질의):
	- Local DNS 서버에 요청: 사용자가 웹 브라우저에 www.google.com 을 입력하면, PC는 먼저 설정된 로컬 DNS 서버에게 해당 도메인의 IP주소를 요청한다. 로컬 DNS 서버는 캐시된 정보가 있으면 바로 응답한다. 
	- Root DNS 서버에 요청: 로컬 DNS 서버에 캐시된 정보가 없으면, 루트 DNS 서버에 www.google.com 의 IP 주소를 지의한다.
	- TLD 서버에 요청: 루트 DNS 서버는 .com TLD 서버의 주소를 알려준다. 로컬 DNS 서버는 이 정보를 받아. `.com` TLD 서버에 www.google.com 의 IP 주소를 지의한다. 
	- Authoritative 네임 서버에 요청: `.com` TLD 서버는 google.com 도메인을 관리하는 권한 있는 네임 서버의 주소를 알려준다. 로컬 DNS 서버는 이 정보를 받아 google.com의 권한 있는 네임 서버에 www.google.com 의 IP 주소를 질의 한다.
	- IP 주소 응답: 권한 있는 네임 서버는 www.google.com 의 실제 IP 주소를 로컬 DNS 서버에 응답한다. 
	- 최종 응답: 로컬 DNS 서버는 응답받은 IP 주소를 PC(웹 브라우저)에게 전달하고, 해당 정보를 캐싱한다. 브라우저는 이 IP 주소를 사용하여 www.google.com 웹 서버에 접속한다. 
	- `참고`: 위 과정은 로컬 DNS 서버가 사용자들 대신해 여러 서버에 질의하는 재귀적 질의(Recursive Query) 방식이다. 로컬 DNS 서버가 다른 DNS 서버들에게 질의하는 과정은 반복적 질의로 이루어진다. 
	- ![[Pasted image 20250408154318.png]]

주요 DNS 레코드 타입:
	- A 레코드: 도메인 이름을 IPv4 주소에 매핑한다.
	- AAAA 레코드: 도메인 이름을 IPv6 주소에 매핑한다.
	- CNAME 레코드: 하나의 도메인 이름을 다른 도메인 이름으로 매핑한다.
	- MX 레코드: 도메인의 이메일을 처리하는 메일 서버를 지정한다. (mail.example.com)
	- NS 레코드: 도메인을 관리하는 권한 있는 네임 서버를 지정한다. 

DNS 캐싱:
DNS 조회 속도를 높이기 위해 여러 단계에서 DNS 정보가 캐싱된다.
	- 브라우저 캐시: 웹 브라우저 자체에 DNS 정보가 캐싱된다.
	- 운영체제 캐시: 운영체제 수준에서 DNS 정보가 캐싱된다.
	- 로컬 DNS 서버 캐시: ISP의 로컬 DNS 서버에 DNS 정보가 캐싱된다. 

---
title: HTTP (HyperText Transfer Protocol)
category: Network
layout: note
---

웹 브라우저와 웹 서버 간에 데이터를 주고 받기 위한 요청/응답 프로토콜이다. 
- 비상태성(stateless): 각 요청은 독립적으로 처리되며, 이전 요청의 상태를 기억하지 않는다. (상태 유지를 위해 쿠키, 세션 등 사용)
- 연결 지향 (Connection-Oriented  TCP 기반): 일반적으로 신뢰성 있는 TCP 연결 위에서 동작한다. 
- 요청 메서드: GET, POST, PUT, DELETE 등
- 상태 코드: 200, 404, 500 등 서버 응답 상태를 나타낸다. 

| 특징               | HTTP/1.1     | HTTP/2          | HTTP/3 (QUIC)     |
| :--------------- | :----------- | :-------------- | :---------------- |
| **전송 계층**        | TCP          | TCP             | UDP (QUIC)        |
| **포맷**           | 텍스트          | 바이너리            | 바이너리              |
| **멀티플렉싱**        | 파이프라이닝 (제한적) | 가능 (단일 TCP 연결)  | 가능 (QUIC 스트림)     |
| **HOL Blocking** | 연결 레벨        | 스트림 레벨 (TCP 한계) | 스트림 레벨 (TCP 아님)   |
| **헤더 압축**        | 없음           | HPACK           | QPACK             |
| **암호화**          | 선택 (HTTPS)   | 사실상 필수 (TLS)    | 필수 (내장)           |
| **연결 설정**        | TCP + TLS    | TCP + TLS       | 더 빠름 (QUIC 핸드셰이크) |
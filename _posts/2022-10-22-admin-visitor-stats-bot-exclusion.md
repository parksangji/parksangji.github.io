---
title: "방문 통계에서 봇과 내부 계정을 걷어내기"
date: 2022-10-22 10:30:00 +0900
categories: [Database]
tags: [analytics, bot-filtering, stats, ip-grouping, data-quality, admin]
description: "운영 대시보드의 방문 통계가 거짓말하는 이유는 봇·내부 계정·중복 IP 때문이다. 집계 단계에서 노이즈를 제거해 진짜 사용자를 추리는 데이터 정제."
---

운영 대시보드의 방문 수가 실제 체감보다 부풀어 있다면, 십중팔구 데이터가 거짓말을 하는 게 아니라 **노이즈가 섞여 있는 것**이다. 크롤러봇, 사내 임직원 접속, 같은 사용자의 중복 IP — 이 셋만 걷어내도 수치의 신뢰도가 달라진다. 통계는 "얼마나 많이 모았느냐"가 아니라 "무엇을 세지 않았느냐"로 결정된다.

## 집계 전 필터링 vs 집계 후 보정

노이즈 제거에는 두 지점이 있다.

- **집계 전 필터링** — 봇·내부 계정처럼 "애초에 사용자가 아닌" 행은 `WHERE`에서 거른 뒤 센다. 정의가 명확한 노이즈는 여기서 잘라야 한다.
- **집계 후 보정** — 중복 IP처럼 "사용자이긴 하나 중복인" 경우는 그룹핑/`DISTINCT`로 묶어 마지막에 정리한다.

봇 판별은 보통 User-Agent 패턴과 알려진 크롤러 IP 대역으로 한다.

```sql
SELECT COUNT(*) AS real_visits
FROM visit_log v
WHERE v.created_at >= ? AND v.created_at < ?
  AND v.user_agent NOT LIKE '%bot%'
  AND v.user_agent NOT LIKE '%crawler%'
  AND v.user_id NOT IN (SELECT user_id FROM internal_account)
  AND v.ip NOT IN (SELECT ip FROM bot_ip_range);
```

## IP 기준 그룹핑으로 중복 제거

"방문 수"와 "방문자 수"는 다르다. 같은 사람이 10번 새로고침하면 방문은 10, 방문자는 1이다. 순 방문자는 식별 키로 묶는다.

```sql
SELECT COUNT(DISTINCT v.ip) AS unique_visitors
FROM visit_log v
WHERE v.created_at >= ? AND v.created_at < ?
  AND v.user_agent NOT LIKE '%bot%';
```

로그인 사용자는 `user_id`가 더 정확하고, 비로그인은 IP가 차선책이다. 둘을 섞어 세려면 `COALESCE(user_id, ip)` 같은 식별 키를 만들어 `DISTINCT`한다.

## 사용자/비사용자 분리 카운트

한 쿼리에서 "진짜 사용자"와 "걸러낸 노이즈"를 동시에 보면 정제가 잘 됐는지 검증할 수 있다. 조건부 카운트가 유용하다.

```sql
SELECT
  SUM(CASE WHEN user_agent NOT LIKE '%bot%' THEN 1 ELSE 0 END) AS human_visits,
  SUM(CASE WHEN user_agent     LIKE '%bot%' THEN 1 ELSE 0 END) AS bot_visits
FROM visit_log
WHERE created_at >= ? AND created_at < ?;
```

봇 비중이 갑자기 튀면 크롤링 폭주나 어뷰징 신호다 — 노이즈를 버리되 그 양은 따로 관측하는 게 운영의 기본이다.

## 운영 함정

- **`LIKE '%bot%'`의 한계** — User-Agent는 위조 가능하고 패턴은 끝없이 늘어난다. 블랙리스트는 완벽하지 않으니, 명백한 것만 거르고 "정의가 명확한 노이즈만 집계 전에" 자른다는 원칙을 지킨다.
- **필터를 코드 곳곳에 흩뿌리지 마라** — 같은 제외 조건이 화면마다 제각각이면 수치가 화면마다 달라진다. 정제 로직은 뷰나 공통 쿼리로 한곳에 모은다.

## 핵심 요약

- 통계 신뢰도는 "무엇을 세지 않았느냐"가 좌우한다.
- 정의가 명확한 노이즈(봇·내부 계정)는 집계 전 `WHERE`, 중복(IP)은 `COUNT(DISTINCT)`로 집계 후 정리.
- 노이즈는 버리되 그 양은 따로 세어 관측한다.

> **면접 한 줄**: "방문 수와 순 방문자 수의 차이를 한 쿼리로?" → `COUNT(*)`와 `COUNT(DISTINCT 식별키)`를 나란히 SELECT한다.

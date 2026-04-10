---
title: "LIMIT에 들어가는 값의 타입을 의심하라"
date: 2026-04-10 10:30:00 +0900
categories: [Database]
tags: [sql, pagination, type-binding, prepared-statement, casting]
description: "LIMIT/OFFSET·DATE 파라미터의 타입 바인딩 오류와 안전한 캐스팅·방어를 다룬다."
---

## 숫자처럼 보이지만 문자열인 값

페이징 파라미터는 보통 쿼리스트링에서 들어온다. `?page=2&size=20`은 문자열이다. 이게 적절히 정수로 변환되지 않은 채 SQL `LIMIT`/`OFFSET`에 닿으면, DB는 타입 불일치로 에러를 내거나 예상 못 한 캐스팅을 한다.

## LIMIT/OFFSET은 바인드 대상이 까다롭다

대부분의 DB는 `LIMIT ?`에 정수 바인드를 허용하지만, 드라이버·방언에 따라 문자열 바인딩이 캐스팅 오류를 낸다. 안전한 방법은 **애플리케이션 계층에서 정수로 파싱·검증한 뒤** 바인딩하는 것이다.

```java
int size = Math.min(Math.max(parseIntOr(req.size(), 20), 1), 100); // 1..100 클램프
long offset = Math.max((long)(page - 1) * size, 0);                // 음수 방지
```

```sql
SELECT * FROM orders ORDER BY id DESC LIMIT #{size} OFFSET #{offset}
```

## DATE/타임스탬프 경계 바인딩

날짜 범위 조회에서 문자열 `"2026-04-10"`을 그대로 비교하면, 컬럼이 `timestamp`일 때 암묵 캐스팅이 일어나거나 경계(그날 23:59:59)가 누락된다. **반열림 구간**(`>= 시작 AND < 다음날`)으로 바인딩하고, 파라미터는 명시적 날짜/시각 타입으로 넘긴다.

```sql
WHERE created_at >= #{from} AND created_at < #{toExclusive}
```

## 운영 함정

- **음수·과대 OFFSET**: 검증 없이 받으면 `OFFSET -1`이 에러를, 거대한 OFFSET이 풀스캔+버림으로 느려진다. 클램프하거나 keyset 페이징으로 전환한다.
- **문자열 정렬 키**: 숫자를 문자열 컬럼에 저장하면 `"10" < "9"`가 된다 — 정렬·범위가 직관과 어긋난다.

## 핵심 요약

페이징·날짜 파라미터는 "DB에 닿기 전에 타입을 확정·검증·클램프"하는 게 정답이다. LIMIT/OFFSET은 정수로, 날짜는 반열림 구간과 명시적 타입으로 바인딩한다.

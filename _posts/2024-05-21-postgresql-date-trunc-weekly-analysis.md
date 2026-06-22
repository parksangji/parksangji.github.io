---
title: "주 단위 데이터 분석, DATE_TRUNC로 해결하기"
date: 2024-05-21 14:00:00 +0900
categories: [Database, PostgreSQL]
tags: [postgresql, date_trunc, aggregation, analytics]
---

## 일 단위는 되는데 주 단위가 안 된다

대시보드 작업을 하다가 "이번 주, 저번 주 가입자 수 추이"를 보여줘야 하는 상황이 있었습니다. 일 단위 집계는 `GROUP BY created_at::date`로 간단했는데, **주 단위**가 문제였습니다. 처음엔 애플리케이션 코드에서 날짜를 받아 직접 주차를 계산해서 그룹핑했는데, 코드가 지저분해지고 경계 처리에서 버그가 자꾸 났습니다. 😅

그러다 PostgreSQL의 `DATE_TRUNC`를 알게 되면서 깔끔하게 해결됐습니다.

## DATE_TRUNC가 하는 일

`DATE_TRUNC(field, source)`는 날짜/시간 값을 지정한 단위로 **잘라서(버려서)** 그 단위의 시작 시점으로 맞춰줍니다. 소수점을 버리는 것과 비슷하다고 보면 됩니다.

```sql
SELECT DATE_TRUNC('week',  TIMESTAMP '2024-05-22 13:45:21'); -- 2024-05-20 00:00:00 (월요일)
SELECT DATE_TRUNC('month', TIMESTAMP '2024-05-22 13:45:21'); -- 2024-05-01 00:00:00
SELECT DATE_TRUNC('day',   TIMESTAMP '2024-05-22 13:45:21'); -- 2024-05-22 00:00:00
```

여기서 중요한 포인트: PostgreSQL에서 **주의 시작은 월요일(ISO 8601 기준)** 입니다. 일요일 시작에 익숙하다면 한 번 헷갈릴 수 있는 부분이에요.

## 주 단위 집계 쿼리

가입 테이블이 있다고 하면, 주별 가입자 수는 이렇게 뽑습니다.

```sql
SELECT
    DATE_TRUNC('week', created_at) AS week_start,
    COUNT(*)                       AS signup_count
FROM users
WHERE created_at >= '2024-01-01'
GROUP BY week_start
ORDER BY week_start;
```

`week_start`가 각 주의 월요일 00:00:00으로 떨어지기 때문에, 같은 주에 속한 데이터끼리 자동으로 묶입니다.

## 데이터가 없는 주는 어떻게?

집계를 하다 보면 "가입이 0명인 주"는 결과에서 아예 빠져버립니다. 그래프에 구멍이 생기는 거죠. 이럴 땐 `generate_series`로 주 단위 달력을 만들어 `LEFT JOIN` 하면 깔끔합니다.

```sql
SELECT
    w.week_start,
    COUNT(u.id) AS signup_count
FROM generate_series(
        DATE_TRUNC('week', TIMESTAMP '2024-01-01'),
        DATE_TRUNC('week', NOW()),
        INTERVAL '1 week'
     ) AS w(week_start)
LEFT JOIN users u
       ON DATE_TRUNC('week', u.created_at) = w.week_start
GROUP BY w.week_start
ORDER BY w.week_start;
```

이러면 가입이 없던 주도 `signup_count = 0`으로 빠짐없이 나옵니다.

## 타임존을 조심하자

`created_at`이 `timestamptz`라면 집계 결과가 **서버/세션 타임존**에 따라 달라질 수 있습니다. 한국 기준으로 묶고 싶다면 자르기 전에 타임존을 명시하는 게 안전합니다.

```sql
SELECT
    DATE_TRUNC('week', created_at AT TIME ZONE 'Asia/Seoul') AS week_start,
    COUNT(*)
FROM users
GROUP BY week_start
ORDER BY week_start;
```

특히 UTC로 저장된 데이터를 그냥 자르면, 한국 시간으로 월요일 오전에 들어온 데이터가 전 주로 묶이는 오묘한 버그가 생길 수 있어요.

## 정리

- 주/월/분기 단위 집계는 애플리케이션에서 계산하지 말고 `DATE_TRUNC`로 DB에 맡기는 게 깔끔하고 정확합니다.
- PostgreSQL의 주 시작은 **월요일**.
- 빈 구간을 채우려면 `generate_series` + `LEFT JOIN`.
- `timestamptz`는 자르기 전에 `AT TIME ZONE`으로 기준 타임존을 못 박아 두세요.

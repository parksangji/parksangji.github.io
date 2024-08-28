---
title: "대소문자를 가리지 않는 검색의 비용 — collation과 함수 인덱스"
date: 2024-08-28 10:30:00 +0900
categories: [Database]
tags: [case-insensitive, collation, functional-index, search, postgresql]
description: "대소문자 구분 없는 검색을 인덱스를 살린 채 구현하는 법. LOWER() 양변 적용이 인덱스를 깨는 문제와 함수 기반 인덱스·CI collation·citext의 트레이드오프."
---

그 주의 작업은 "검색어 대소문자를 무시하고 매칭되게 해달라"는 단순해 보이는 요구에서 출발했다. 사용자는 `john`을 쳐도 `John`, `JOHN`이 다 나오길 기대한다. 애플리케이션에서 검색어를 정규화하던 이전 접근(입력을 소문자로 통일)과 달리, 이번엔 **DB 컬럼 자체의 데이터가 섞여 있어** DB 레벨에서 풀어야 했다. 그리고 여기엔 흔한 함정이 있다. **`LOWER()`를 무심코 쓰면 인덱스가 통째로 죽는다.**

## 핵심: 왜 LOWER() 양변이 인덱스를 깨는가

B-tree 인덱스는 컬럼의 **원본 값**을 키 순서대로 정렬해 저장한다. 그래서 `WHERE name = 'John'`은 인덱스를 탄다. 그런데 대소문자를 무시하려고 이렇게 쓰면

```sql
SELECT * FROM users WHERE LOWER(name) = LOWER('john');
```

옵티마이저 입장에서 `LOWER(name)`은 **컬럼이 아니라 컬럼에 함수를 씌운 표현식**이다. 인덱스에는 `name`의 원본값만 정렬돼 있을 뿐 `LOWER(name)`의 정렬 정보는 없다. 따라서 모든 행을 읽어 `LOWER`를 계산하며 비교하는 풀스캔으로 떨어진다. 이게 "검색은 되는데 느려졌다"의 전형이다.

처방은 세 갈래다.

### (1) 함수 기반 인덱스

표현식 자체를 인덱스로 만든다. `LOWER(name)`의 정렬 정보를 디스크에 따로 만들어 두는 것이다.

```sql
-- 표현식 인덱스: LOWER(name)을 키로 정렬해 저장
CREATE INDEX idx_users_lower_name ON users (LOWER(name));

-- 이제 이 쿼리는 인덱스를 탄다 (쿼리의 LOWER가 인덱스 정의와 일치해야 함)
SELECT * FROM users WHERE LOWER(name) = 'john';
```

핵심 규칙: **쿼리에 쓴 표현식과 인덱스 정의 표현식이 정확히 같아야** 한다. 인덱스는 `LOWER(name)`인데 쿼리는 `LOWER(name) = LOWER('John')` 식으로 우변에도 함수를 쓰면 좌변은 매칭되니 동작은 한다. 하지만 우변은 상수로 미리 소문자화해 넘기는 게 명료하다.

### (2) 대소문자 무시 collation (CI)

collation은 문자열의 **정렬·비교 규칙**이다. 대소문자 무시(case-insensitive) collation을 컬럼에 지정하면 `=` 비교 자체가 대소문자를 안 가린다. PostgreSQL 12+는 ICU 기반 non-deterministic collation으로 이를 지원한다.

```sql
CREATE COLLATION ci (provider = icu, locale = 'und-u-ks-level2', deterministic = false);

CREATE TABLE users (
    id   bigint PRIMARY KEY,
    name text COLLATE ci   -- 이 컬럼의 비교는 대소문자 무시
);

-- LOWER 없이도 대소문자 무시 매칭, 일반 인덱스가 그대로 동작
SELECT * FROM users WHERE name = 'john';
```

장점은 쿼리가 깨끗하고 모든 비교에 일관되게 적용된다는 것. 단, non-deterministic collation은 `LIKE`·패턴 인덱스와 제약이 있어 주의가 필요하다.

### (3) citext

PostgreSQL의 `citext` 확장은 "대소문자 무시 텍스트 타입"이다. 컬럼 타입을 `citext`로 바꾸면 비교가 자동으로 대소문자를 무시한다. 가장 쓰기 편하지만, 내부적으로 비교 때마다 폴딩 비용이 들고 타입 전파가 까다로울 수 있다.

## 트레이드오프 정리

| 방법 | 쿼리 가독성 | 인덱스 | 주의점 |
|------|------------|--------|--------|
| 함수 인덱스 | 중간(LOWER 명시) | 별도 표현식 인덱스 | 쿼리·인덱스 표현식 일치 필수 |
| CI collation | 좋음 | 일반 인덱스 활용 | LIKE/패턴 제약 |
| citext | 좋음 | 일반 인덱스 활용 | 폴딩 비용·타입 전파 |

## 운영 함정

**함정 1 — 다국어 대소문자 매핑.** 대소문자 폴딩은 영어만의 문제가 아니다. 터키어 점 없는 i(`ı`/`I`), 독일어 `ß`↔`SS` 같은 케이스에서 단순 `LOWER`는 로케일에 따라 결과가 달라진다. locale을 명시하지 않으면 DB 서버의 기본 로케일에 의존해 환경마다 검색 결과가 미묘하게 갈린다. ICU collation에 명시적 로케일을 주는 이유다.

**함정 2 — 부분 일치(LIKE)와의 충돌.** 대소문자 무시 + 부분 일치(`LIKE '%john%'`)를 함께 원하면, non-deterministic collation은 패턴 매칭에 제약이 걸린다. 이 경우 `LOWER(name) LIKE LOWER('%john%')` + `LOWER(name)`에 대한 trigram(`pg_trgm`) 인덱스 조합이 현실적인 해법이다.

## 핵심 요약

- `LOWER()` 양변 비교는 컬럼이 아닌 **표현식**이라 일반 인덱스를 못 탄다.
- 표현식을 그대로 인덱싱하는 **함수 기반 인덱스**, 또는 비교 규칙 자체를 바꾸는 **CI collation/citext**가 정답.
- 다국어·LIKE가 섞이면 **로케일 명시**와 **trigram 인덱스**까지 고려해야 한다.

> **면접 한 줄 Q&A**
> Q. `WHERE LOWER(col)=?`가 느린데 인덱스는 있다. 왜인가?
> A. 인덱스는 `col` 원본을 정렬해 저장한다. `LOWER(col)`은 별개 표현식이라 그 인덱스를 못 탄다. `LOWER(col)`에 대한 함수 기반 인덱스를 만들어야 한다.

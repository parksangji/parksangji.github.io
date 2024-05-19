---
title: "IN 절에 리스트를 넘길 때 생기는 일"
date: 2024-05-19 10:30:00 +0900
categories: [Database]
tags: [mybatis, in-clause, foreach, bind-variable, plan-cache]
description: "MyBatis foreach로 IN 절을 만들 때 바인드 변수 개수가 매번 달라져 실행계획 캐시가 깨지는 문제와, 개수 상한·임시테이블 대안."
---

ID 리스트로 여러 행을 한 번에 조회하는 작업을 한 적이 있다. MyBatis에서 `foreach`로 `IN` 절을 만드는 건 흔한 패턴인데, 무심코 쓰면 **DB의 실행계획 캐시를 조용히 망가뜨린다**.

## foreach가 만드는 SQL

```xml
<select id="findByIds" resultType="Order">
  SELECT * FROM orders
  WHERE id IN
  <foreach item="id" collection="ids" open="(" separator="," close=")">
    #{id}
  </foreach>
</select>
```

`ids`가 3개면 `IN (?, ?, ?)`, 5개면 `IN (?, ?, ?, ?, ?)`가 생성된다. `#{}`는 바인드 변수(`?`)를 쓰므로 SQL 인젝션은 안전하다. 문제는 **바인드 변수 개수가 리스트 길이마다 달라진다**는 점이다.

## 왜 실행계획 캐시가 깨지는가

DB는 같은 SQL 텍스트가 또 들어오면 파싱·최적화 결과(실행계획)를 재사용한다. 이 재사용의 키는 보통 **정규화된 SQL 문자열**이다. 그런데 IN 절의 `?` 개수가 매번 다르면 SQL 문자열 자체가 달라진다.

```
IN (?)
IN (?, ?)
IN (?, ?, ?)
...
```

DB 입장에서 이건 전부 *다른 쿼리*다. 그래서:

- 매 호출마다 **하드 파싱(hard parse)** 이 발생해 CPU·래치 경합이 늘고,
- 계획 캐시(Oracle의 shared pool, MySQL의 prepared statement 캐시 등)가 **유사한 쿼리 변종으로 가득 차** 다른 쿼리의 계획까지 밀려난다.

ID 1개~수백 개가 무작위로 들어오면 수백 종의 변종이 캐시를 오염시킨다. 길이가 다양할수록 더 심하다.

## 완화 전략

**1) 개수를 버킷으로 묶어 패딩한다.** 길이를 10·50·100 같은 고정 버킷으로 올림하고, 모자란 자리는 첫 값으로 채운다. SQL 변종 수가 버킷 수로 제한된다.

```java
int bucket = nextBucket(ids.size());     // 7 -> 10
List<Long> padded = new ArrayList<>(ids);
while (padded.size() < bucket) padded.add(ids.get(0)); // IN은 중복 무해
```

**2) 임시 테이블/조인으로 바꾼다.** ID가 수백~수천 개면 IN 대신 ID를 임시 테이블에 적재하고 조인한다. SQL 텍스트가 고정되고 옵티마이저가 조인으로 다룬다.

```sql
CREATE TEMPORARY TABLE tmp_ids (id BIGINT PRIMARY KEY);
-- batch insert into tmp_ids ...
SELECT o.* FROM orders o JOIN tmp_ids t ON o.id = t.id;
```

**3) 개수 상한을 둔다.** IN 절 항목이 수천 개면 일부 DB는 한계(예: Oracle의 1000개 제한)에 걸리거나 파싱이 폭발한다. 입력을 청크로 쪼개 N개씩 나눠 조회한다.

## 운영 함정

**IN 절은 결과 순서를 보장하지 않는다.** `IN (3,1,2)`로 넣어도 DB는 임의 순서로 돌려준다. 입력 순서를 지켜야 하면 애플리케이션에서 다시 정렬하거나 `ORDER BY FIELD(id, ...)` 같은 명시 정렬을 쓴다.

**대량 IN은 인덱스를 못 탈 수 있다.** 옵티마이저가 항목이 너무 많다고 판단하면 인덱스 대신 풀스캔을 고른다. 이 경우 임시테이블 조인이 더 안정적인 계획을 만든다.

## 핵심 요약

- `foreach` IN은 안전하지만 `?` 개수가 가변이라 SQL 텍스트가 매번 달라져 계획 캐시를 오염시킨다.
- 버킷 패딩으로 변종 수를 줄이거나, 대량이면 임시테이블 조인으로 전환한다.
- IN은 순서를 보장하지 않고, 항목이 많으면 한계·풀스캔을 주의한다.

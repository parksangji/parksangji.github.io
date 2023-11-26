---
title: "깊은 페이지에서 느려지는 진짜 이유와 keyset 페이징"
date: 2023-11-26 10:30:00 +0900
categories: [Database]
tags: [pagination, keyset, seek-method, index, performance]
description: "OFFSET이 깊어질수록 느려지는 원리와 정렬키+PK 복합 인덱스를 이용한 keyset(seek) 페이징 설계."
---

목록의 페이지 이동 성능을 손본 주가 있었다. 1페이지는 빠른데 500페이지로 갈수록 느려진다는 문제였다. 원인은 흔히 오해받는다. "데이터가 많아서"가 아니다. **OFFSET 방식이 버리는 행을 전부 읽기 때문**이다.

## OFFSET이 느린 이유

`LIMIT 20 OFFSET 10000`은 DB에게 "조건에 맞는 행을 정렬 순서대로 10,020개 만들어낸 뒤, 앞의 10,000개를 버리고 20개만 줘"라는 뜻이다. DB는 OFFSET만큼을 **건너뛰는 게 아니라 실제로 읽어서 세어야** 한다. 인덱스를 타더라도 10,000개의 인덱스 엔트리(때로는 테이블 행까지)를 스캔한다. 페이지가 깊어질수록 읽고 버리는 행이 선형으로 늘어난다. O(offset + limit)인 셈이다.

```mermaid
graph LR
    A["정렬된 인덱스"] -->|"앞 10000행 읽고 버림"| B["다음 20행"]
    B --> C["응답"]
    style B fill:#cde
```

## keyset(seek) 페이징의 원리

해법은 "몇 번째부터"가 아니라 **"어떤 값 다음부터"**로 묻는 것이다. 마지막으로 본 행의 정렬 키 값을 커서로 넘기고, 그보다 큰(작은) 행을 인덱스에서 곧장 찾는다.

```sql
-- offset 방식: 깊을수록 느림
SELECT * FROM orders
ORDER BY created_at DESC, id DESC
LIMIT 20 OFFSET 10000;

-- keyset 방식: 어느 페이지든 일정
SELECT * FROM orders
WHERE (created_at, id) < (:lastCreatedAt, :lastId)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

`(created_at, id) < (:c, :id)`는 **튜플 비교**다. created_at이 더 작거나, 같으면서 id가 더 작은 행을 의미한다. 정렬 컬럼과 동일한 순서의 **복합 인덱스 `(created_at, id)`**가 있으면, DB는 인덱스에서 커서 위치로 한 번에 **탐색(seek)**해 거기서부터 20개만 읽는다. 버리는 행이 없으니 비용이 O(limit)으로 일정하다. 500페이지든 1페이지든 같은 속도다.

정렬 키에 PK(`id`)를 더하는 이유는 **타이브레이커**다. created_at만으로는 동일 시각 행의 순서가 불안정해 페이지 경계에서 행이 중복되거나 누락된다. 유니크한 PK를 마지막 정렬 키로 붙여 전순서를 보장한다.

## 운영 함정

**1) "N페이지로 점프"가 안 된다.** keyset은 이전 페이지의 마지막 커서가 있어야 다음을 부른다. 임의 페이지 번호 직접 이동은 불가능하다. 무한 스크롤·"더 보기" UI에는 완벽하지만, 페이지 번호 네비게이션이 필수라면 트레이드오프를 받아들이거나 두 방식을 혼용한다.

**2) 정렬 키와 인덱스 순서가 어긋나면 효과가 없다.** `ORDER BY created_at DESC, id DESC`인데 인덱스가 `(id, created_at)`이면 seek가 안 되고 다시 정렬·스캔으로 돌아간다. **인덱스 컬럼 순서 = ORDER BY 순서**여야 하고, ASC/DESC 방향도 일관돼야 한다.

## 핵심 요약

- OFFSET은 버리는 행을 전부 읽어 깊은 페이지에서 선형으로 느려진다.
- keyset은 마지막 행의 (정렬키, PK)를 커서로 넘겨 인덱스에서 곧장 seek한다. 비용이 페이지 깊이와 무관하다.
- 타이브레이커로 유니크 키를 붙이고, 복합 인덱스 순서를 ORDER BY와 일치시켜라.

> Q. keyset 페이징이 offset보다 빠른 근본 이유는?
> A. offset은 건너뛸 행을 실제로 읽어야 하지만(O(offset)), keyset은 커서 값으로 인덱스를 직접 탐색해 limit 개만 읽는다(O(limit)).

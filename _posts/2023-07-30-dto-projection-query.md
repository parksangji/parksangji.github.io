---
title: "필요한 컬럼만 조회하면 빨라진다"
date: 2023-07-30 10:30:00 +0900
categories: [Database]
tags: [projection, select-column, dto, io, performance]
description: "SELECT *가 만드는 불필요한 I/O를 짚고, 필요한 컬럼만 읽는 프로젝션과 커버링 인덱스의 시너지를 다룬다."
---

목록 화면은 보통 행마다 몇 개 컬럼만 보여준다. 그런데 매핑 코드는 흔히 `SELECT *`로 테이블 전체를 긁어 와 엔티티에 다 채운 뒤, 화면엔 일부만 쓴다. 동작은 한다. 하지만 데이터가 커지면 **읽지도 않을 데이터를 디스크에서 메모리로, 네트워크로 실어 나르는 비용**이 그대로 응답 시간이 된다. 조회 최적화의 가장 싸고 효과 큰 첫걸음은 "필요한 컬럼만 SELECT"다.

## SELECT *가 비싼 진짜 이유

비용은 컬럼 개수가 아니라 **데이터가 흐르는 모든 단계에 누적**된다.

1. **디스크 I/O와 버퍼 풀.** DB는 행을 페이지(보통 8~16KB) 단위로 읽는다. `TEXT`나 큰 `VARCHAR` 같은 무거운 컬럼이 끼면 한 페이지에 들어가는 행 수가 줄고, 같은 행 수를 읽는 데 더 많은 페이지를 읽어야 한다. 버퍼 풀(메모리 캐시)도 그만큼 쓸데없는 데이터로 차서 캐시 효율이 떨어진다.
2. **네트워크 전송.** 결과 집합 전체가 직렬화되어 애플리케이션으로 넘어온다. 1000행 × 안 쓰는 큰 컬럼이면 수 MB가 의미 없이 오간다.
3. **커버링 인덱스를 못 쓴다.** 이게 핵심이다. 필요한 컬럼이 전부 인덱스 안에 있으면 DB는 **인덱스만 읽고 끝낼 수 있다.** `SELECT *`는 인덱스에 없는 컬럼을 요구하므로 매 행마다 실제 데이터 행으로 되돌아가는 룩업(테이블 액세스)을 해야 한다.

## 프로젝션: 필요한 것만 골라 DTO로

해법은 단순하다. 화면이 쓰는 컬럼만 SELECT하고, 그 모양에 맞는 **전용 DTO**로 받는다.

```sql
-- 안 좋음: 본문(content), 메타 등 전부 끌어옴
SELECT * FROM posts WHERE status = 'PUBLISHED' ORDER BY created_at DESC LIMIT 20;

-- 좋음: 목록이 쓰는 컬럼만 (프로젝션)
SELECT id, title, author_id, created_at
FROM   posts
WHERE  status = 'PUBLISHED'
ORDER  BY created_at DESC
LIMIT  20;
```

```java
// 목록 전용 DTO — 엔티티 전체가 아니라 화면이 필요로 하는 모양
public record PostSummary(long id, String title, long authorId, Instant createdAt) {}

public interface PostRepository {
    List<PostSummary> findSummaries(String status, int limit);
}
```

목록엔 `PostSummary`, 상세 화면에선 본문까지 포함한 별도 조회를 쓴다. "하나의 엔티티로 모든 화면을 처리"하려는 욕심이 `SELECT *`를 부른다. **화면마다 필요한 데이터의 모양은 다르다**는 사실을 DTO로 인정하는 것이 출발점이다.

## 커버링 인덱스와의 시너지

위 쿼리를 자주 쓴다면 인덱스를 이렇게 건다.

```sql
CREATE INDEX idx_posts_list
  ON posts (status, created_at, id, author_id, title);
```

`status`로 거르고 `created_at`로 정렬하며, 결과로 필요한 `id, author_id, title`까지 **전부 인덱스에 포함**된다. 그러면 DB는 이 인덱스만 스캔해 정렬·필터·반환을 끝내고, 원본 테이블 행은 건드리지 않는다. 실행 계획에서 "Using index"(MySQL) 또는 Index Only Scan이 뜨면 성공이다. `SELECT *`였다면 인덱스에 없는 컬럼 때문에 이 최적화는 원천적으로 불가능하다. 프로젝션과 커버링 인덱스는 한 쌍으로 움직인다.

## 운영 함정

**과한 커버링 인덱스는 쓰기를 느리게 한다.** 인덱스에 컬럼을 많이 욱여넣으면 그 인덱스 자체가 커지고, INSERT/UPDATE마다 인덱스도 갱신해야 해 쓰기 비용과 저장 공간이 늘어난다. 읽기 이득과 쓰기 비용을 저울질하라. 자주 쓰는 핵심 목록 한두 개에만 정밀하게 건다.

**`SELECT *` + ORM의 지연 로딩 함정.** 엔티티를 통째로 가져온 뒤 화면에서 연관 객체를 건드리면 행마다 추가 쿼리가 나가는 N+1로 번질 수 있다. 처음부터 필요한 컬럼만 프로젝션하면 이 연쇄를 끊을 수 있다.

## 핵심 요약

- `SELECT *`는 디스크 I/O, 버퍼 풀, 네트워크 전 단계에 불필요한 비용을 누적하고, 커버링 인덱스 최적화를 막는다.
- 화면별 전용 DTO로 필요한 컬럼만 프로젝션하라. 엔티티 하나로 모든 화면을 처리하려는 욕심이 SELECT *를 부른다.
- 프로젝션 + 커버링 인덱스면 인덱스만 읽고 끝낼 수 있다. 단, 인덱스 비대화로 인한 쓰기 비용은 따로 저울질한다.

**면접 한 줄 Q&A.** "커버링 인덱스가 뭐고 SELECT *와 무슨 관계인가?" → 쿼리가 필요로 하는 모든 컬럼을 포함한 인덱스. 인덱스만 읽고 답할 수 있어 테이블 룩업을 없앤다. SELECT *는 인덱스 밖 컬럼을 요구하므로 이 최적화를 불가능하게 만든다.

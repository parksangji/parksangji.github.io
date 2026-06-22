---
title: "PostGIS 성능 비교: GEOMETRY vs TEXT 저장 방식"
date: 2024-06-18 16:20:00 +0900
categories: [Database, PostgreSQL]
tags: [postgresql, postgis, performance, index]
---

## "그냥 문자열로 저장하면 안 되나요?"

PostGIS를 도입하면서 팀에서 나온 질문이 있었습니다. "어차피 위경도인데 `'127.0276,37.4979'` 같은 문자열로 `TEXT`에 저장하고, 필요할 때 파싱하면 안 되나요?" 저장도 단순하고 마이그레이션도 편하니까요.

직관적으로는 `geometry` 타입이 빠를 것 같았지만, 막연한 느낌 말고 실제로 얼마나 차이 나는지 궁금해서 직접 비교해봤습니다.

## 실험 세팅

같은 좌표 데이터를 두 가지 방식으로 저장해봤습니다.

```sql
-- 방식 A: geometry + GiST 인덱스
CREATE TABLE points_geom (
    id   bigserial PRIMARY KEY,
    geom geometry(Point, 4326)
);
CREATE INDEX idx_points_geom ON points_geom USING GIST (geom);

-- 방식 B: TEXT ("lng,lat" 문자열)
CREATE TABLE points_text (
    id    bigserial PRIMARY KEY,
    coord text
);
```

그리고 100만 건의 랜덤 좌표를 양쪽에 동일하게 넣었습니다.

```sql
INSERT INTO points_geom (geom)
SELECT ST_SetSRID(ST_MakePoint(126 + random(), 37 + random()), 4326)
FROM generate_series(1, 1000000);
```

## 반경 검색 비교

**방식 A (geometry)** — 함수 한 줄, GiST 인덱스가 후보를 좁혀줍니다.

```sql
EXPLAIN ANALYZE
SELECT id FROM points_geom
WHERE ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint(126.5, 37.5), 4326)::geography,
        500
      );
```

실행 계획에 `Index Scan using idx_points_geom`이 잡히면서 후보 행만 빠르게 추려냅니다.

**방식 B (TEXT)** — 인덱스를 못 쓰니 100만 건을 전부 읽어 문자열을 쪼개고, 거리를 일일이 계산해야 합니다.

```sql
EXPLAIN ANALYZE
SELECT id FROM points_text
WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(
            split_part(coord, ',', 1)::float8,
            split_part(coord, ',', 2)::float8
        ), 4326)::geography,
        ST_SetSRID(ST_MakePoint(126.5, 37.5), 4326)::geography,
        500
      );
```

여기는 어김없이 `Seq Scan`입니다. 모든 행에 대해 `split_part` → 형변환 → 거리 계산을 돌리니, 데이터가 늘어날수록 선형으로 느려집니다.

## 결과 요약

| 항목 | geometry + GiST | TEXT |
|------|-----------------|------|
| 반경 검색 | 인덱스로 후보 축소, 빠름 | 전체 스캔, 느림 |
| 공간 인덱스 | 사용 가능 (GiST) | 불가능 |
| 함수 활용 | `ST_*` 직접 사용 | 매번 파싱 필요 |
| 데이터 검증 | 잘못된 좌표 INSERT 시 에러 | 아무 문자열이나 들어감 |

`TEXT` 방식은 데이터가 적을 땐 차이를 못 느끼지만, 수십만~수백만 건으로 가면 검색 시간이 수십 배 이상 벌어집니다. 게다가 `TEXT`는 `'abc'` 같은 엉뚱한 값도 그대로 들어가서, **데이터 무결성**까지 깨질 수 있습니다.

## 정리 & 주의점

- 위치 데이터는 `geometry`(또는 `geography`)로 저장하고 **GiST 인덱스**를 거는 게 정답입니다.
- `TEXT` 저장은 "당장 편한" 선택이지만, 검색 성능과 데이터 무결성을 모두 포기하는 셈입니다.
- 비교할 땐 항상 `EXPLAIN ANALYZE`로 `Index Scan`이 잡히는지 확인하세요. 막연한 추측보다 실행 계획이 정확합니다.

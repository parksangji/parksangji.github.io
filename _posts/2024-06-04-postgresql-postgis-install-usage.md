---
title: PostGIS 설치 및 사용
date: 2024-06-04 11:15:00 +0900
series: "PostgreSQL"
categories: [Database]
tags: [postgresql, postgis, gis, spatial]
image:
  path: /assets/img/posts/postgresql-postgis-install-usage.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnNpOcA0hRv7po3sCcHFIZH/vGrJFSJnkEYHzGr8mlERZRizgciqMNw0U6y9SprVn1yNoz5UW2Rhg0AY7dTTTRRSASkoooA//Z"
  alt: PostGIS 설치 및 사용
---

## 위경도를 그냥 숫자 두 개로 저장하다가

지도 기반 기능을 처음 만들 때, 저는 위도/경도를 그냥 `latitude`, `longitude` 두 개의 `double precision` 컬럼에 넣었습니다. "반경 1km 안의 매장"을 찾으려니, 하버사인(Haversine) 공식을 SQL에 직접 박아 넣어야 했고, 쿼리는 길어지고 인덱스도 안 타서 느렸습니다. 😩

이때 알게 된 게 **PostGIS**입니다. PostgreSQL을 공간 데이터베이스로 확장해주는 익스텐션인데, 위치 기반 연산을 함수 한두 개로 끝낼 수 있습니다.

## 설치

PostGIS는 PostgreSQL의 익스텐션이라, 패키지만 깔려 있으면 SQL 한 줄로 활성화됩니다.

```sql
-- 현재 데이터베이스에 PostGIS 활성화
CREATE EXTENSION IF NOT EXISTS postgis;

-- 버전 확인
SELECT PostGIS_Full_Version();
```

로컬에서 빠르게 테스트할 거면 도커 이미지가 제일 편합니다. PostgreSQL + PostGIS가 같이 들어 있어요.

```bash
docker run --name postgis \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d postgis/postgis:16-3.4
```

## geometry vs geography

PostGIS에는 위치를 저장하는 타입이 크게 두 가지 있습니다.

- **geometry**: 평면(데카르트) 좌표계. 계산이 빠르지만, 위경도를 그대로 넣으면 "거리"가 미터가 아니라 도(degree) 단위로 나옵니다.
- **geography**: 지구를 타원체로 보고 계산. 위경도(SRID 4326)를 넣으면 거리 결과가 **미터**로 나와서 직관적입니다. 대신 살짝 느립니다.

> 좌표계는 SRID로 구분합니다. 우리가 흔히 쓰는 GPS 위경도(WGS84)가 **SRID 4326** 입니다.
{: .prompt-tip }

## 테이블 만들고 데이터 넣기

```sql
CREATE TABLE stores (
    id   bigserial PRIMARY KEY,
    name text NOT NULL,
    geom geometry(Point, 4326)   -- 점, WGS84
);

-- ST_MakePoint(경도, 위도) 순서에 주의! (x=lng, y=lat)
INSERT INTO stores (name, geom)
VALUES ('강남점', ST_SetSRID(ST_MakePoint(127.0276, 37.4979), 4326));
```

가장 많이 헷갈리는 부분이 **`ST_MakePoint`는 (경도, 위도) 순서**라는 점입니다. 사람은 보통 "위도, 경도"로 말하니까 반대로 넣기 쉬워요.

## 반경 검색

이제 "특정 지점에서 1km 안의 매장"을 찾아봅시다. `geography`로 캐스팅하면 `ST_DWithin`의 거리 단위가 미터가 됩니다.

```sql
SELECT id, name,
       ST_Distance(geom::geography,
                   ST_SetSRID(ST_MakePoint(127.0286, 37.4980), 4326)::geography) AS dist_m
FROM stores
WHERE ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint(127.0286, 37.4980), 4326)::geography,
        1000               -- 1km
      )
ORDER BY dist_m;
```

하버사인 공식을 손으로 짜던 것에 비하면 훨씬 읽기 좋죠.

## 공간 인덱스 (GiST)

공간 검색을 빠르게 하려면 일반 B-tree가 아니라 **GiST 인덱스**를 써야 합니다.

```sql
CREATE INDEX idx_stores_geom ON stores USING GIST (geom);
```

`ST_DWithin` 같은 함수는 이 GiST 인덱스를 활용해서 후보를 먼저 좁힌 뒤 정밀 계산을 합니다. 인덱스가 없으면 전체 행을 다 계산하니, 데이터가 많아지면 반드시 걸어주세요.

## 정리

- 위치 데이터를 다룰 거면 위경도 숫자 컬럼 대신 PostGIS를 쓰는 게 코드도 성능도 좋습니다.
- 거리 결과를 미터로 받고 싶으면 `geography`(SRID 4326).
- `ST_MakePoint(경도, 위도)` 순서 주의.
- 공간 검색에는 **GiST 인덱스** 필수.

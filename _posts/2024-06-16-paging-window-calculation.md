---
title: "페이지네이션 UI의 시작·끝 블록 계산을 서버가 책임지는 이유"
date: 2024-06-16 10:30:00 +0900
categories: [Backend]
tags: [pagination, page-block, calculation, dto, ui]
description: "총건수에서 총페이지, 현재 페이지 블록의 시작·끝을 계산해 서버 DTO로 내려주는 패턴과 off-by-one 함정을 정리한다."
---

목록 하단의 `1 2 3 ... 10 [다음]` 페이지 번호를 손보던 주였다. 이 계산을 프런트에 맡길지 서버에 둘지가 늘 논쟁거리다. 결론부터: **블록 계산은 서버 DTO에서 책임지는 게 맞다.** 총건수는 서버만 정확히 알고, 클라이언트마다 같은 로직을 중복 구현하면 off-by-one이 산발적으로 터지기 때문이다.

## 계산의 뼈대 — 총건수에서 블록까지

페이징 UI는 네 개의 값에서 파생된다. **총건수(totalCount), 페이지당 크기(size), 현재 페이지(page), 블록당 페이지 수(blockSize)**. 나머지는 전부 계산이다.

총페이지는 올림 나눗셈이다.

```
totalPages = ceil(totalCount / size) = (totalCount + size - 1) / size
```

정수 나눗셈에서 `+size-1` 트릭을 쓰는 이유는, `totalCount`가 size로 딱 나눠떨어지지 않을 때 마지막 한 페이지를 잃지 않기 위해서다. 101건을 10개씩 보면 11페이지가 나와야 한다. `101/10 = 10`(버림)이지만 `(101+9)/10 = 11`이 된다.

현재 페이지가 속한 블록의 시작·끝은 다음과 같다(페이지가 1부터 시작, blockSize=10 가정).

```
startPage = ((page - 1) / blockSize) * blockSize + 1
endPage   = min(startPage + blockSize - 1, totalPages)
```

`page=7`이면 블록 0번 → `startPage=1, endPage=10`. `page=23`이면 블록 2번 → `startPage=21, endPage=30`. 핵심은 **endPage를 totalPages로 클램프**하는 것이다. 이걸 안 하면 마지막 블록에서 존재하지 않는 페이지 번호가 그려진다.

## DTO로 내려주기

서버는 계산 결과를 평탄한 DTO로 내려준다. 프런트는 그리기만 한다.

```java
public class PageInfo {
    private final long totalCount;
    private final int page, size, totalPages;
    private final int startPage, endPage;
    private final boolean hasPrev, hasNext;

    public PageInfo(long totalCount, int page, int size, int blockSize) {
        this.totalCount = totalCount;
        this.page = page;
        this.size = size;
        this.totalPages = (int) ((totalCount + size - 1) / size);
        this.startPage = ((page - 1) / blockSize) * blockSize + 1;
        this.endPage = Math.min(startPage + blockSize - 1, Math.max(totalPages, 1));
        this.hasPrev = startPage > 1;
        this.hasNext = endPage < totalPages;
    }
}
```

`hasPrev`/`hasNext`는 `page` 기준이 아니라 **블록 기준**임에 주의한다. "이전" 버튼은 이전 블록(startPage-1)으로, "다음"은 다음 블록(endPage+1)으로 이동시키는 게 보통이다.

## 운영 함정

**함정 1 — totalCount=0일 때.** 데이터가 하나도 없으면 `totalPages=0`이 되고 `endPage`가 0이 되어 빈 페이지바가 깨진다. `totalPages`를 최소 1로 클램프하거나, 0건일 때는 페이지바를 아예 렌더하지 않도록 분기한다. 위 코드에서 `Math.max(totalPages, 1)`이 이 방어다.

**함정 2 — page 범위 검증 누락.** 클라이언트가 `page=99999`처럼 범위 밖 값을 보내면 빈 목록이 나가고 블록 계산도 엉뚱해진다. 서버에서 `page`를 `1..totalPages`로 클램프한 뒤 계산해야 일관성이 유지된다.

## 핵심 요약

- 총페이지는 올림 나눗셈 `(n+size-1)/size`. 마지막 페이지 유실 방지.
- `endPage = min(startPage+blockSize-1, totalPages)` 클램프가 off-by-one의 핵심 방어.
- 계산은 서버 DTO가 단일 책임으로 가져가고 클라이언트는 렌더만 한다.

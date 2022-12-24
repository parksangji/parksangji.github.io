---
title: "엑셀로 내려준 표가 깨져 보일 때 — POI 셀 스타일과 열 너비"
date: 2022-12-24 10:30:00 +0900
categories: [Infra]
tags: [excel, apache-poi, cell-style, column-width, report, formatting]
description: "운영자가 받는 엑셀은 내용뿐 아니라 읽히는 모양이 중요하다. POI에서 CellStyle을 재사용해야 하는 이유와 autoSizeColumn의 비용, 그 대안."
---

운영자에게 내려주는 엑셀은 데이터만 맞다고 끝이 아니다. 헤더가 굵고, 숫자에 천 단위 콤마가 찍히고, 열 너비가 적당해야 "읽힌다". 그런데 POI(Apache POI)로 서식을 입히다 보면, **느려지거나, 아예 파일이 안 열리는** 함정에 빠진다. 원인은 거의 항상 같다 — 스타일 객체를 셀마다 새로 만드는 것.

## CellStyle을 매 셀 new 하면 안 되는 이유

POI의 `CellStyle`은 셀이 들고 있는 게 아니라 **워크북 전역 스타일 테이블의 인덱스**를 가리킨다. 엑셀 파일 포맷(특히 구형 .xls)은 워크북당 스타일 개수에 상한이 있다 — .xls는 약 4,000개. 셀마다 `createCellStyle()`을 호출하면 행 수만큼 스타일이 생겨 한도를 넘고, `The maximum number of cell styles was exceeded` 예외로 죽거나, 한도가 큰 .xlsx여도 메모리가 폭증한다.

스타일은 **반복되는 종류만큼만** 미리 만들어 재사용한다.

```java
// 안티패턴: 행마다 스타일 생성 → 스타일 폭증
for (Order o : orders) {
    Row row = sheet.createRow(i++);
    Cell c = row.createCell(0);
    CellStyle s = workbook.createCellStyle(); // ❌ 매번 new
    s.setDataFormat(fmt.getFormat("#,##0"));
    c.setCellStyle(s);
}
```

```java
// 올바른 패턴: 스타일은 루프 밖에서 한 번 만들어 공유
CellStyle moneyStyle = workbook.createCellStyle();
moneyStyle.setDataFormat(workbook.createDataFormat().getFormat("#,##0"));

CellStyle headerStyle = workbook.createCellStyle();
Font bold = workbook.createFont();
bold.setBold(true);
headerStyle.setFont(bold);
headerStyle.setAlignment(HorizontalAlignment.CENTER);

for (Order o : orders) {
    Row row = sheet.createRow(i++);
    Cell c = row.createCell(0);
    c.setCellValue(o.getAmount());
    c.setCellStyle(moneyStyle); // ✅ 공유 스타일 참조
}
```

스타일 생성을 공통 메서드로 빼서 "헤더용/금액용/날짜용"처럼 종류 단위로만 만들면, 데이터가 10만 행이어도 스타일은 몇 개로 고정된다.

## autoSizeColumn의 비용과 대안

열 너비를 맞추는 `sheet.autoSizeColumn(i)`는 편하지만 비싸다. **해당 열의 모든 셀을 렌더링해 텍스트 폭을 측정**하므로 데이터가 많을수록 느려지고, 서버에 폰트 메트릭(헤드리스 환경의 폰트)이 없으면 오작동하기도 한다. 또 SXSSF(스트리밍) 모드에선 이미 디스크로 밀린(flush) 행은 측정할 수 없다.

대안:

- **고정 너비** — `sheet.setColumnWidth(i, 20 * 256)` (단위는 1/256 문자폭). 가장 빠르고 예측 가능하다.
- **꼭 자동이 필요하면 마지막에 한 번만** — 데이터를 다 쓴 뒤 호출하고, 스트리밍 모드면 `SXSSFSheet.trackAllColumnsForAutoSizing()`로 추적을 켠다.

## 핵심 요약

- `CellStyle`은 워크북 전역 자원이다. 셀마다 new 하면 한도 초과·메모리 폭증.
- 스타일은 종류 단위로 루프 밖에서 만들어 공유한다.
- `autoSizeColumn`은 측정 비용이 크다 — 고정 너비가 기본, 자동은 마지막에 한 번만.

> **면접 한 줄**: "엑셀 다운로드가 행 수에 비례해 느려지고 가끔 죽는다, 왜?" → 셀마다 CellStyle을 생성해 스타일 테이블이 폭증한 것. 스타일 재사용으로 해결한다.

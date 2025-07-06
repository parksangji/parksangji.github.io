---
title: "엑셀 수만 행 내려받기에서 메모리가 터지는 이유"
date: 2025-07-06 10:30:00 +0900
categories: [Infra]
tags: [excel, streaming, poi, sxssf, memory]
description: "Apache POI로 대량 엑셀을 만들 때 전체 워크북을 힙에 쥐면 왜 OOM이 나는지, SXSSF 스트리밍 워크북과 행 단위 flush로 메모리를 일정하게 유지하는 방법."
mermaid: true
---

관리 화면에서 데이터를 엑셀로 내려받는 기능을 다룬 주였다. 수백 행일 땐 멀쩡한데, 수만~수십만 행을 뽑는 순간 서버 힙이 치솟고 OOM이 난다. 엑셀 생성의 본질은 "행을 메모리에 얼마나 쌓아두느냐"이고, 답은 "쌓지 않고 흘려보낸다"이다.

## 왜 메모리가 터지나

Apache POI의 기본 워크북 `XSSFWorkbook`은 **전체 시트를 메모리에 객체 그래프로 보관**한다. 셀 하나가 `XSSFCell` 객체, 행이 `XSSFRow`, 거기에 스타일·문자열 풀까지. 10만 행 × 20열이면 셀 객체만 200만 개다. 객체 헤더 오버헤드까지 더하면 수백 MB ~ GB가 잡힌다. 여기에 동시 다운로드가 겹치면 곱하기 N으로 폭발한다.

핵심은 만든 행을 끝까지 들고 있을 이유가 없다는 점이다. 이미 디스크로 쓴 행은 메모리에서 버려도 된다.

## SXSSF — 슬라이딩 윈도 스트리밍

POI는 이를 위해 `SXSSFWorkbook`을 제공한다. 메모리에는 최근 N개 행만 윈도로 유지하고, 윈도를 벗어난 행은 임시 파일로 flush한 뒤 힙에서 제거한다. 그래서 행 수가 늘어도 메모리는 거의 일정하다.

```mermaid
flowchart LR
  A[행 생성] --> B[메모리 윈도 N행]
  B -->|윈도 초과 행| C[임시 파일 flush]
  B --> D[응답 OutputStream]
  C --> D
```

```java
// 메모리엔 최근 100행만 유지, 초과분은 디스크로 flush
try (SXSSFWorkbook wb = new SXSSFWorkbook(100)) {
    Sheet sheet = wb.createSheet("orders");
    int r = 0;
    // DB는 커서/스트리밍으로 한 행씩 받아 그대로 흘려보낸다 (전체 List 로딩 금지)
    for (OrderRow o : orderCursor) {
        Row row = sheet.createRow(r++);
        row.createCell(0).setCellValue(o.getId());
        row.createCell(1).setCellValue(o.getAmount());
        // 필요 시 명시적 flush로 윈도 강제 비우기
    }
    wb.write(response.getOutputStream()); // 응답 스트림으로 직접 출력
    wb.dispose();                          // 임시 파일 정리
}
```

두 군데 모두에서 스트리밍해야 한다. POI 쪽뿐 아니라 **DB 조회도 전체를 `List`로 받으면** 거기서 먼저 터진다. MyBatis라면 `ResultHandler`나 커서로 한 행씩 받아 곧장 엑셀 행으로 흘려보낸다.

## 정렬·수식의 한계

SXSSF는 윈도 밖 행에 접근할 수 없다. 그래서 이미 flush된 행을 다시 읽어야 하는 작업 — 임의 행 수정, 전체 정렬, 일부 수식 평가 — 은 못 한다. 대량 내보내기는 보통 "위에서 아래로 한 번 쓰기"라 문제없지만, 정렬이 필요하면 DB에서 `ORDER BY`로 정렬해 들여온다.

## 운영 함정

- **임시 파일 미정리**: `dispose()`를 안 부르면 flush된 temp 파일이 남아 디스크를 채운다. try-with-resources나 finally에서 반드시 정리한다.
- **응답 후 가공**: 워크북을 다 만들어 `byte[]`로 모은 다음 응답에 쓰면 SXSSF의 의미가 없다. `response.getOutputStream()`에 직접 써서 메모리 피크를 낮춘다.
- **포맷 한계**: `.xls`(HSSF)는 65,536행 상한이 있다. 대량은 `.xlsx`(XSSF/SXSSF)로 간다.

## 핵심 요약

- 기본 `XSSFWorkbook`은 전체 시트를 힙에 쥐어 대량에서 OOM. `SXSSFWorkbook(window)`로 행을 흘려보낸다.
- DB 조회도 커서/`ResultHandler`로 스트리밍해 전체 `List` 로딩을 피한다.
- 응답 스트림으로 직접 쓰고 `dispose()`로 임시 파일을 정리한다.

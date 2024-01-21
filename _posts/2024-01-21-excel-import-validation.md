---
title: "엑셀 업로드 파싱과 행 단위 검증 — 부분 실패를 다루는 법"
date: 2024-01-21 10:30:00 +0900
categories: [Backend]
tags: [excel, import, validation, batch, error-report]
description: "엑셀 임포트에서 행별 검증, 전체 롤백 vs 부분 커밋의 선택, 그리고 오류 행을 사용자에게 돌려주는 리포트 설계를 정리한다."
---

엑셀 업로드 기능을 만들다 보면 단순 파싱이 본질이 아님을 곧 깨닫는다. 진짜 어려운 건 **수백 행 중 일부만 잘못됐을 때 어떻게 처리하고, 무엇이 틀렸는지 어떻게 돌려줄 것인가**다.

## 스트리밍 파싱: 메모리부터 지킨다

엑셀 파일을 통째로 객체 트리로 읽으면 큰 파일에서 OOM이 난다. POI를 예로 들면, DOM 방식(`XSSFWorkbook`)은 전체를 메모리에 올리고, **이벤트(SAX) 방식**은 행을 하나씩 흘려보내며 읽는다. 대량 임포트라면 행 단위로 스트리밍해 한 번에 한 행만 메모리에 두는 것이 원칙이다.

```java
for (Row row : sheet) {
    RowData data = parseRow(row);   // 한 행씩 처리
    // 누적하지 않고 즉시 검증·적재
}
```

## 행 단위 검증과 오류 누적

핵심 설계는 **검증 실패가 곧 예외가 아니라는 것**이다. 한 행이 틀렸다고 던져 버리면 거기서 멈춘다. 대신 행마다 검증하고, 오류를 행 번호와 함께 **수집**한다.

```java
public ImportResult importRows(List<Row> rows) {
    List<RowError> errors = new ArrayList<>();
    List<User> valid = new ArrayList<>();

    for (int i = 0; i < rows.size(); i++) {
        int lineNo = i + 2;  // 헤더 1행 + 0-based 보정
        try {
            User u = parseRow(rows.get(i));
            validate(u);             // 실패 시 ValidationException
            valid.add(u);
        } catch (ParseException | ValidationException e) {
            errors.add(new RowError(lineNo, e.getMessage()));
        }
    }
    return new ImportResult(valid, errors);
}
```

이제 정상 행과 오류 행이 분리됐다. 다음 결정은 정책 문제다.

## 전체 롤백 vs 부분 커밋

**전부 아니면 전무(all-or-nothing).** 한 행이라도 틀리면 아무것도 저장하지 않고, 오류 리포트만 돌려준다. 데이터 정합성이 중요한 경우(회계, 정산 등) 안전하다. 트랜잭션 하나로 감싸고, 오류가 있으면 커밋하지 않는다.

```java
@Transactional
public ImportResult importAll(MultipartFile file) {
    ImportResult result = importRows(read(file));
    if (result.hasErrors()) {
        throw new ImportFailedException(result.getErrors()); // 전체 롤백
    }
    userRepository.saveAll(result.getValid());
    return result;
}
```

**부분 커밋(best-effort).** 정상 행은 저장하고, 오류 행만 리포트로 돌려준다. "맞는 것만 일단 넣고 나머지는 고쳐서 다시 올려라"는 UX다. 대량 마케팅 데이터처럼 부분 적재가 허용될 때 쓴다.

어느 쪽이든 **사용자에게 행 번호와 사유를 명확히 돌려주는 것**이 기능의 완성도를 가른다.

```json
{
  "imported": 248,
  "failed": 2,
  "errors": [
    { "line": 15, "message": "이메일 형식 오류: abc@" },
    { "line": 102, "message": "필수값 누락: 이름" }
  ]
}
```

## 운영 함정

**행 번호 어긋남.** 헤더 행, 0-based 인덱스, 빈 행 건너뛰기가 겹치면 사용자가 보는 엑셀 행 번호와 어긋난다. 검증 단계에서 **실제 시트 행 번호**(`row.getRowNum() + 1`)를 그대로 들고 다녀야 사용자가 그 행을 바로 찾는다.

**셀 타입 강제 변환.** 엑셀에서 "00123" 같은 우편번호가 숫자 셀이면 앞 0이 사라지고 `123`이 된다. 날짜도 숫자 serial로 들어온다. 셀 타입을 확인하고 문자열이 필요한 컬럼은 셀 포맷을 텍스트로 안내하거나, 읽을 때 명시적으로 문자열로 변환해야 한다.

## 핵심 요약

- 대용량 엑셀은 스트리밍(SAX)으로 행 단위 파싱해 메모리를 일정하게 유지한다.
- 검증 실패를 예외로 멈추지 말고 행 번호와 함께 누적해, 전체 롤백 또는 부분 커밋 정책을 선택한다.
- 사용자에게 "몇 번째 행이 왜 틀렸는지"를 돌려주는 오류 리포트가 기능의 핵심이다.

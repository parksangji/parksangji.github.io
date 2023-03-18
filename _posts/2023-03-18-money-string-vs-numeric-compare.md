---
title: "환불 금액을 문자열로 비교하면 생기는 일"
date: 2023-03-18 10:30:00 +0900
categories: [Backend]
tags: [money, numeric-compare, validation, type-coercion, bigdecimal, input]
description: "'9000' > '10000'이 참이 되는 문자열 비교의 함정. 금액 입력을 숫자로 파싱해 검증해야 하는 이유와 빈 값·비숫자 방어, 환불 한도 경계 검증을 정리한다."
---

환불 한도를 검증하는 코드를 보다가 이상한 버그를 만났다. 9,000원 환불은 막히는데 10,000원 환불은 통과한다. 한도는 분명 결제액인데. 원인은 어이없게도 비교가 **문자열로** 이뤄지고 있었다. 폼에서 넘어온 금액이 `String`인 채로 비교 연산에 들어갔던 것이다.

## 핵심: 문자열 비교는 사전순이다

문자열을 비교하면 숫자 크기가 아니라 **문자 코드 순서(사전순)**로 따진다. `'9'`는 `'1'`보다 크므로, `"9000"`은 `"10000"`보다 "크다"고 판정된다. 첫 글자 `9` > `1`에서 이미 승부가 나기 때문이다.

```java
"9000".compareTo("10000");   // 양수 → "9000"이 더 크다고 판정
9000 > 10000;                // false (정상)
```

자릿수가 다를 때 특히 위험하다. 더 짧은(작은) 숫자가 더 크게 판정될 수 있다. 금액·수량·나이처럼 **크기 비교가 의미 있는 값**은 절대 문자열로 비교하면 안 된다.

## 금액은 BigDecimal로 파싱해 비교한다

금액에 `double`을 쓰면 부동소수 오차로 `0.1 + 0.2 != 0.3` 같은 일이 생긴다. 돈은 `BigDecimal`로 다룬다. 그리고 입력 검증의 순서는 **방어 → 파싱 → 경계 비교**다.

```java
public void validateRefund(String rawAmount, BigDecimal paidAmount) {
    // 1) 방어: 빈 값·공백·null
    if (rawAmount == null || rawAmount.isBlank()) {
        throw new ValidationException("환불 금액을 입력하세요.");
    }
    // 2) 파싱: 비숫자 입력 차단
    BigDecimal refund;
    try {
        refund = new BigDecimal(rawAmount.trim());
    } catch (NumberFormatException e) {
        throw new ValidationException("금액은 숫자여야 합니다.");
    }
    // 3) 경계 비교: 숫자끼리 compareTo
    if (refund.signum() <= 0) {
        throw new ValidationException("환불 금액은 0보다 커야 합니다.");
    }
    if (refund.compareTo(paidAmount) > 0) {       // 결제액 초과 금지
        throw new ValidationException("환불 금액이 결제 금액을 초과할 수 없습니다.");
    }
}
```

`BigDecimal` 비교는 `equals`가 아니라 **`compareTo`**를 쓴다. `equals`는 스케일까지 따져 `2.0`과 `2.00`을 다르다고 보지만, `compareTo`는 값만 비교한다. 금액 비교에선 항상 `compareTo`다.

## 왜 입력이 문자열로 들어오는가

HTTP 폼/쿼리 파라미터는 본질적으로 문자열이다. 프레임워크가 컨트롤러 파라미터 타입에 맞춰 변환(바인딩)해주지만, `String`으로 받아 직접 다루거나 JS에서 비교하면 변환이 일어나지 않는다. 그래서 **경계에서 한 번 숫자로 변환**하고, 그 뒤로는 숫자 타입으로만 다루는 규율이 필요하다. 컨트롤러에서 `@RequestParam BigDecimal amount`로 받으면 바인딩 단계에서 비숫자 입력은 400으로 걸러지므로, 가능하면 타입을 명시해 받는 편이 낫다.

## 운영 함정

- **천 단위 콤마.** 사용자가 `"10,000"`을 입력하면 `BigDecimal` 파싱이 실패한다. 콤마를 제거하는 정규화를 파싱 전에 넣되, 소수점/마이너스까지 무분별하게 지우지 않도록 주의한다.
- **프론트 검증만 믿기.** 화면에서 숫자 입력만 받게 막아도, API는 우회 요청을 받을 수 있다. 검증은 반드시 **서버에서** 다시 한다. 프론트 검증은 UX, 서버 검증은 정합성·보안이다.

## 면접 한 줄 Q&A

**Q. 금액을 `equals` 대신 `compareTo`로 비교하는 이유는?**
A. `BigDecimal.equals`는 값뿐 아니라 스케일(소수 자릿수)까지 비교해 `2.0`과 `2.00`을 다르게 본다. 금액의 크기/동등 비교가 목적이라면 스케일을 무시하고 값만 비교하는 `compareTo`를 써야 한다.

---
title: "돈을 double로 계산하면 1원이 사라진다"
date: 2025-06-22 10:30:00 +0900
categories: [Java]
tags: [bigdecimal, money, precision, rounding, double]
description: "double의 이진 부동소수 오차가 금액 계산에서 1원을 갉아먹는 원리와, BigDecimal 스케일·RoundingMode·통화 정수 표현으로 정확성을 보장하는 방법."
---

금액을 다루는 화면을 손보던 주였다. 합계와 부가세, 할인 적용액이 화면마다 1원씩 어긋나는 일이 생기면 원인은 거의 항상 같다. 돈을 `double`로 계산했다는 것이다. 돈은 절대 부동소수로 다루지 않는다 — 이건 취향이 아니라 규칙이다.

## 왜 double은 돈을 못 맞추나

`double`은 IEEE 754 이진 부동소수다. 내부 표현이 2진수이므로 10진 소수 중 2의 거듭제곱 합으로 떨어지지 않는 값은 정확히 저장되지 못한다. 0.1은 2진수로 무한 순환소수다. 그래서 다음이 성립한다.

```java
System.out.println(0.1 + 0.2);        // 0.30000000000000004
System.out.println(0.1 + 0.2 == 0.3); // false
```

금액 계산은 곱셈(단가 × 수량), 나눗셈(분할 정산), 누적 합이 반복된다. 오차가 매 연산마다 누적되고, 마지막에 반올림하면 1원 단위로 결과가 틀어진다. 53비트 가수(mantissa)의 정밀도도 큰 금액에서는 한계가 온다.

## BigDecimal — 10진 임의정밀도

`BigDecimal`은 값을 `unscaledValue × 10^(-scale)`로 저장한다. 즉 정수부와 "소수점 위치(scale)"를 분리해 10진수를 정확히 표현한다. 오차가 없다.

단, 두 가지를 반드시 지켜야 한다.

```java
// 1) 생성은 문자열로. double 리터럴로 만들면 오차가 그대로 들어온다.
new BigDecimal(0.1);     // 0.1000000000000000055511151231257827021181583404541015625
new BigDecimal("0.1");   // 0.1  ← 정확

// 2) 나눗셈은 반드시 scale과 RoundingMode를 지정한다.
BigDecimal total = new BigDecimal("10000");
total.divide(new BigDecimal("3"));                       // ArithmeticException: 무한소수
total.divide(new BigDecimal("3"), 0, RoundingMode.HALF_UP); // 3333
```

나눗셈에 결과 scale을 안 주면 나누어떨어지지 않을 때 예외가 난다. 이건 버그가 아니라 "정밀도를 네가 결정하라"는 강제다. 금융에서는 보통 `HALF_UP`(반올림) 혹은 정책에 따라 `HALF_EVEN`(은행가 반올림, 통계적 편향 제거)을 쓴다.

## 또 다른 정답 — 통화를 정수로

원/엔처럼 최소 단위가 정수인 통화는 아예 정수 long으로 다루는 방법도 강력하다. 달러라면 센트 단위 long으로 저장한다(1234 = $12.34). 표현은 표시 직전에만 나눈다. DB 컬럼은 `DECIMAL(19,2)` 같은 고정 소수 타입으로 두고, 자바에서는 `BigDecimal`로 받는다 — `FLOAT`/`DOUBLE` 컬럼은 금액에 쓰지 않는다.

## 운영 함정

- **equals vs compareTo**: `new BigDecimal("1.0").equals(new BigDecimal("1.00"))`는 `false`다. scale까지 비교하기 때문이다. 값의 동등 비교는 반드시 `compareTo(...) == 0`을 쓴다.
- **표시 scale 고정 안 함**: 합계가 `1000`으로, 다른 화면은 `1000.00`으로 나오면 같은 값인데 다르게 보인다. 출력 직전 `setScale(2, RoundingMode.HALF_UP)`로 통일한다.

## 핵심 요약

- 돈은 `double`/`float` 금지. 이진 부동소수는 10진 금액을 정확히 표현 못 한다.
- `BigDecimal`은 문자열로 생성하고, 나눗셈엔 scale + `RoundingMode`를 항상 지정한다.
- 동등 비교는 `compareTo`, 표시 전엔 `setScale`로 자릿수를 고정한다.

**면접 한 줄 Q&A** — "왜 금액에 double을 쓰면 안 되나?" → "double은 IEEE 754 이진 부동소수라 0.1 같은 10진 소수를 정확히 표현하지 못하고, 곱·합 연산에서 오차가 누적돼 반올림 후 1원 단위로 틀어진다. BigDecimal 또는 최소단위 정수로 다뤄야 한다."

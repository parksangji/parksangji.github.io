---
title: "상태 코드 컬럼 설계: 매직넘버를 없애라"
date: 2023-01-22 10:30:00 +0900
categories: [Database]
tags: [status, enum, code-table, constraint, magic-number]
description: "상태값을 1·2·3 매직넘버로 두면 가독성과 무결성이 무너진다. enum·코드테이블·CHECK 제약으로 상태 컬럼을 안전하게 설계하는 법."
---

상태 코드 관리를 다루다 보면 테이블 곳곳에 `status = 1`, `status = 3` 같은 숫자가 박힌다. 짤 때는 자명해 보이지만, 6개월 뒤 `3`이 무엇이었는지 아무도 모른다. 상태 컬럼은 단순해 보여도 **가독성·무결성·확장성**이 한꺼번에 걸리는 설계 지점이다.

## 매직넘버의 세 가지 비용

`order.status = 2`라는 코드는 세 가지를 잃는다. 첫째, **가독성**: 2가 결제완료인지 배송중인지 코드만 봐선 모른다. 둘째, **무결성**: 컬럼이 그냥 `INT`라면 `99` 같은 존재하지 않는 상태도 저장된다. 셋째, **추적성**: 어떤 상태값이 실제로 쓰이는지, 어디서 분기되는지 grep으로 추적이 안 된다.

해법은 두 층으로 나뉜다. **애플리케이션 층의 enum**과 **DB 층의 제약**이다. 둘은 대체재가 아니라 보완재다.

## 1) 애플리케이션 — enum으로 의미 부여

Java라면 상태를 enum으로 정의하고, DB에는 안정적인 코드 문자열로 저장한다.

```java
public enum OrderStatus {
    PENDING("PENDING"),
    PAID("PAID"),
    SHIPPED("SHIPPED"),
    CANCELED("CANCELED");

    private final String code;
    OrderStatus(String code) { this.code = code; }
    public String code() { return code; }
}
```

저장값으로 `ordinal()`(0,1,2…)을 쓰면 안 된다. enum 상수 순서를 바꾸거나 중간에 하나 끼우는 순간 기존 데이터의 의미가 통째로 어긋난다. **반드시 명시적 코드값(문자열 또는 고정 정수)**을 매핑한다.

## 2) DB — CHECK 제약 또는 코드테이블

DB는 애플리케이션을 믿지 않는다. 배치·수기 보정·다른 서비스가 같은 테이블을 건드릴 수 있으므로, **허용 집합을 DB가 직접 강제**해야 한다.

값이 적고 거의 안 변하면 `CHECK` 제약이 가볍고 명확하다.

```sql
CREATE TABLE orders (
  id      BIGINT PRIMARY KEY,
  status  VARCHAR(20) NOT NULL
          CHECK (status IN ('PENDING','PAID','SHIPPED','CANCELED'))
);
```

값에 표시명·정렬순서·활성여부 같은 **메타데이터**가 붙거나 운영 중 추가가 잦다면 코드테이블 + FK가 낫다.

```sql
CREATE TABLE order_status_code (
  code      VARCHAR(20) PRIMARY KEY,
  label     VARCHAR(50) NOT NULL,
  sort_no   INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE orders
  ADD CONSTRAINT fk_order_status
  FOREIGN KEY (status) REFERENCES order_status_code(code);
```

FK는 존재하지 않는 상태값의 저장을 원천 차단한다. 새 상태는 코드만 추가하면 배포 없이 늘어난다.

## CHECK vs 코드테이블, 어떻게 고르나

| 기준 | CHECK 제약 | 코드테이블 + FK |
|------|-----------|----------------|
| 값 변경 빈도 | 거의 없음 | 잦음 |
| 부가 메타데이터 | 없음 | 표시명·순서 등 필요 |
| 조회 시 조인 | 불필요 | label 위해 조인 |
| 무결성 강제 | DDL 수준 | 참조 무결성 |

## 운영 함정

- **상태 전이를 컬럼이 막아주지 않는다**: 제약은 "허용된 값인가"만 본다. `SHIPPED → PENDING`처럼 말이 안 되는 역행은 막지 못한다. 전이 규칙은 서비스 계층에서 상태 머신으로 검증해야 한다.
- **이미 들어간 더러운 데이터**: CHECK·FK를 나중에 거는 순간, 기존에 들어간 비정상 상태값 때문에 DDL이 실패한다. 제약 추가 전 `SELECT DISTINCT status`로 실값 분포를 먼저 확인하고 보정한다.

## 핵심 요약

- 매직넘버는 가독성·무결성·추적성을 모두 잃는다. enum으로 의미를, DB 제약으로 무결성을 강제하라.
- enum 저장값은 `ordinal()` 금지, 고정 코드값 매핑.
- 정적이면 CHECK, 메타데이터·잦은 변경이면 코드테이블+FK.
- 허용 집합은 DB가 강제하되, 상태 전이 규칙은 서비스 계층이 책임진다.

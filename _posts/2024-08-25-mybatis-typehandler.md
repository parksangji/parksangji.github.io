---
title: "TypeHandler: enum과 컬럼 사이의 번역가"
date: 2024-08-25 10:30:00 +0900
categories: [Backend]
tags: [mybatis, typehandler, enum, serialization, jdbc-type]
description: "MyBatis 커스텀 TypeHandler로 enum을 코드값 컬럼에 저장/복원하는 법과, null·jdbcType 누락으로 매핑이 조용히 깨지는 지점."
---

코드성 컬럼을 enum과 이어붙인 주가 있었다. DB에는 `A`, `C`, `D` 같은 코드값이 들어가는데 자바에서는 의미 있는 enum으로 다루고 싶다. 이 변환을 매번 손으로 하지 않으려면 MyBatis의 TypeHandler가 필요하다.

## TypeHandler가 하는 일

MyBatis는 자바 객체와 JDBC 사이를 오갈 때 타입 변환을 `TypeHandler`에게 위임한다. 파라미터를 바인딩할 때는 `setParameter`로 자바 → JDBC, 결과를 읽을 때는 `getResult`로 JDBC → 자바 변환을 한다. 기본 핸들러는 String, int, Date 등 표준 타입을 처리하지만, **enum을 "코드값"으로 저장하는 규칙은 우리가 정의해야 한다.**

기본 제공되는 `EnumTypeHandler`는 enum의 `name()`을 그대로 문자열로 저장하고, `EnumOrdinalTypeHandler`는 순서(0,1,2)를 저장한다. 둘 다 위험하다. `name()`은 enum 상수명을 바꾸면 기존 데이터와 어긋나고, ordinal은 enum 선언 순서를 바꾸는 순간 전 데이터가 의미를 잃는다. 그래서 **명시적 코드값**을 갖는 커스텀 핸들러를 만든다.

## 코드값 enum과 커스텀 핸들러

```java
public enum OrderStatus {
    PENDING("P"), SHIPPED("S"), CANCELED("C");

    private final String code;
    OrderStatus(String code) { this.code = code; }
    public String getCode() { return code; }

    public static OrderStatus fromCode(String code) {
        for (OrderStatus s : values()) {
            if (s.code.equals(code)) return s;
        }
        throw new IllegalArgumentException("Unknown code: " + code);
    }
}
```

```java
@MappedTypes(OrderStatus.class)
public class OrderStatusTypeHandler extends BaseTypeHandler<OrderStatus> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i,
            OrderStatus param, JdbcType jdbcType) throws SQLException {
        ps.setString(i, param.getCode());   // enum → 코드값
    }

    @Override
    public OrderStatus getNullableResult(ResultSet rs, String col) throws SQLException {
        String code = rs.getString(col);
        return code == null ? null : OrderStatus.fromCode(code);  // 코드값 → enum
    }

    @Override
    public OrderStatus getNullableResult(ResultSet rs, int idx) throws SQLException {
        String code = rs.getString(idx);
        return code == null ? null : OrderStatus.fromCode(code);
    }

    @Override
    public OrderStatus getNullableResult(CallableStatement cs, int idx) throws SQLException {
        String code = cs.getString(idx);
        return code == null ? null : OrderStatus.fromCode(code);
    }
}
```

`BaseTypeHandler`를 상속하면 null 처리는 부모가 해 준다. `setNonNullParameter`와 `getNullableResult`만 채우면 된다. 등록은 설정 파일에 `<typeHandler>`로 하거나, 매핑 위치에서 `#{status, typeHandler=...}`로 지정한다.

## 운영 함정

**null + jdbcType 누락.** 파라미터가 null일 수 있는데 jdbcType을 지정하지 않으면 일부 JDBC 드라이버가 "타입을 모른다"며 예외를 던진다. nullable 컬럼에 바인딩할 땐 `#{status, jdbcType=VARCHAR}`처럼 명시한다. 이건 TypeHandler 자체 버그가 아니라 드라이버가 null의 SQL 타입을 추론하지 못해 터지는 문제다.

**조용히 깨지는 매핑.** TypeHandler가 특정 enum에 자동 적용되려면 `@MappedTypes`(자바 타입)와, 필요 시 `@MappedJdbcTypes`(컬럼 타입)가 맞아야 한다. 이게 어긋나면 MyBatis가 기본 `EnumTypeHandler`로 폴백해 `name()`을 저장하려다, 컬럼 길이를 넘거나 의미 없는 값이 들어가도 예외 없이 흘러간다. 커스텀 핸들러가 실제로 적용되는지 통합 테스트로 한 번은 확인해야 한다.

## 핵심 요약

- enum 저장은 `name()`/ordinal 대신 명시적 코드값으로 — 리네임·순서변경에 강하다.
- `BaseTypeHandler`를 상속해 변환 두 방향만 구현한다.
- nullable 컬럼은 jdbcType을 명시하지 않으면 드라이버에 따라 터진다.

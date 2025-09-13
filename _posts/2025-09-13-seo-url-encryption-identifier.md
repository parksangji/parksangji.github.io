---
title: "공개 URL에 내부 ID를 그대로 노출하지 않기"
date: 2025-09-13 10:30:00 +0900
categories: [Backend]
tags: [url-encryption, opaque-id, seo, identifier, enumeration, security]
description: "공개 페이지 URL에 순번 ID를 그대로 쓰면 누구나 전체를 훑을 수 있다. 열거 공격을 막는 불투명 식별자·암호화 설계와 그 비용·캐시까지."
---

공개로 노출되는 상세 페이지 URL을 다룬 주가 있었다. 흔한 형태는 `/company/1042` 같은 순번 ID다. 동작은 문제없다. 그러나 `1042`를 `1043`, `1044`로 바꿔가며 요청하면 누구나 전체 목록을 순서대로 긁어올 수 있다. 이게 **열거 공격(enumeration)**이다. 핵심은 공개 URL의 식별자를 **추측·증가시킬 수 없게** 만드는 것이다.

## 왜 순번 ID가 위험한가

`AUTO_INCREMENT` PK는 연속적이고 단조 증가한다. 이 성질이 URL에 그대로 새어 나가면 두 가지가 따라온다.

1. **전수 수집.** 1부터 최대값까지 훑으면 공개 데이터 전체가 손에 들어온다. robots.txt나 페이지네이션을 우회한다.
2. **규모 노출.** ID 최댓값이 곧 "데이터가 대략 몇 건인지"를 알려준다. 사업 규모가 그냥 드러난다.

인가(authorization)와는 다른 층위다. 인가는 "이 사용자가 이 자원을 볼 권한이 있는가"를 막는다. 여기서 다루는 건 **공개라서 권한 검사가 없는 자원**의 식별자를 추측 불가능하게 만드는 일이다. 둘은 보완 관계지 대체 관계가 아니다.

## 불투명 식별자 두 가지 접근

**(1) 내부 ID를 암호화해서 노출.** PK를 양방향 암호화(예: AES)해 URL에 싣고, 들어오면 복호화해 원래 ID를 얻는다. 매핑 테이블이 필요 없고 어떤 ID든 즉시 변환된다.

```java
public String toPublicId(long internalId) {
    byte[] enc = cipher.encrypt(Long.toString(internalId).getBytes(UTF_8));
    return base64Url(enc); // /company/Yk3p... 형태
}

public long toInternalId(String publicId) {
    byte[] dec = cipher.decrypt(base64UrlDecode(publicId));
    return Long.parseLong(new String(dec, UTF_8));
}
```

**(2) 추측 불가능한 토큰을 별도 컬럼으로.** 행 생성 시 랜덤 토큰(예: UUID, 또는 충분히 긴 난수)을 `public_token` 컬럼에 저장하고 URL에 쓴다. 암호화 키 관리가 없고 키 유출 시 일괄 노출 위험도 없다.

```sql
ALTER TABLE company ADD COLUMN public_token CHAR(22) NOT NULL UNIQUE; -- base62 등
-- 조회는 토큰으로
SELECT * FROM company WHERE public_token = :token;
```

대부분의 경우 (2)가 더 견고하다. 암호화는 키가 새면 전부 풀리지만, 랜덤 토큰은 행마다 독립적이고 단방향이라 토큰에서 내부 ID를 역산할 수 없다. 다만 인덱스(추가 컬럼)와 조회 한 번이 든다.

## 페이지 타입은 enum으로

공개 페이지가 여러 종류(회사 소개, 채용, 제품 등)라면 타입을 문자열로 흩뿌리지 말고 enum으로 묶는다. 경로 분기와 검증이 한곳에 모인다.

```java
public enum PublicPageType {
    OVERVIEW("overview"), CAREERS("careers"), PRODUCT("product");

    private final String path;
    PublicPageType(String path) { this.path = path; }

    public static PublicPageType from(String path) {
        return Arrays.stream(values())
            .filter(t -> t.path.equals(path))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("unknown page type"));
    }
}
```

## 운영 함정

**복호화/조회 비용과 캐시.** 매 요청마다 복호화하거나 토큰으로 DB를 한 번 더 타면 트래픽이 몰릴 때 부담이 된다. 공개 페이지는 보통 읽기 비중이 압도적이므로, `public_token → 응답` 또는 `public_token → 내부 ID`를 짧은 TTL로 캐시하면 비용이 거의 사라진다.

**불투명 ID도 만능은 아니다.** URL을 숨겨도 그 자원이 민감하면 결국 권한 검사가 필요하다. 불투명 식별자는 "열거 방지"이지 "접근 통제"가 아니다. 진짜 비공개 자원은 반드시 인가로 막아야 한다.

## 핵심 요약

- 공개 URL에 `AUTO_INCREMENT` PK를 그대로 쓰면 열거 공격과 규모 노출에 무방비다.
- 암호화보다 **행별 랜덤 토큰 컬럼**이 키 유출에 강하고 단방향이라 더 견고하다.
- 페이지 타입처럼 닫힌 집합은 enum으로 모아 검증과 분기를 일원화한다.
- 읽기 위주 공개 페이지는 토큰→ID 매핑을 캐시해 변환 비용을 없앤다.

> **면접 Q.** 불투명 식별자만으로 접근 통제가 되는가?
> **A.** 안 된다. URL을 추측 불가능하게 만들 뿐 권한 검사를 대신하지 못한다("security by obscurity"). 민감 자원은 별도의 인가가 필수다.

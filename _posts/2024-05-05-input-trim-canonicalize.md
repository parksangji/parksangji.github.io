---
title: "저장 전에 입력을 다듬는 정규화 계층"
date: 2024-05-05 10:30:00 +0900
categories: [Backend]
tags: [canonicalize, trim, normalize, input, data-quality]
description: "공백·대소문자·포맷이 들쭉날쭉한 입력이 만드는 중복과 검색 누락, 그리고 저장 직전 입력을 표준형으로 다듬는 정규화 계층 설계."
---

사용자 입력을 받아 저장하는 기능을 다룬 적이 있다. 검증(validation)에만 신경 쓰기 쉽지만, 그에 못지않게 중요한 건 **저장하기 전에 입력을 표준형으로 다듬는 일** — 정규화(canonicalization)다. 이걸 빼먹으면 데이터는 조용히 썩는다.

## 검증과 정규화는 다른 일이다

- **검증**: 입력이 규칙에 맞는지 판정한다. 통과/실패만 낸다. 값을 바꾸지 않는다.
- **정규화**: 의미가 같은 여러 표현을 *하나의 표준 형태*로 모은다. 값을 바꾼다.

`"  Alice@EXAMPLE.com "` 와 `"alice@example.com"` 은 사람 눈에 같지만 바이트로는 다르다. 정규화를 안 하면 DB에는 두 행이 들어가고, 유니크 제약은 무력해지며, 나중의 동등 비교·검색이 전부 어긋난다. 데이터 품질 문제의 상당수는 *입력 시점에 표준화하지 않은 대가*다.

## 무엇을 다듬는가

- **공백**: 앞뒤 `trim`, 내부 연속 공백 1칸으로 축약.
- **대소문자**: 케이스가 의미 없는 필드(이메일 도메인, 코드값)는 `lower`로 접는다.
- **유니코드 정규화**: 같은 글자도 코드포인트 구성이 다를 수 있다(NFC vs NFD). `é`가 단일 코드포인트일 수도, `e + ´`일 수도 있다. **NFC로 통일**하지 않으면 같은 문자열이 다르게 저장된다.
- **포맷**: 전화번호의 하이픈, 숫자의 천단위 콤마 등 표현 기호를 제거해 표준형으로.

핵심은 **정규화가 검증보다 먼저** 와야 한다는 것이다. 다듬은 값을 기준으로 검증하고 저장해야 일관된다.

```java
public final class StringCanonicalizer {

    public static String canonicalizeEmail(String raw) {
        if (raw == null) return null;
        String s = Normalizer.normalize(raw, Normalizer.Form.NFC); // 유니코드 통일
        s = s.strip();                  // 앞뒤 공백 제거
        return s.toLowerCase(Locale.ROOT); // 케이스 접기
    }

    public static String collapseSpaces(String raw) {
        if (raw == null) return null;
        return Normalizer.normalize(raw, Normalizer.Form.NFC)
                .strip()
                .replaceAll("\\s+", " "); // 내부 공백 1칸으로
    }
}
```

```java
@PostMapping("/users")
public ResponseEntity<?> create(@RequestBody UserForm form) {
    form.setEmail(StringCanonicalizer.canonicalizeEmail(form.getEmail()));
    form.setName(StringCanonicalizer.collapseSpaces(form.getName()));
    validator.validate(form);   // 다듬은 값으로 검증
    userService.save(form);
    return ResponseEntity.ok().build();
}
```

이렇게 모은 표준형 위에 `UNIQUE(email)` 제약을 걸어야 비로소 중복이 막힌다. 정규화 없는 유니크 제약은 헛돈다.

## 운영 함정

**`toLowerCase()`를 로케일 없이 호출하면 안 된다.** 터키어 로케일에서는 `'I'`가 점 없는 `'ı'`로 바뀌어(`I` ≠ `i`) 식별자 비교가 깨지는 유명한 버그가 있다. 비교용 정규화는 항상 `Locale.ROOT`를 명시한다.

**정규화를 애플리케이션에서만 하고 DB·배치·외부 연동 경로를 놓치면** 우회 입력 경로로 비표준 값이 들어와 결국 중복이 생긴다. 입력 게이트웨이를 **한 곳으로 모으거나**, DB 제약과 생성 컬럼(generated column)으로 이중 방어한다.

## 핵심 요약

- 검증은 "맞는가", 정규화는 "표준형으로 모으기"다 — 정규화가 먼저다.
- 공백·케이스·유니코드(NFC)·포맷을 표준형으로 접어야 유니크·검색·비교가 일관된다.
- `Locale.ROOT` 없는 케이스 변환은 위험하다. 입력 경로는 한 곳으로 모은다.

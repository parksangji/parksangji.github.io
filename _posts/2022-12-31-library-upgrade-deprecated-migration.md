---
title: "라이브러리를 올렸더니 컴파일이 깨졌다 — deprecated API 마이그레이션"
date: 2022-12-31 10:30:00 +0900
categories: [Java]
tags: [dependency-upgrade, deprecated-api, semver, migration, maven, compatibility]
description: "라이브러리 버전을 올리는 건 한 줄 변경처럼 보이지만 deprecated가 제거되면 빌드가 깨진다. 시맨틱 버저닝과 점진적 deprecated 대응 절차."
---

`pom.xml`에서 버전 숫자 하나를 올린다. diff는 한 줄. 그런데 빌드가 빨갛게 깨진다. `cannot find symbol`. 라이브러리 업그레이드가 한 줄짜리 작업이 아닌 이유는, **그 한 줄 뒤에 남의 코드 수천 줄의 변경이 들어오기 때문**이다. deprecated였던 API가 이번 메이저에서 제거된 것이다.

## 시맨틱 버저닝이 말하는 것

`MAJOR.MINOR.PATCH`는 약속이다.

- **PATCH**(1.2.3 → 1.2.4) — 버그 수정. 호환 깨짐 없음.
- **MINOR**(1.2.x → 1.3.0) — 기능 추가, 하위 호환 유지. 여기서 보통 **deprecated 표시**가 붙는다.
- **MAJOR**(1.x → 2.0.0) — 호환을 깨는 변경. deprecated였던 게 **제거**될 수 있다.

즉 deprecated 경고는 "다음 메이저에서 사라진다"는 예고다. MINOR에서 경고를 보고도 미뤘다가 MAJOR에서 한꺼번에 터지는 게 전형적인 사고 경로다. **경고는 미루지 말고 그 자리에서 갚는 게 싸다.**

## deprecated를 미루면 안 되는 이유

```java
// 라이브러리 1.x 시절 — 경고는 떴지만 동작은 함
@SuppressWarnings("deprecation")
Client client = new Client("https://api.example.com"); // deprecated 생성자

// 라이브러리 2.0 — 생성자가 제거됨, 컴파일 자체가 안 됨
// → 권장 대체 API로 교체해야 함
Client client = Client.builder()
        .endpoint("https://api.example.com")
        .build();
```

deprecated 어노테이션에는 보통 `@deprecated` Javadoc으로 **대체 API가 명시**되어 있다. 경고가 떴을 때 바로 대체해 두면, 메이저 업그레이드 때 그 코드는 이미 안전하다. 빚을 한 번에 갚지 않고 분산하는 것이다.

## 안전한 업그레이드 절차

1. **릴리스 노트/마이그레이션 가이드를 먼저 읽는다.** 메이저 업그레이드의 호환 깨짐(breaking change)은 거의 다 문서화돼 있다. 코드를 고치기 전에 무엇이 바뀌는지 안다.
2. **한 번에 한 라이브러리씩.** 여러 의존성을 동시에 올리면 어느 것이 깨뜨렸는지 분리가 안 된다.
3. **추이 의존성(transitive)을 확인한다.** `mvn dependency:tree`로 내가 올린 게 다른 의존성과 버전 충돌(diamond)을 일으키는지 본다.
4. **빌드 → 테스트로 회귀를 잡는다.** 컴파일 통과가 끝이 아니다. 시그니처는 같아도 동작(런타임 의미)이 바뀐 변경은 테스트만이 잡는다.

## 운영 함정

- **컴파일은 됐는데 런타임에 깨지는 경우** — 메서드 시그니처는 유지됐지만 기본 동작이 바뀐 사례(예: 기본 타임아웃, 기본 인코딩, 예외 던지는 조건). 이건 컴파일러가 못 잡으니 통합 테스트가 안전망이다.
- **`@SuppressWarnings("deprecation")` 남발** — 경고를 끄는 건 빚을 숨기는 것이지 갚는 게 아니다. 메이저 때 그대로 청구된다.

## 핵심 요약

- deprecated 경고 = "다음 MAJOR에서 제거" 예고. MINOR에서 보면 그때 갚아라.
- 한 번에 한 라이브러리, 릴리스 노트 먼저, 추이 의존성 확인.
- 컴파일 통과는 절반이다 — 동작 변경은 테스트로 잡는다.

> **면접 한 줄**: "메이저 업그레이드에서 빌드가 깨졌다, 가장 먼저 볼 것은?" → 그 라이브러리의 마이그레이션 가이드/릴리스 노트. 제거된 API와 대체 API가 거기 정리돼 있다.

---
title: "서드파티 클라이언트에 파라미터를 더할 때 응답까지 들여다보기"
date: 2026-04-14 10:30:00 +0900
categories: [Backend]
tags: [client-evolution, request-param, response-logging, backward-compatible, third-party-sdk, api-contract]
description: "소비하는 외부 클라이언트 메서드에 파라미터를 더할 때 하위호환을 지키고 응답을 검증 로깅하는 소비자 관점 설계."
---

그 주엔 이미 쓰고 있던 외부 API 클라이언트 메서드에 부가 식별 정보를 하나 더 실어 보내는 작업을 다뤘다. 외부가 이 파라미터를 받으면 더 정밀한 결과를 준다. 문제는 두 가지였다. 하나는 **이미 이 메서드를 호출하는 곳이 여러 군데**라는 점 — 시그니처를 바꾸면 전부 깨진다. 다른 하나는 **새 파라미터가 외부에서 실제로 처리됐는지** 우리가 알 길이 없다는 점이다. 외부는 그 파라미터를 무시할 수도, 다르게 해석할 수도 있다.

우리 API의 버전을 올리는 것과는 방향이 다르다. 여기서 우리는 **소비자**다. 우리가 호출하는 외부 클라이언트의 호출 시그니처를 진화시키는 관점이다.

## 하위호환을 지키며 파라미터를 더한다

기존 호출부를 깨지 않으려면 시그니처를 **확장**하되 기존 형태도 유지해야 한다. 세 가지 방법이 있다.

**1) 오버로딩** — 기존 메서드는 그대로 두고, 파라미터를 더 받는 새 메서드를 추가한다.

```java
public class ExternalApiClient {

    // 기존 호출부는 이 시그니처를 계속 쓴다
    public OpenApiResponse fetch(String identifier) {
        return fetch(identifier, null);   // 새 파라미터 없이 위임
    }

    // 확장: 부가 식별 정보를 추가로 받는다
    public OpenApiResponse fetch(String identifier, String extraId) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("id", identifier);
        if (extraId != null) {            // null이면 아예 안 싣는다
            params.put("extraId", extraId);
        }
        return call(params);
    }
}
```

핵심은 **새 파라미터가 `null`이면 요청에서 아예 빼는 것**이다. 빈 값을 실어 보내면 외부가 이를 "빈 식별자"로 오해해 결과가 달라질 수 있다. "있으면 싣고 없으면 안 싣는다"가 하위호환의 안전한 기본값이다.

**2) 빌더/파라미터 객체** — 파라미터가 더 늘어날 조짐이면 객체로 묶는다. 시그니처를 다시 안 건드려도 필드를 추가할 수 있다.

```java
public class FetchRequest {
    private final String identifier;
    private final String extraId;   // 선택 필드
    // 빌더 생략 — extraId는 미지정 시 null
}
```

오버로딩은 파라미터 한두 개일 때, 파라미터 객체는 앞으로 더 늘 때 택한다.

## 새 파라미터가 먹혔는지 응답으로 검증한다

파라미터를 보냈다고 외부가 받아들였다는 보장은 없다. 외부 계약 문서가 부정확하거나, 파라미터 이름이 틀렸거나, 외부가 조용히 무시할 수 있다. **요청만 로깅하면 절반만 본 것**이다. 새 파라미터가 결과를 바꿨는지 응답에서 확인해야 한다.

```java
private OpenApiResponse call(Map<String, String> params) {
    OpenApiResponse res = restTemplate.getForObject(buildUri(params), OpenApiResponse.class);

    // 새 파라미터를 보낸 호출이라면, 응답이 그 영향을 반영했는지 로깅
    if (params.containsKey("extraId")) {
        log.info("부가 파라미터 호출 — resultCode={} matched={} count={}",
                 res.getResultCode(),
                 res.isExtraIdEchoed(),     // 외부가 에코해 주는지
                 res.getItems().size());    // 결과 건수가 좁혀졌는지
    }
    return res;
}
```

외부가 파라미터를 **에코백**해 준다면 그 값으로 적용 여부를 직접 확인한다. 에코가 없다면 **결과의 변화**(건수가 좁혀졌는지, 더 정밀한 항목이 왔는지)로 간접 확인한다. 이 로그가 있어야 "파라미터를 추가했는데 결과가 그대로다 → 외부가 무시 중"임을 빨리 잡는다.

## 운영 함정

- **인코딩과 파라미터 순서.** 부가 파라미터에 한글·특수문자가 들어가면 URL 인코딩이 필요하다. 인코딩을 빠뜨리면 외부가 깨진 값으로 받아 조용히 무시한다 — 그래서 응답 검증 로깅이 더더욱 필요하다.
- **하위호환을 "컴파일된다"로 착각하지 마라.** 오버로딩으로 컴파일은 통과해도, 내부 위임에서 새 파라미터를 잘못 매핑하면 기존 호출의 **동작**이 바뀔 수 있다. 기존 시그니처로 호출했을 때 요청이 예전과 동일한지 테스트로 고정하라.

## 핵심 요약

- 소비하는 외부 클라이언트에 파라미터를 더할 땐 **오버로딩 또는 파라미터 객체**로 기존 호출부를 깨지 않는다. 새 값이 없으면 요청에서 **아예 뺀다**.
- 보낸 파라미터가 실제로 먹혔는지는 **응답으로 검증**한다 — 에코백 또는 결과 변화를 로깅한다.
- **면접 Q.** 외부 클라이언트 메서드에 파라미터를 추가하면서 기존 코드를 안 깨려면? **A.** 오버로딩으로 기존 시그니처를 유지하고 새 메서드로 위임하며, 선택 파라미터는 미지정 시 요청에서 제외한다. 적용 여부는 응답 로깅으로 확인한다.

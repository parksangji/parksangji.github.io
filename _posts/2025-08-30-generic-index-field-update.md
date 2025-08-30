---
title: "검색 인덱스 필드를 범용으로 갱신하는 법"
date: 2025-08-30 10:30:00 +0900
categories: [Search]
tags: [elasticsearch, partial-update, index-field, mapping, reindex, search]
mermaid: true
description: "검색 문서의 한 필드만 부분 갱신하는 범용 인터페이스 설계와, 매핑 타입·동적 매핑의 함정, 부분 갱신과 재색인의 경계."
---

그 주엔 검색 인덱스의 특정 필드 데이터를 바꾸는 로직을 다뤘다. 어떤 필드든 갱신할 수 있게 범용으로 만드는 게 목표였다. 검색 문서의 한 필드만 바꾸자고 문서를 통째로 다시 색인하면 비싸다. 핵심 지식은 "**필드 단위 부분 갱신(partial update)**과 그 한계, 그리고 언제 재색인(reindex)으로 넘어가야 하는지"의 경계다.

## 부분 갱신은 어떻게 동작하는가

검색엔진의 문서는 내부적으로 **불변(immutable)**이다. "부분 갱신"이라 불러도 실제로는 기존 문서를 읽어 변경분을 합치고 **새 문서를 다시 색인한 뒤 옛 문서를 삭제 표시(tombstone)**하는 read-modify-reindex 과정이다. 즉 비용이 0이 아니다. 다만 클라이언트가 전체 필드를 보내지 않아도 되고, 엔진이 한 번에 처리하므로 애플리케이션 왕복과 경합 창이 준다는 이점이 있다.

```mermaid
flowchart LR
    A[부분 갱신 요청<br/>변경 필드만] --> B[기존 문서 조회]
    B --> C[필드 병합]
    C --> D[새 문서 색인]
    D --> E[옛 문서 tombstone]
```

## 범용 필드 갱신 인터페이스

"어떤 필드든 갱신"을 안전하게 하려면, 호출자가 **필드 이름과 값을 맵으로 넘기고** 한곳에서 부분 갱신 API로 변환하는 얇은 추상을 둔다.

```java
public interface IndexUpdater {
    /** 문서의 일부 필드만 갱신한다. */
    void updateFields(String index, String id, Map<String, Object> fields);
}

@Component
public class SearchIndexUpdater implements IndexUpdater {

    private static final Set<String> ALLOWED =
        Set.of("status", "price", "category", "updatedAt"); // 허용 필드 화이트리스트

    public void updateFields(String index, String id, Map<String, Object> fields) {
        // 임의 필드 갱신을 막는다 — 매핑 폭발·오염 방지
        fields.keySet().forEach(k -> {
            if (!ALLOWED.contains(k))
                throw new IllegalArgumentException("허용되지 않은 필드: " + k);
        });
        searchClient.update(index, id, doc(fields)); // doc partial update
    }
}
```

```java
// 호출부: 상태만 바꾸기
indexUpdater.updateFields("product", productId, Map.of("status", "SOLD_OUT"));
// 가격과 갱신시각 동시 변경
indexUpdater.updateFields("product", productId,
    Map.of("price", 12900, "updatedAt", Instant.now().toString()));
```

여기서 **화이트리스트**가 범용화의 안전핀이다. "어떤 필드든"을 글자 그대로 허용하면 오타 필드나 의도치 않은 키가 그대로 색인돼 인덱스가 오염된다. 갱신 가능한 필드 집합을 명시해 범용성과 통제를 함께 잡는다.

## 매핑과 동적 매핑의 함정

검색엔진은 필드의 타입(text/keyword/long/date 등)을 **매핑(mapping)**으로 관리한다. 두 가지를 반드시 알아야 한다.

**첫째, 한 번 정해진 필드 타입은 못 바꾼다.** `price`를 처음에 문자열로 색인했다가 숫자 범위 정렬이 필요해지면, 그 필드의 타입을 in-place로 변경할 수 없다. **새 매핑으로 인덱스를 새로 만들고 통째로 재색인**해야 한다. 부분 갱신으로 해결되는 문제가 아니다.

**둘째, 동적 매핑(dynamic mapping)이 함정이다.** 매핑에 없던 필드를 부분 갱신으로 처음 보내면, 엔진이 값을 보고 타입을 **자동 추론**한다. 첫 문서에서 `"123"`을 보내면 그 필드가 text로 굳고, 이후 진짜 숫자를 넣어도 text로 색인돼 범위 쿼리가 깨진다. 그래서 운영 인덱스는 보통 동적 매핑을 끄거나(`strict`) 명시적 매핑을 선언한다. 화이트리스트가 여기서도 방어막이 된다.

## 부분 갱신 vs 재색인의 경계

```text
- 기존 매핑 안에서 값만 바뀐다        → 부분 갱신 (싸다)
- 필드 타입/분석기를 바꿔야 한다       → 새 인덱스 + 전체 재색인 (비싸다)
- 다수 문서를 같은 규칙으로 바꾼다     → update_by_query (서버측 일괄)
```

대량을 부분 갱신하려고 애플리케이션이 한 건씩 루프 도는 건 느리고 엔진에 부하다. 같은 조건의 다건은 엔진이 서버측에서 일괄 처리하는 `update_by_query`로 넘기는 게 맞다.

## 운영 함정

부분 갱신은 **순서 역전과 동시성 경합**에 약하다. 같은 문서에 두 부분 갱신이 동시에 가면 늦게 도착한 쪽이 먼저 도착한 변경을 덮을 수 있다. 검색엔진의 `if_seq_no`/`if_primary_term`(또는 외부 버전)으로 낙관적 동시성 제어를 걸어, 내가 읽은 버전이 그대로일 때만 갱신이 성공하게 해야 한다. 버전이 어긋나면 충돌로 실패시키고 재시도한다.

## 핵심 요약

- 부분 갱신도 내부적으론 read-modify-reindex다. 공짜가 아니지만 전체 재색인보다 싸다.
- 범용 필드 갱신은 허용 필드 화이트리스트로 인덱스 오염과 동적 매핑 추론을 막는다.
- 값만 바뀌면 부분 갱신, 타입·분석기가 바뀌면 새 인덱스 + 전체 재색인 — 이 경계를 명확히.
- Q: "필드 타입을 숫자로 바꾸고 싶은데 부분 갱신으로 되나?" → A: 안 된다. 매핑 타입은 불변이라 새 인덱스 만들고 재색인해야 한다.

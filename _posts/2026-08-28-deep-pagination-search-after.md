---
title: "딥 페이지네이션은 왜 막혀 있는가: from+size의 비용과 search_after"
date: 2026-08-28 16:20:00 +0900
series: "Elasticsearch"
categories: [Search]
tags: [elasticsearch, pagination, search-after, scroll, point-in-time, sharding, max-result-window]
description: "from+size가 샤드마다 from+size를 힙에 쌓는 구조와 max_result_window 제한의 근거, search_after·PIT·scroll의 선택 기준, 그리고 UI 결정이 곧 아키텍처 결정인 이유."
---

`from=100000&size=20`을 던지면 Elasticsearch가 거부한다.

```text
Result window is too large, from + size must be less than or equal to: [10000]
```

설정을 올리면 되는 것처럼 보이지만, 이 제한은 임의로 정한 숫자가 아니라 **분산 검색의 구조에서 나오는 비용**을 막는 안전장치다. 그 구조를 알면 올리는 게 답이 아니라는 것도 같이 보인다.

## from + size는 샤드마다 from + size를 쌓는다

핵심은 이것이다. **어느 샤드에 상위 문서가 있는지 미리 알 수 없다.** 그래서 코디네이터 노드는 모든 샤드에 "네 기준 상위 `from + size`개를 달라"고 요청해야 한다.

<div class="dp-fanout" markdown="0">
<style>
.dp-fanout{margin:1.6rem 0;overflow-x:auto}
.dp-fanout svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.dp-fanout .lbl{fill:currentColor;font-size:11px;font-weight:600}
.dp-fanout .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.dp-fanout .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.dp-fanout .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9.5px;fill:currentColor;opacity:.9}
.dp-fanout rect.box{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.4}
.dp-fanout rect.coord{fill:#1864ab;fill-opacity:.13;stroke:#1864ab;stroke-width:1.5}
.dp-fanout rect.heap{fill:#1864ab;fill-opacity:.55}
.dp-fanout .arr{stroke:currentColor;opacity:.3;stroke-width:1.3;fill:none}
:root[data-bs-theme='dark'] .dp-fanout rect.coord{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}
:root[data-bs-theme='dark'] .dp-fanout rect.heap{fill:#4dabf7;fill-opacity:.6}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .dp-fanout rect.coord{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}
:root:not([data-bs-theme]) .dp-fanout rect.heap{fill:#4dabf7;fill-opacity:.6}}
</style>
<svg viewBox="0 0 700 254" role="img" aria-label="from 9980 size 20 요청이 각 샤드에 1만 건씩 요청되어 코디네이터가 5만 건을 모아 정렬한 뒤 20건만 반환하는 구조">
  <text class="cap" x="14" y="16">요청:  from = 9,980   size = 20   →   사용자에게 보여줄 건 20건</text>

  <text class="lbl" x="14" y="48">샤드 1</text>
  <rect class="box" x="80" y="36" width="240" height="16" rx="4"/>
  <rect class="heap" x="82" y="38" width="236" height="12" rx="3"/>
  <text class="mono" x="330" y="48">상위 10,000건을 힙에 쌓는다</text>

  <text class="lbl" x="14" y="74">샤드 2</text>
  <rect class="box" x="80" y="62" width="240" height="16" rx="4"/>
  <rect class="heap" x="82" y="64" width="236" height="12" rx="3"/>
  <text class="mono" x="330" y="74">상위 10,000건</text>

  <text class="lbl" x="14" y="100">샤드 3</text>
  <rect class="box" x="80" y="88" width="240" height="16" rx="4"/>
  <rect class="heap" x="82" y="90" width="236" height="12" rx="3"/>
  <text class="mono" x="330" y="100">상위 10,000건</text>

  <text class="sub" x="14" y="124">… 샤드 5개면 총 50,000건이 네트워크로 코디네이터에 모인다</text>

  <line class="arr" x1="200" y1="132" x2="200" y2="152"/>

  <rect class="coord" x="80" y="156" width="440" height="44" rx="6"/>
  <text class="lbl" x="300" y="176" text-anchor="middle">코디네이터 노드</text>
  <text class="sub" x="300" y="192" text-anchor="middle">50,000건을 병합 정렬해서 9,981번째부터 20건만 남기고 버린다</text>

  <text class="sub" x="14" y="228">즉 20건을 위해 50,000건을 옮기고 정렬한다. 비용은 from에 비례해 선형으로 는다.</text>
  <text class="sub" x="14" y="246">힙 사용량도 같이 늘어서, 깊은 페이지 요청이 몇 개만 겹쳐도 클러스터가 위험해진다.</text>
</svg>
</div>

`index.max_result_window`의 기본값 10,000은 **그 선형 증가를 어디서 끊을지**를 정한 값이다. 올리면 당장은 되지만 비용 구조는 그대로다. 페이지가 깊어질수록 느려지고, 동시 요청이 겹치면 OOM으로 간다.

## 정렬을 뒤집는 우회 — 되지만 절반만

접근 가능 범위를 넓히는 영리한 우회가 하나 있다. **뒤쪽 페이지를 요청하면 정렬을 뒤집어서 앞쪽에서 접근**하는 것이다.

```java
if (inLastWindow) {
    long startFromEnd = totalHits - offset - size;
    from = (int) startFromEnd;
    reverseSort = true;              // 정렬 방향을 뒤집는다
}
...
if (reverseSort) Collections.reverse(results);   // 받은 뒤 다시 뒤집어 원래 순서로
```

<div class="dp-rev" markdown="0">
<style>
.dp-rev{margin:1.6rem 0;overflow-x:auto}
.dp-rev svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.dp-rev .lbl{fill:currentColor;font-size:11px;font-weight:600}
.dp-rev .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.dp-rev .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.dp-rev rect.strip{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.34}
.dp-rev rect.ok{fill:#1864ab;fill-opacity:.7}
.dp-rev rect.no{fill:currentColor;opacity:.12}
:root[data-bs-theme='dark'] .dp-rev rect.ok{fill:#4dabf7;fill-opacity:.75}
@media (prefers-color-scheme:dark){:root:not([data-bs-theme]) .dp-rev rect.ok{fill:#4dabf7;fill-opacity:.75}}
</style>
<svg viewBox="0 0 700 170" role="img" aria-label="정렬을 뒤집으면 앞 1만 건과 뒤 1만 건에 접근할 수 있지만 가운데 구간은 여전히 접근할 수 없다는 구간 표시">
  <text class="cap" x="14" y="16">전체 결과 (예: 50,000건)</text>
  <rect class="strip" x="12" y="26" width="674" height="30" rx="5"/>
  <rect class="ok" x="14" y="28" width="134" height="26" rx="4"/>
  <rect class="no" x="150" y="28" width="398" height="26"/>
  <rect class="ok" x="550" y="28" width="134" height="26" rx="4"/>

  <text class="lbl" x="81" y="78" text-anchor="middle">앞 10,000건</text>
  <text class="sub" x="81" y="94" text-anchor="middle">정방향 정렬</text>
  <text class="lbl" x="349" y="78" text-anchor="middle">접근 불가 구간</text>
  <text class="sub" x="349" y="94" text-anchor="middle">어느 방향으로도 window를 넘는다</text>
  <text class="lbl" x="617" y="78" text-anchor="middle">뒤 10,000건</text>
  <text class="sub" x="617" y="94" text-anchor="middle">역방향 정렬 후 결과 뒤집기</text>

  <text class="sub" x="14" y="132">접근 범위를 1만에서 2만으로 넓히는 실용적인 우회다. 다만 비용 구조는 그대로고,</text>
  <text class="sub" x="14" y="150">전체 건수가 2만을 넘는 순간 가운데는 여전히 못 간다. 근본 해법이 아니라 완화책이다.</text>
</svg>
</div>

## 정식 해법 — search_after

`search_after`는 **오프셋 대신 커서**를 쓴다. 직전 페이지 마지막 문서의 정렬 키 값을 넘기면, 그 값 뒤부터 이어서 읽는다. `from`은 항상 0이다.

<div class="dp-after" markdown="0">
<style>
.dp-after{margin:1.6rem 0;overflow-x:auto}
.dp-after svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.dp-after .lbl{fill:currentColor;font-size:11px;font-weight:600}
.dp-after .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.dp-after .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.dp-after .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9.5px;fill:currentColor;opacity:.9}
.dp-after .val{fill:currentColor;font-size:10.5px;font-weight:700}
.dp-after rect.bar{fill:#1864ab}
.dp-after rect.flat{fill:#4dabf7}
.dp-after .base{stroke:currentColor;opacity:.26;stroke-width:1}
.dp-after .rule{stroke:currentColor;opacity:.14;stroke-width:1}
:root[data-bs-theme='dark'] .dp-after rect.bar{fill:#1c7ed6}
:root[data-bs-theme='dark'] .dp-after rect.flat{fill:#a5d8ff}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .dp-after rect.bar{fill:#1c7ed6}
:root:not([data-bs-theme]) .dp-after rect.flat{fill:#a5d8ff}}
</style>
<svg viewBox="0 0 700 250" role="img" aria-label="from과 size 방식은 페이지가 깊어질수록 각 샤드가 쌓는 문서 수가 20에서 10020까지 늘지만 search_after는 페이지 깊이와 무관하게 20으로 일정하다는 로그 눈금 비교 그래프">
  <text class="cap" x="14" y="16">페이지 깊이에 따라 각 샤드가 힙에 쌓는 문서 수  —  가로축 로그 눈금</text>

  <text class="lbl" x="14" y="46">from + size</text>
  <text class="sub" x="14" y="62">1 페이지</text>
  <rect class="bar" x="200" y="36" width="39" height="13" rx="3"/>
  <text class="val" x="247" y="47">20</text>

  <text class="sub" x="14" y="86">100 페이지</text>
  <rect class="bar" x="200" y="76" width="300" height="13" rx="3"/>
  <text class="val" x="508" y="87">2,020</text>

  <text class="sub" x="14" y="110">500 페이지</text>
  <rect class="bar" x="200" y="100" width="390" height="13" rx="3"/>
  <text class="val" x="598" y="111">10,020</text>
  <text class="sub" x="200" y="130">여기서 max_result_window에 걸려 거부된다</text>

  <line class="rule" x1="14" y1="148" x2="686" y2="148"/>

  <text class="lbl" x="14" y="176">search_after</text>
  <text class="sub" x="14" y="192">1 페이지</text>
  <rect class="flat" x="200" y="166" width="39" height="13" rx="3"/>
  <text class="val" x="247" y="177">20</text>

  <text class="sub" x="14" y="216">500 페이지</text>
  <rect class="flat" x="200" y="206" width="39" height="13" rx="3"/>
  <text class="val" x="247" y="217">20</text>
  <text class="sub" x="287" y="217">from은 항상 0 — 커서 뒤부터 20건만 읽는다</text>

  <line class="base" x1="200" y1="232" x2="590" y2="232"/>
  <text class="sub" x="200" y="246" text-anchor="middle">10</text>
  <text class="sub" x="330" y="246" text-anchor="middle">100</text>
  <text class="sub" x="460" y="246" text-anchor="middle">1,000</text>
  <text class="sub" x="590" y="246" text-anchor="middle">10,000</text>
</svg>
</div>

비용이 페이지 깊이와 무관해진다. 대가는 **임의 페이지 점프 불가** — 순차 이동만 가능하다.

```json
{ "size": 20,
  "sort": [ { "created_at": "desc" }, { "_id": "asc" } ],
  "search_after": [ 1735689600000, "doc-8842" ]
}
```

두 가지가 필수다.

- **정렬 키가 유일해야 한다.** 마지막 정렬 필드로 `_id`처럼 고유한 값을 덧붙인다(tie-breaker). 안 그러면 같은 값에서 경계가 흔들려 누락·중복이 생긴다.
- **커서는 정렬 값이지 오프셋이 아니다.** 그래서 "3페이지에서 17페이지로 점프"가 불가능하다. 다음/이전만 된다.

정렬 안정성 자체는 [검색 결과 정렬의 안정성](/posts/search-sort-stability/)에서 따로 다뤘다.

## 네 가지 방식 비교

| 방식 | 깊이 비용 | 임의 점프 | 스냅샷 일관성 | 용도 |
|---|---|---|---|---|
| **`from` + `size`** | 선형 증가 (샤드마다 `from+size`) | 가능 | 없음 | 얕은 페이지, 페이지 번호 UI |
| **`search_after`** | 일정 | 불가 (순차만) | 없음 (PIT과 조합하면 있음) | 무한 스크롤, 더 보기 |
| **`search_after` + PIT** | 일정 | 불가 | **있음** | 페이지를 넘기는 동안 결과가 흔들리면 안 될 때 |
| **`scroll`** | 일정 | 불가 | 있음 | 전량 추출(배치·재색인). 실시간 UI용 아님 |

`scroll`은 커서 컨텍스트를 서버가 들고 있어 자원을 점유한다. 지금은 **사용자 페이지네이션에 권장되지 않고**, 대량 추출 용도로만 쓴다. 실시간 UI에는 `search_after`(+ 필요하면 PIT)가 표준이다.

**PIT(Point In Time)** 은 특정 시점의 인덱스 상태를 고정한다. 페이지를 넘기는 사이에 색인이 일어나도 결과 집합이 변하지 않는다. 대신 유지 기간 동안 세그먼트가 병합되지 못하므로 자원을 쓴다. 짧게 잡고 확실히 닫아야 한다.

```json
POST /my-index/_pit?keep_alive=1m
```

## UI 결정이 곧 아키텍처 결정이다

여기가 이 주제의 결론이다. 어떤 방식을 쓸 수 있는지는 **화면이 어떻게 생겼는지가 정한다.**

| 화면 | 필요한 것 | 쓸 수 있는 방식 |
|---|---|---|
| 페이지 번호를 눌러 점프 (`1 2 3 … 17`) | 임의 오프셋 접근, 총 페이지 수 | `from` + `size` — window 제한과 함께 살아야 한다 |
| "더 보기" / 무한 스크롤 | 다음 묶음만 | `search_after` — 제한 없음 |

> "페이지네이션을 개선해 달라"는 요구는 대개 **UI를 바꾸자는 제안**과 함께 가야 한다. 페이지 번호 UI를 유지한 채 깊은 페이지를 열어 달라는 건, 비용 구조상 열어 주면 안 되는 문을 열어 달라는 뜻이다.
{: .prompt-warning }

현실적인 타협도 있다. 페이지 번호 UI를 유지하되 **접근 가능한 페이지 수를 제한**하고(검색 결과 상위 N건만), 더 깊이 보려면 **필터를 좁히도록 유도**하는 방식이다. 실제로 대부분의 검색 서비스가 이렇게 한다 — 깊은 페이지를 진짜로 보는 사용자는 거의 없고, 있다면 그건 검색이 실패했다는 신호에 가깝다.

## 운영 함정

**함정 1 — `max_result_window`를 올려서 해결하기.** 제한은 원인이 아니라 방어선이다. 올리면 비용이 그대로 드러날 뿐이고, 동시 요청이 겹치면 힙이 터진다.

**함정 2 — `search_after`에 tie-breaker를 안 넣기.** 정렬 값이 같은 문서가 있으면 경계에서 누락·중복이 생긴다. `_id` 같은 고유 필드를 마지막 정렬 키로 붙인다.

**함정 3 — `scroll`을 사용자 페이지네이션에 쓰기.** 서버가 컨텍스트를 유지해 자원을 점유한다. 전량 추출 전용이다.

**함정 4 — 총 건수를 정확한 값으로 믿기.** `track_total_hits`는 기본적으로 10,000에서 끊긴다(`"relation": "gte"`). 정확한 값이 필요하면 `track_total_hits: true`를 켜야 하고, 그건 다시 비용이다.

## 면접 한 줄 Q&A

- **Q. `from + size`가 깊어지면 왜 느린가?** A. 어느 샤드에 상위 문서가 있는지 모르므로 **모든 샤드가 각자 `from + size`개를 힙에 쌓아** 코디네이터로 보낸다. 코디네이터는 그걸 다 병합 정렬한 뒤 `size`개만 남기고 버린다. 비용이 `from`에 선형으로 는다.
- **Q. `max_result_window` 10,000을 올리면 되지 않나?** A. 제한은 원인이 아니라 방어선이다. 올려도 비용 구조는 같고, 깊은 요청이 몇 개만 겹쳐도 힙이 위험하다.
- **Q. `search_after`는 어떻게 다른가?** A. 오프셋 대신 **직전 페이지 마지막 문서의 정렬 값을 커서로** 넘긴다. `from`이 항상 0이라 비용이 페이지 깊이와 무관하다. 대가는 임의 페이지 점프 불가다.
- **Q. `search_after`를 쓸 때 주의할 점은?** A. 정렬 키가 유일해야 한다. `_id` 같은 tie-breaker를 마지막 정렬 키로 붙이지 않으면 경계에서 누락·중복이 생긴다.
- **Q. `scroll`과 PIT의 차이는?** A. `scroll`은 서버가 커서 컨텍스트를 유지하는 전량 추출용이고, 지금 사용자 페이지네이션에는 권장되지 않는다. PIT는 시점을 고정하는 것이고 `search_after`와 조합해 페이지 간 일관성을 준다.
- **Q. 그래서 무엇을 골라야 하나?** A. UI가 정한다. 페이지 번호 점프 UI면 `from + size`와 window 제한을 받아들여야 하고, 무한 스크롤·더 보기면 `search_after`가 답이다.

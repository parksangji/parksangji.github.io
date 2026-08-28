---
title: "Elasticsearch 관련도 점수: query/filter 컨텍스트, boost, 그리고 dis_max"
date: 2026-08-28 15:40:00 +0900
series: "Elasticsearch"
categories: [Search]
tags: [elasticsearch, scoring, bm25, boost, dis-max, bool-query, relevance]
description: "filter 컨텍스트에서 boost가 무시되는 이유, boost가 절대 점수가 아니라 곱셈 계수인 탓에 우선순위 계단이 뒤집히는 구조, 그리고 dis_max와 constant_score로 계단을 보장하는 법."
---

`should` 절에 `boost`를 100, 80, 10, 1로 매겨 우선순위 계단을 만드는 건 흔한 패턴이다. 문제는 **그 계단이 생각대로 서지 않는 경우가 많다**는 것이다. 심지어 아예 무시되기도 한다.

원인은 두 가지다 — 점수를 아예 계산하지 않는 **컨텍스트**에 넣었거나, `boost`가 **절대 점수가 아니라 곱셈 계수**라는 걸 놓쳤거나.

`multi_match`와 정렬 사용법은 [MultiMatch와 다중 정렬](/posts/elasticsearch-multimatch-sort/)에서 다뤘다. 여기서는 점수가 만들어지는 과정 자체를 본다.

## query 컨텍스트와 filter 컨텍스트

Elasticsearch의 모든 절은 둘 중 하나의 컨텍스트에서 실행된다. **이 구분이 점수의 존재 여부를 결정한다.**

<div class="es-ctx" markdown="0">
<style>
.es-ctx{margin:1.6rem 0;overflow-x:auto}
.es-ctx svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.es-ctx .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.es-ctx .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.es-ctx .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.es-ctx .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;fill:currentColor;opacity:.9}
.es-ctx rect.q{fill:#1864ab;fill-opacity:.13;stroke:#1864ab;stroke-width:1.5}
.es-ctx rect.f{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.4}
.es-ctx .rule{stroke:currentColor;opacity:.14;stroke-width:1}
:root[data-bs-theme='dark'] .es-ctx rect.q{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}
@media (prefers-color-scheme:dark){:root:not([data-bs-theme]) .es-ctx rect.q{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}}
</style>
<svg viewBox="0 0 700 232" role="img" aria-label="query 컨텍스트는 점수를 계산하고 filter 컨텍스트는 조건 통과 여부만 판정하며 boost가 무시된다는 비교">
  <text class="cap" x="14" y="16">query 컨텍스트  —  must / should</text>
  <rect class="q" x="12" y="26" width="322" height="106" rx="7"/>
  <text class="lbl" x="28" y="50">"얼마나 잘 맞는가"를 계산한다</text>
  <text class="sub" x="28" y="72">· 문서마다 _score를 산출</text>
  <text class="sub" x="28" y="90">· boost가 실제로 적용된다</text>
  <text class="sub" x="28" y="108">· 결과 캐시 안 됨 (점수가 문서마다 다르므로)</text>
  <text class="mono" x="28" y="126">bool.must / bool.should</text>

  <text class="cap" x="366" y="16">filter 컨텍스트  —  filter / must_not</text>
  <rect class="f" x="364" y="26" width="322" height="106" rx="7"/>
  <text class="lbl" x="380" y="50">"통과하는가"만 판정한다</text>
  <text class="sub" x="380" y="72">· 점수를 계산하지 않는다 (yes/no)</text>
  <text class="sub" x="380" y="90">· boost가 전부 무시된다</text>
  <text class="sub" x="380" y="108">· 비트셋으로 캐시 가능 → 재사용 시 빠름</text>
  <text class="mono" x="380" y="126">bool.filter / bool.must_not</text>

  <line class="rule" x1="14" y1="156" x2="686" y2="156"/>
  <text class="sub" x="14" y="178">filter에 넣은 절의 boost는 오류를 내지 않는다. 조용히 무시될 뿐이다.</text>
  <text class="sub" x="14" y="196">정렬까지 필드 기준(_score가 아님)이면 점수가 아예 쓰이지 않으므로 증상도 안 보인다.</text>
  <text class="sub" x="14" y="220">그러다 나중에 누군가 _score 정렬로 바꾸면, 잠자던 boost가 살아나면서 순서가 뒤집힌다.</text>
</svg>
</div>

```json
{ "bool": {
    "filter": [ { "bool": { "should": [
        { "prefix": { "name": { "value": "강남", "boost": 100 } } }
    ] } } ]
} }
```

이 코드는 **동작하지 않는다.** `filter` 안에 있으므로 `boost: 100`은 무시된다. 문법 오류가 아니라서 조용히 지나가고, 정렬이 필드 기준이면 아무 증상도 없다. **의도가 코드에 적혀 있는데 작동하지 않는 상태**가 남는다.

판단 기준은 명확하다.

| 이 절의 목적 | 넣을 곳 |
|---|---|
| 관련도에 기여해야 한다 (`_score` 정렬을 쓴다) | `must` 또는 `should` |
| 걸러내기만 하면 된다 (필드 정렬을 쓴다) | `filter` — 캐시 이득까지 챙긴다 |

같은 서비스라도 화면마다 다를 수 있다. 관련도순 검색 화면은 `must` + `_score` 정렬, 마감일순 목록은 `filter` + 필드 정렬 — 이 조합이 자연스럽다. **모듈마다 다르게 가는 게 잘못이 아니라, 다르다는 걸 모르고 공통 유틸을 공유하는 게 사고의 원인이다.**

## boost는 절대 점수가 아니라 곱셈 계수다

`must`/`should`에 제대로 넣었다고 해도 계단이 보장되지 않는다. `boost`는 **"이 절의 점수를 N점으로 만들라"가 아니라 "이 절이 낸 점수에 N을 곱하라"** 이기 때문이다.

그리고 절 종류에 따라 **곱해지는 원본 점수가 다르다.**

<div class="es-boost" markdown="0">
<style>
.es-boost{margin:1.6rem 0;overflow-x:auto}
.es-boost svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.es-boost .lbl{fill:currentColor;font-size:11px;font-weight:600}
.es-boost .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.es-boost .val{fill:currentColor;font-size:11px;font-weight:700}
.es-boost .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.es-boost .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9.5px;fill:currentColor;opacity:.85}
.es-boost rect.fixed{fill:#1864ab}
.es-boost rect.vary{fill:#4dabf7}
.es-boost .base{stroke:currentColor;opacity:.26;stroke-width:1}
.es-boost .rule{stroke:currentColor;opacity:.14;stroke-width:1}
:root[data-bs-theme='dark'] .es-boost rect.fixed{fill:#1c7ed6}
:root[data-bs-theme='dark'] .es-boost rect.vary{fill:#a5d8ff}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .es-boost rect.fixed{fill:#1c7ed6}
:root:not([data-bs-theme]) .es-boost rect.vary{fill:#a5d8ff}}
</style>
<svg viewBox="0 0 700 250" role="img" aria-label="prefix와 wildcard는 고정 점수 1.0에 boost를 곱해 100점으로 고정되지만 match phrase는 변동하는 BM25 점수에 boost를 곱해 120점이 되어 의도한 계단이 뒤집히는 비교">
  <text class="cap" x="14" y="16">의도한 계단</text>
  <text class="sub" x="120" y="16">prefix 100  &gt;  wildcard 80  &gt;  phrase 10</text>

  <line class="rule" x1="14" y1="28" x2="686" y2="28"/>

  <text class="lbl" x="14" y="52">prefix (boost 100)</text>
  <rect class="fixed" x="180" y="42" width="200" height="14" rx="4"/>
  <text class="val" x="388" y="53">100</text>
  <text class="mono" x="430" y="53">constant score 1.0 × 100  — 고정</text>

  <text class="lbl" x="14" y="86">wildcard (boost 80)</text>
  <rect class="fixed" x="180" y="76" width="160" height="14" rx="4"/>
  <text class="val" x="348" y="87">80</text>
  <text class="mono" x="430" y="87">constant score 1.0 × 80  — 고정</text>

  <text class="lbl" x="14" y="120">match phrase (boost 10)</text>
  <rect class="vary" x="180" y="110" width="240" height="14" rx="4"/>
  <text class="val" x="428" y="121">120</text>
  <text class="mono" x="470" y="121">BM25 12 × 10  — 변동!</text>

  <line class="base" x1="180" y1="140" x2="480" y2="140"/>
  <text class="sub" x="180" y="154" text-anchor="middle">0</text>
  <text class="sub" x="280" y="154" text-anchor="middle">50</text>
  <text class="sub" x="380" y="154" text-anchor="middle">100</text>
  <text class="sub" x="480" y="154" text-anchor="middle">150</text>

  <text class="lbl" x="14" y="184">결과: phrase(120) &gt; prefix(100) &gt; wildcard(80) — 계단이 뒤집혔다</text>
  <text class="sub" x="14" y="206">MultiTermQuery(prefix·wildcard·fuzzy)는 constant score 1.0을 내므로 boost 값이 곧 점수가 된다.</text>
  <text class="sub" x="14" y="224">match·match_phrase는 BM25 점수를 내는데, 이 값은 term 빈도·문서 길이·필드 통계에 따라 문서마다 다르다.</text>
  <text class="sub" x="14" y="242">즉 한쪽은 고정이고 한쪽은 변동이라, boost 숫자만으로는 순서를 보장할 수 없다.</text>
</svg>
</div>

## bool.should의 점수는 매칭된 절들의 합이다

두 번째 뒤집힘 원인이 여기 있다. `should`는 매칭된 절 하나를 고르는 게 아니라 **매칭된 모든 절의 점수를 더한다.**

필드 목록을 루프 돌며 필드마다 절을 추가하는 코드가 흔한데, 이 경우 여러 필드에서 매칭된 문서는 점수가 누적된다.

<div class="es-sum" markdown="0">
<style>
.es-sum{margin:1.6rem 0;overflow-x:auto}
.es-sum svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.es-sum .lbl{fill:currentColor;font-size:11px;font-weight:600}
.es-sum .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.es-sum .val{fill:currentColor;font-size:11px;font-weight:700}
.es-sum .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.es-sum rect.p{fill:#1864ab}
.es-sum rect.p2{fill:#228be6}
.es-sum rect.p3{fill:#4dabf7}
.es-sum .rule{stroke:currentColor;opacity:.14;stroke-width:1}
:root[data-bs-theme='dark'] .es-sum rect.p{fill:#1864ab}
:root[data-bs-theme='dark'] .es-sum rect.p2{fill:#1c7ed6}
:root[data-bs-theme='dark'] .es-sum rect.p3{fill:#a5d8ff}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .es-sum rect.p{fill:#1864ab}
:root:not([data-bs-theme]) .es-sum rect.p2{fill:#1c7ed6}
:root:not([data-bs-theme]) .es-sum rect.p3{fill:#a5d8ff}}
</style>
<svg viewBox="0 0 700 216" role="img" aria-label="한 필드에 정확히 일치한 문서보다 세 필드에 애매하게 걸린 문서가 점수 합산으로 더 높아지는 구조">
  <text class="cap" x="14" y="16">bool.should — 매칭된 절의 점수를 모두 더한다</text>
  <line class="rule" x1="14" y1="26" x2="686" y2="26"/>

  <text class="lbl" x="14" y="52">문서 A</text>
  <text class="sub" x="14" y="68">이름 필드에</text>
  <text class="sub" x="14" y="82">정확히 일치</text>
  <rect class="p" x="140" y="44" width="150" height="16" rx="4"/>
  <text class="sub" x="150" y="76">prefix(이름) 100</text>
  <text class="val" x="302" y="57">100</text>

  <text class="lbl" x="14" y="122">문서 B</text>
  <text class="sub" x="14" y="138">세 필드에</text>
  <text class="sub" x="14" y="152">애매하게 걸림</text>
  <rect class="p" x="140" y="114" width="150" height="16" rx="4"/>
  <rect class="p2" x="292" y="114" width="150" height="16" rx="4"/>
  <rect class="p3" x="444" y="114" width="150" height="16" rx="4"/>
  <text class="sub" x="150" y="146">주소 100</text>
  <text class="sub" x="302" y="146">비고 100</text>
  <text class="sub" x="454" y="146">담당 100</text>
  <text class="val" x="606" y="127">300</text>

  <text class="lbl" x="14" y="186">"정확히 하나 일치"보다 "여러 필드에 걸쳐 애매하게 일치"가 3배 높은 점수를 받는다.</text>
  <text class="sub" x="14" y="206">검색 품질이 나쁘다는 신고의 상당수가 이 구조에서 나온다.</text>
</svg>
</div>

## 계단을 보장하려면

`boost` 숫자만으로는 순서를 못 만든다. 구조를 바꿔야 한다.

| 방법 | 무엇을 하나 | 언제 |
|---|---|---|
| **`dis_max` + `tie_breaker`** | 여러 절 중 **가장 높은 점수 하나**를 쓰고, 나머지는 `tie_breaker` 비율만큼만 더한다 | 여러 필드에 같은 검색어를 걸 때 (합산 누적 방지) |
| **`constant_score`** | 절의 점수를 지정한 값으로 **고정**한다. BM25 변동을 없앤다 | 계단을 숫자로 확정하고 싶을 때 |
| **`multi_match` (`best_fields`)** | 내부적으로 `dis_max`로 동작한다 | 필드별 절을 직접 만들 이유가 없을 때 |
| **`function_score` / `rescore`** | 상위 N건만 다시 점수 매김 | 비싼 재랭킹을 상위에만 적용할 때 |

```json
{ "dis_max": {
    "tie_breaker": 0.3,
    "queries": [
      { "constant_score": { "filter": { "prefix": { "name": "강남" } }, "boost": 100 } },
      { "constant_score": { "filter": { "match_phrase": { "address": "강남" } }, "boost": 80 } }
    ]
} }
```

`constant_score`로 감싸면 BM25 변동이 사라져 `boost` 값이 곧 점수가 되고, `dis_max`가 합산 누적을 막는다. 이러면 **의도한 계단이 실제로 선다.**

> 점수가 왜 그렇게 나왔는지 모르겠으면 `_explain` API를 쓴다. 문서 하나에 대해 각 절이 얼마를 냈고 어떻게 합쳐졌는지 트리로 보여준다. 추측하지 말고 열어보는 게 빠르다.
{: .prompt-tip }

```json
GET /my-index/_explain/{document_id}
{ "query": { ... } }
```

## 운영 함정

**함정 1 — `filter`에 `boost`를 넣기.** 오류가 안 나고 조용히 무시된다. 정렬이 필드 기준이면 증상도 안 보이다가, 나중에 `_score` 정렬로 바뀌는 순간 순서가 뒤집힌다.

**함정 2 — `boost` 숫자를 절대 점수로 착각하기.** 곱셈 계수다. `MultiTermQuery`는 constant score 1.0을 내지만 `match` 계열은 BM25를 내므로, 같은 `boost`라도 결과 점수가 다르다.

**함정 3 — 필드마다 `should` 절을 추가하기.** 점수가 합산돼 "여러 필드에 애매하게"가 "한 필드에 정확히"를 이긴다. `dis_max`나 `multi_match(best_fields)`를 쓴다.

**함정 4 — 모듈마다 다른 컨텍스트인데 공통 유틸을 공유하기.** 한쪽은 `_score` 정렬, 다른 쪽은 필드 정렬이면 같은 절 생성기를 쓰면 안 된다. `boost`가 한쪽에서만 의미를 갖는다.

## 면접 한 줄 Q&A

- **Q. query 컨텍스트와 filter 컨텍스트의 차이는?** A. query(`must`/`should`)는 "얼마나 잘 맞는가"를 계산해 `_score`를 내고, filter(`filter`/`must_not`)는 "통과하는가"만 판정한다. filter는 점수를 계산하지 않으므로 **`boost`가 무시되고**, 대신 비트셋으로 캐시된다.
- **Q. `boost: 100`을 주면 100점이 되나?** A. 아니다. 곱셈 계수다. `prefix`·`wildcard` 같은 `MultiTermQuery`는 constant score 1.0을 내므로 결과가 100이 되지만, `match_phrase`는 BM25 점수를 내므로 그 값에 100이 곱해진다.
- **Q. 우선순위 계단이 뒤집히는 이유는?** A. 두 가지다. 고정 점수 절과 BM25 변동 절을 같은 `boost` 체계로 섞었거나, `bool.should`가 매칭된 모든 절의 점수를 **합산**하기 때문이다.
- **Q. 계단을 보장하려면?** A. `constant_score`로 점수를 고정하고 `dis_max` + `tie_breaker`로 합산 누적을 막는다. 여러 필드에 같은 검색어를 거는 경우라면 `multi_match`의 `best_fields`가 내부적으로 같은 일을 한다.
- **Q. 점수가 왜 이렇게 나왔는지 확인하려면?** A. `_explain` API로 문서 하나에 대해 각 절의 기여를 트리로 확인한다.

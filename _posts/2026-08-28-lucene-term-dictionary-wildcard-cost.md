---
title: "Lucene은 질의를 어떻게 실행하는가: term dictionary와 와일드카드의 비용"
date: 2026-08-28 14:50:00 +0900
series: "Elasticsearch"
categories: [Search]
tags: [elasticsearch, lucene, term-dictionary, fst, wildcard, ngram, inverted-index]
description: "와일드카드가 AutomatonQuery로 컴파일되어 term dictionary와 교차하는 과정, 선행 와일드카드가 전수 스캔이 되는 이유, 그리고 색인 시점으로 비용을 옮기는 세 가지 처방."
---

검색엔진으로 옮겼는데도 느린 질의가 있다. 대표가 `*강남*` 같은 **선행 와일드카드**다. 왜 이것만 유독 비싼지는 Lucene이 질의를 실행하는 방식을 봐야 설명된다. 이 글은 역색인의 구조에서 출발해 와일드카드의 비용 모델까지 내려간다.

역색인 자체의 기본 개념은 [Elasticsearch 역색인 구조](/posts/elasticsearch-inverted-index/)에서, `wildcard` 쿼리를 쓸 때의 주의는 [doc_values와 wildcard 쿼리](/posts/elasticsearch-doc-values-wildcard/)에서 다뤘다. 여기서는 그 아래 — **term dictionary가 어떤 자료구조이고 질의가 그것과 어떻게 만나는지**를 본다.

## 역색인은 두 부분이다

역색인이라고 하면 보통 "단어 → 문서 목록"만 떠올리는데, 실제로는 **두 개의 자료구조**다. 질의 비용은 대부분 앞쪽에서 결정된다.

<div class="lc-inv" markdown="0">
<style>
.lc-inv{margin:1.6rem 0;overflow-x:auto}
.lc-inv svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lc-inv .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.lc-inv .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.lc-inv .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.lc-inv .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;fill:currentColor;opacity:.9}
.lc-inv rect.box{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.35}
.lc-inv rect.td{fill:#1864ab;fill-opacity:.13;stroke:#1864ab;stroke-width:1.5}
.lc-inv rect.pl{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.45}
.lc-inv .arr{stroke:currentColor;opacity:.3;stroke-width:1.3;fill:none}
:root[data-bs-theme='dark'] .lc-inv rect.td{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}
@media (prefers-color-scheme:dark){:root:not([data-bs-theme]) .lc-inv rect.td{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}}
</style>
<svg viewBox="0 0 700 214" role="img" aria-label="역색인은 term dictionary와 posting list 두 부분으로 나뉘며 질의 비용은 term dictionary를 어떻게 탐색하느냐에서 결정된다는 구조도">
  <text class="cap" x="14" y="16">① term dictionary — 어떤 단어가 존재하는가</text>
  <rect class="td" x="12" y="26" width="316" height="96" rx="7"/>
  <text class="sub" x="28" y="46">정렬된 term 집합을 FST(유한 상태 변환기)로 압축 저장</text>
  <text class="mono" x="28" y="68">강남 · 강남구 · 강남대로 · 강동 · 강서 · 개포 …</text>
  <text class="sub" x="28" y="90">term 하나를 찾거나, 특정 구간을 순회할 수 있다</text>
  <text class="sub" x="28" y="108">질의 비용의 대부분이 여기서 갈린다</text>

  <line class="arr" x1="328" y1="74" x2="368" y2="74"/>
  <text class="sub" x="348" y="66" text-anchor="middle">→</text>

  <text class="cap" x="370" y="16">② posting list — 그 단어가 어디 있는가</text>
  <rect class="pl" x="368" y="26" width="318" height="96" rx="7"/>
  <text class="mono" x="384" y="50">"강남"  → [3, 17, 42, 88, …]</text>
  <text class="mono" x="384" y="72">"강동"  → [5, 61, …]</text>
  <text class="sub" x="384" y="96">문서 ID 목록. 찾은 term 수에 비례해 읽는다</text>

  <text class="sub" x="14" y="156">term 하나를 정확히 아는 질의(term query)는 ①에서 한 번 찾고 ②를 읽으면 끝이다.</text>
  <text class="sub" x="14" y="174">문제는 term을 모르는 질의 — 와일드카드·정규식·퍼지 — 다. ①을 얼마나 방문해야 하는지가 비용이 된다.</text>
  <text class="sub" x="14" y="200">그리고 인덱스는 하나가 아니다. 세그먼트마다 자기 역색인을 갖는다.</text>
</svg>
</div>

## 와일드카드는 오토마톤으로 컴파일된다

`wildcard`, `regexp`, `fuzzy` 같은 질의는 **`MultiTermQuery`** 계열이고, 내부적으로 **`AutomatonQuery`** 로 컴파일된다. 절차는 이렇다.

1. 패턴을 **DFA(결정적 유한 오토마톤)** 로 만든다
2. 그 DFA를 필드의 **term dictionary(FST)와 교차**시킨다
3. 매칭된 term들을 모아 각각의 posting list를 합친다

여기서 비용을 가르는 건 단 하나 — **패턴 앞쪽에 고정된 접두사가 있는가**다.

<div class="lc-wc" markdown="0">
<style>
.lc-wc{margin:1.6rem 0;overflow-x:auto}
.lc-wc svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lc-wc .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.lc-wc .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.lc-wc .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;fill:currentColor}
.lc-wc .tagok{fill:currentColor;font-size:10px;font-weight:700}
.lc-wc rect.strip{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.34}
.lc-wc rect.seek{fill:#1864ab}
.lc-wc rect.scan{fill:#1864ab;fill-opacity:.9}
.lc-wc rect.cell{fill:currentColor;opacity:.13}
:root[data-bs-theme='dark'] .lc-wc rect.seek{fill:#4dabf7}
:root[data-bs-theme='dark'] .lc-wc rect.scan{fill:#4dabf7;fill-opacity:.9}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .lc-wc rect.seek{fill:#4dabf7}
:root:not([data-bs-theme]) .lc-wc rect.scan{fill:#4dabf7;fill-opacity:.9}}
</style>
<svg viewBox="0 0 700 238" role="img" aria-label="접두사가 있는 패턴은 term dictionary의 해당 구간만 방문하지만 선행 와일드카드는 term dictionary 전체를 방문해야 한다는 비교">
  <text class="sub" x="14" y="16">term dictionary (정렬된 term 전체)</text>

  <text class="mono" x="14" y="52">"강남*"</text>
  <text class="sub" x="14" y="68">접두사 있음</text>
  <rect class="strip" x="128" y="36" width="500" height="22" rx="4"/>
  <rect class="cell" x="130" y="38" width="60" height="18"/>
  <rect class="seek" x="192" y="38" width="74" height="18"/>
  <rect class="cell" x="268" y="38" width="358" height="18"/>
  <text class="tagok" x="640" y="52">방문 구간만</text>
  <text class="sub" x="128" y="76">FST를 '강남'으로 seek → 그 지점부터 접두사가 깨질 때까지만 순회</text>

  <text class="mono" x="14" y="130">"*강남*"</text>
  <text class="sub" x="14" y="146">접두사 없음</text>
  <rect class="strip" x="128" y="114" width="500" height="22" rx="4"/>
  <rect class="scan" x="130" y="116" width="496" height="18"/>
  <text class="tagok" x="640" y="130">전수 방문</text>
  <text class="sub" x="128" y="154">시작점을 특정할 수 없다 → 모든 term을 DFA에 하나씩 통과시킨다</text>

  <text class="sub" x="14" y="192">공백을 제거한 값 전체가 하나의 term인 필드(예: `.nospace`)에서는 —</text>
  <text class="lbl" x="14" y="212">고유 term 수 ≈ 고유 문서 값 수 ≈ 문서 수</text>
  <text class="sub" x="14" y="232">즉 term dictionary 전수 방문은 사실상 문서 수만큼의 검사와 같아진다.</text>
</svg>
</div>

## 비용은 필드 수와 세그먼트 수만큼 곱해진다

여기가 실제로 아픈 지점이다. 인덱스는 **세그먼트**들로 나뉘어 있고, 세그먼트마다 자기 term dictionary를 갖는다. 그리고 검색은 보통 여러 필드에 동시에 건다.

<div class="lc-mult" markdown="0">
<style>
.lc-mult{margin:1.6rem 0;overflow-x:auto}
.lc-mult svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lc-mult .lbl{fill:currentColor;font-size:11px;font-weight:600}
.lc-mult .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.lc-mult .big{fill:currentColor;font-size:13px;font-weight:700}
.lc-mult rect.seg{fill:#1864ab;fill-opacity:.22;stroke:#1864ab;stroke-width:1}
.lc-mult .rule{stroke:currentColor;opacity:.14;stroke-width:1}
:root[data-bs-theme='dark'] .lc-mult rect.seg{fill:#4dabf7;fill-opacity:.26;stroke:#4dabf7}
@media (prefers-color-scheme:dark){:root:not([data-bs-theme]) .lc-mult rect.seg{fill:#4dabf7;fill-opacity:.26;stroke:#4dabf7}}
</style>
<svg viewBox="0 0 700 196" role="img" aria-label="필드 5개와 세그먼트 10개면 term dictionary 전수 스캔이 50회 일어난다는 격자 표현">
  <text class="lbl" x="14" y="18">필드 5개 × 세그먼트 10개 = term dictionary 전수 스캔 50회</text>
  <text class="sub" x="14" y="34">칸 하나 = 한 필드의 한 세그먼트에 대한 전수 방문</text>
  <g>
    <rect class="seg" x="14" y="46" width="58" height="16" rx="3"/><rect class="seg" x="76" y="46" width="58" height="16" rx="3"/>
    <rect class="seg" x="138" y="46" width="58" height="16" rx="3"/><rect class="seg" x="200" y="46" width="58" height="16" rx="3"/>
    <rect class="seg" x="262" y="46" width="58" height="16" rx="3"/><rect class="seg" x="324" y="46" width="58" height="16" rx="3"/>
    <rect class="seg" x="386" y="46" width="58" height="16" rx="3"/><rect class="seg" x="448" y="46" width="58" height="16" rx="3"/>
    <rect class="seg" x="510" y="46" width="58" height="16" rx="3"/><rect class="seg" x="572" y="46" width="58" height="16" rx="3"/>
    <text class="sub" x="640" y="59">필드 1</text>
  </g>
  <g>
    <rect class="seg" x="14" y="68" width="58" height="16" rx="3"/><rect class="seg" x="76" y="68" width="58" height="16" rx="3"/>
    <rect class="seg" x="138" y="68" width="58" height="16" rx="3"/><rect class="seg" x="200" y="68" width="58" height="16" rx="3"/>
    <rect class="seg" x="262" y="68" width="58" height="16" rx="3"/><rect class="seg" x="324" y="68" width="58" height="16" rx="3"/>
    <rect class="seg" x="386" y="68" width="58" height="16" rx="3"/><rect class="seg" x="448" y="68" width="58" height="16" rx="3"/>
    <rect class="seg" x="510" y="68" width="58" height="16" rx="3"/><rect class="seg" x="572" y="68" width="58" height="16" rx="3"/>
    <text class="sub" x="640" y="81">필드 2</text>
  </g>
  <g>
    <rect class="seg" x="14" y="90" width="58" height="16" rx="3"/><rect class="seg" x="76" y="90" width="58" height="16" rx="3"/>
    <rect class="seg" x="138" y="90" width="58" height="16" rx="3"/><rect class="seg" x="200" y="90" width="58" height="16" rx="3"/>
    <rect class="seg" x="262" y="90" width="58" height="16" rx="3"/><rect class="seg" x="324" y="90" width="58" height="16" rx="3"/>
    <rect class="seg" x="386" y="90" width="58" height="16" rx="3"/><rect class="seg" x="448" y="90" width="58" height="16" rx="3"/>
    <rect class="seg" x="510" y="90" width="58" height="16" rx="3"/><rect class="seg" x="572" y="90" width="58" height="16" rx="3"/>
    <text class="sub" x="640" y="103">필드 3</text>
  </g>
  <g>
    <rect class="seg" x="14" y="112" width="58" height="16" rx="3"/><rect class="seg" x="76" y="112" width="58" height="16" rx="3"/>
    <rect class="seg" x="138" y="112" width="58" height="16" rx="3"/><rect class="seg" x="200" y="112" width="58" height="16" rx="3"/>
    <rect class="seg" x="262" y="112" width="58" height="16" rx="3"/><rect class="seg" x="324" y="112" width="58" height="16" rx="3"/>
    <rect class="seg" x="386" y="112" width="58" height="16" rx="3"/><rect class="seg" x="448" y="112" width="58" height="16" rx="3"/>
    <rect class="seg" x="510" y="112" width="58" height="16" rx="3"/><rect class="seg" x="572" y="112" width="58" height="16" rx="3"/>
    <text class="sub" x="640" y="125">필드 4</text>
  </g>
  <g>
    <rect class="seg" x="14" y="134" width="58" height="16" rx="3"/><rect class="seg" x="76" y="134" width="58" height="16" rx="3"/>
    <rect class="seg" x="138" y="134" width="58" height="16" rx="3"/><rect class="seg" x="200" y="134" width="58" height="16" rx="3"/>
    <rect class="seg" x="262" y="134" width="58" height="16" rx="3"/><rect class="seg" x="324" y="134" width="58" height="16" rx="3"/>
    <rect class="seg" x="386" y="134" width="58" height="16" rx="3"/><rect class="seg" x="448" y="134" width="58" height="16" rx="3"/>
    <rect class="seg" x="510" y="134" width="58" height="16" rx="3"/><rect class="seg" x="572" y="134" width="58" height="16" rx="3"/>
    <text class="sub" x="640" y="147">필드 5</text>
  </g>
  <line class="rule" x1="14" y1="162" x2="686" y2="162"/>
  <text class="big" x="14" y="184">복잡도 = O(고유 term 수 × 필드 수 × 세그먼트 수)</text>
</svg>
</div>

즉 **엔진을 바꿨는데 O(N)이 그대로 따라온 상태**다. 관계형 DB의 전문검색에서 문제였던 게 "매칭 문서를 전부 힙에서 꺼내는" O(N)이었다면, 여기서는 "필드의 term을 전부 훑는" O(N)이다. 자료구조를 바꾼 게 아니라 **위치를 옮긴 것**이다.

반면 `prefix` 쪽은 괜찮다. 접두사가 있으니 FST seek이 되고, 방문 구간이 좁다. 문제는 선행 와일드카드 한 줄이다.

## 처방 — 조회 시점의 스캔을 색인 시점으로 옮긴다

세 가지 선택지가 있고, 대가가 각각 다르다.

| 처방 | 어떻게 | 대가 | 언제 |
|---|---|---|---|
| **① `wildcard` 필드 타입** (ES 7.9+) | 내부적으로 n-gram 인덱스 + binary doc_values를 유지. 선행 와일드카드 전용 설계 | 저장 공간 증가, 필드 추가 필요 | 드롭인 교체에 가장 가깝다 |
| **② `.ngram` 서브필드** | ngram tokenizer(`min_gram` 2~3 / `max_gram` 3~4)로 부분 문자열을 **색인 시점에** term으로 만들어 둔다. 조회는 `match` = term lookup | 인덱스 크기 수 배, `min_gram` 미만 검색어는 별도 처리 | 부분 일치가 핵심 요구사항일 때 |
| **③ 와일드카드 절 제거, prefix만** | 대부분의 검색은 실제로 접두사다 | 중간 일치를 포기 | 빼도 체감이 같다면 가장 싼 답 |

③을 먼저 검토하는 걸 권한다. 검색 로그를 보면 "삼성역~"처럼 **앞에서부터 치는 입력이 대부분**인 경우가 많다. 와일드카드 절을 빼고 A/B로 확인해서 체감 차이가 없다면, 인덱스도 안 늘리고 비용만 없앤 것이다.

②의 원리는 이 한 줄로 요약된다.

> **조회 시점에 문자열을 훑지 말고, 색인 시점에 훑어서 term으로 만들어 둔다.** 검색엔진을 쓰는 이유 자체가 이것이다. 조회 때 스캔하고 있다면 엔진의 이점을 안 쓰고 있는 것이다.
{: .prompt-tip }

n-gram의 동작은 간단하다. `min_gram=2, max_gram=3`이면 "강남구"는 색인될 때 `강남`, `남구`, `강남구`로 쪼개져 각각 term이 된다. 그러면 `*남구*` 같은 검색이 **와일드카드가 아니라 `남구`라는 term 조회**로 바뀐다. 비용은 O(term dictionary)에서 O(매칭 문서)로 떨어진다.

대신 인덱스가 커진다. term 수가 원본 대비 수 배로 늘고, `max_gram`을 키울수록 가파르게 는다. 그리고 `min_gram`보다 짧은 검색어(1글자)는 매칭되지 않으므로 별도 처리가 필요하다.

## 운영 함정

**함정 1 — `*keyword*`를 습관적으로 쓰기.** 편해서 쓰지만 term dictionary 전수 스캔이다. 필드 수와 세그먼트 수만큼 곱해진다는 걸 같이 봐야 한다.

**함정 2 — n-gram을 넣고 `max_gram`을 크게 잡기.** 인덱스 크기가 급증한다. 보통 2~3에서 시작해 실제 검색어 길이 분포를 보고 조정한다.

**함정 3 — 세그먼트 수를 무시하기.** 색인 직후 세그먼트가 많으면 같은 질의도 더 비싸다. force merge나 세그먼트 정책이 와일드카드 비용에 직접 영향을 준다.

**함정 4 — `prefix`와 `wildcard`를 같은 비용으로 취급하기.** 접두사 유무가 자릿수를 가른다. `강남*`은 싸고 `*강남*`은 비싸다.

## 면접 한 줄 Q&A

- **Q. 와일드카드 쿼리는 내부적으로 어떻게 실행되나?** A. `MultiTermQuery` 계열로 `AutomatonQuery`로 컴파일된다. 패턴을 DFA로 만들고 필드의 term dictionary(FST)와 교차시켜 매칭 term을 모은 뒤, 각 term의 posting list를 합친다.
- **Q. `강남*`과 `*강남*`의 비용 차이는?** A. 앞쪽 고정 접두사 유무다. 전자는 FST를 '강남'으로 seek해 해당 구간만 순회하고, 후자는 시작점을 특정할 수 없어 term dictionary 전체를 방문한다.
- **Q. 선행 와일드카드의 복잡도는?** A. `O(고유 term 수 × 필드 수 × 세그먼트 수)`다. 값 전체가 한 term인 필드에서는 고유 term 수가 문서 수에 가까워서 사실상 전수 검사가 된다.
- **Q. 어떻게 없애나?** A. ES `wildcard` 필드 타입, n-gram 서브필드, 또는 와일드카드 절 제거 후 prefix만. 원칙은 **조회 시점의 스캔을 색인 시점으로 옮기는 것**이다.
- **Q. n-gram의 대가는?** A. 인덱스 크기가 수 배로 는다. `max_gram`을 키울수록 가파르고, `min_gram`보다 짧은 검색어는 매칭되지 않아 별도 처리가 필요하다.

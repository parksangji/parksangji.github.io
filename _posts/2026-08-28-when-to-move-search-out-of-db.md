---
title: "전문검색을 언제 DB 밖으로 꺼내는가: 표현력의 한계와 분리의 대가"
date: 2026-08-28 14:00:00 +0900
categories: [Search]
tags: [elasticsearch, postgresql, full-text-search, architecture, trade-off, denormalization]
description: "검색엔진 분리를 성능이 아니라 질의 표현력으로 판단하는 기준과, 분리하면서 실제로 잃게 되는 일곱 가지를 증상 단위로 정리한다."
---

"DB 전문검색이 느려서 Elasticsearch로 옮겼다"는 설명은 흔하지만 약하다. 듣는 쪽에서 곧바로 되물을 수 있기 때문이다 — **"`work_mem`은 올려 봤나요? RUM 인덱스는요? 인덱스 튜닝으로는 안 됐나요?"** 그 순간 대화는 "튜닝 대안 대 분리"의 소모전이 된다.

더 정확한 기준은 성능이 아니라 **표현력**이다. 이 글은 그 기준을 세우고, 분리했을 때 실제로 무엇을 잃는지를 정리한다.

## 인덱스는 "질의 패턴을 안다"는 전제 위에 서 있다

인덱스 설계는 언제나 하나의 가정에서 출발한다. **어떤 조건으로 질의가 들어올지 안다**는 가정이다. B-tree의 컬럼 순서를 정하려면 선행 컬럼에 무엇이 오는지 알아야 하고, 부분 인덱스의 `WHERE`를 쓰려면 걸러낼 조건을 알아야 한다.

사용자 자유 입력은 이 전제를 깬다.

<div class="sx-scope" markdown="0">
<style>
.sx-scope{margin:1.6rem 0;overflow-x:auto}
.sx-scope svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.sx-scope .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.sx-scope .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.sx-scope .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55;letter-spacing:.05em}
.sx-scope .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;fill:currentColor;opacity:.85}
.sx-scope rect.closed{fill:#1864ab;fill-opacity:.13;stroke:#1864ab;stroke-width:1.5}
.sx-scope rect.open{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.32;stroke-dasharray:5 4}
.sx-scope rect.chip{fill:none;stroke:currentColor;stroke-width:1;opacity:.4}
:root[data-bs-theme='dark'] .sx-scope rect.closed{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}
@media (prefers-color-scheme:dark){:root:not([data-bs-theme]) .sx-scope rect.closed{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}}
</style>
<svg viewBox="0 0 700 250" role="img" aria-label="인덱스가 답할 수 있는 질의는 유한한 닫힌 집합이지만 사용자 자유 입력은 사전에 열거할 수 없는 열린 집합이라는 대비">
  <text class="cap" x="14" y="16">닫힌 집합 — 미리 열거할 수 있다</text>
  <rect class="closed" x="12" y="26" width="322" height="128" rx="7"/>
  <text class="lbl" x="28" y="48">인덱스가 답할 수 있는 질의</text>
  <text class="mono" x="28" y="72">status = ? AND created_at BETWEEN ? AND ?</text>
  <text class="mono" x="28" y="90">name LIKE '강남%'</text>
  <text class="mono" x="28" y="108">to_tsvector(body) @@ to_tsquery('지하철 &amp; 역세권')</text>
  <text class="sub" x="28" y="134">조건의 형태를 알기 때문에 컬럼 순서·부분 인덱스를 정할 수 있다</text>

  <text class="cap" x="366" y="16">열린 집합 — 사전에 알 수 없다</text>
  <rect class="open" x="364" y="26" width="322" height="128" rx="7"/>
  <text class="lbl" x="380" y="48">사용자가 검색창에 치는 것</text>
  <rect class="chip" x="380" y="60" width="128" height="20" rx="10"/>
  <text class="mono" x="444" y="74" text-anchor="middle">삼성역서울특별시</text>
  <rect class="chip" x="516" y="60" width="80" height="20" rx="10"/>
  <text class="mono" x="556" y="74" text-anchor="middle">종로3가</text>
  <rect class="chip" x="380" y="88" width="88" height="20" rx="10"/>
  <text class="mono" x="424" y="102" text-anchor="middle">종로 3가</text>
  <rect class="chip" x="476" y="88" width="120" height="20" rx="10"/>
  <text class="mono" x="536" y="102" text-anchor="middle">강남 아파트 신축</text>
  <text class="sub" x="380" y="134">띄어쓰기 변형·부분 일치·필드 조합이 사전에 미정</text>

  <text class="sub" x="14" y="186">왼쪽은 인덱스로 대응 가능한 질의를 유한하게 열거할 수 있다. 오른쪽은 열거가 끝나지 않는다.</text>
  <text class="sub" x="14" y="204">"삼성역서울특별시"는 두 토큰이 붙어 들어온 것이고, "종로3가"와 "종로 3가"는 같은 대상을 가리킨다.</text>
  <text class="sub" x="14" y="222">이걸 관계형 인덱스로 받으려면 컬럼 조합마다 인덱스를 늘려야 하고, 그 수는 조합적으로 늘어난다.</text>
  <text class="sub" x="14" y="240">성능 문제가 아니라 표현력 문제인 이유가 여기 있다.</text>
</svg>
</div>

> 성능은 튜닝으로 반박당할 수 있지만, **"인덱스로 표현할 수 없는 질의"는 반박당하지 않는다.** 판단 근거를 여기에 두면 논쟁이 아니라 설계 이야기가 된다.
{: .prompt-tip }

## 버틸 것인가, 분리할 것인가

두 축으로 갈린다 — **질의 형태가 닫혀 있는가**, 그리고 **관련도 순위가 화면 요구사항인가**.

| 관계형 DB로 버티는 쪽 | 검색엔진으로 분리하는 쪽 |
|---|---|
| 검색이 부가 기능이고 질의 형태가 닫혀 있다 (단순 AND/OR, 관리자 검색) | **질의 형태가 열려 있다** — 자유 입력, 필드 조합이 사전에 미정 |
| 결과가 필터링 위주이고 관련도 순위가 UX에 없다 (시간순·이름순으로 충분) | **랭킹이 제품의 일부다** — "가장 관련 있는 것부터"가 화면 요구사항 |
| 데이터가 트랜잭션과 강결합이고 read-your-writes가 필수 | **언어 처리가 필요하다** — 형태소, 동의어, 띄어쓰기 정규화, 오타 보정 |
| 운영 부담을 늘릴 여력이 없다 | 검색 트래픽이 OLTP와 자원을 경쟁한다 |

**언어 처리**가 특히 결정적이다. 한국어 주소·고유명사는 띄어쓰기가 표준화되어 있지 않고, 사용자는 붙여 쓰거나 띄어 쓰거나 일부만 친다. 형태소 분석기와 동의어 사전, 정규화 필터는 관계형 인덱스가 흉내 낼 수 있는 영역이 아니다.

반대로 **관련도 순위가 필요 없다면** 분리의 이득은 크게 줄어든다. 시간순 정렬로 충분한 목록이라면 DB의 인덱스가 훨씬 단순하고 정확하다.

## 분리하면서 무엇을 잃는가

분리는 얻는 것만 있는 선택이 아니다. **일곱 가지를 내준다.** 각각이 사용자 화면에서 어떤 증상으로 나타나는지까지 알아야 판단이 선다.

<div class="sx-cost" markdown="0">
<style>
.sx-cost{margin:1.6rem 0;overflow-x:auto}
.sx-cost svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.sx-cost .lbl{fill:currentColor;font-size:11px;font-weight:600}
.sx-cost .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.sx-cost .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.sx-cost .num{font-size:10px;font-weight:700;fill:#fff}
.sx-cost rect.box{fill:none;stroke:currentColor;stroke-width:1.3;opacity:.34}
.sx-cost rect.db{fill:#1864ab;fill-opacity:.13;stroke:#1864ab;stroke-width:1.5}
.sx-cost rect.es{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.45}
.sx-cost circle.n{fill:#1864ab}
.sx-cost .gap{stroke:currentColor;opacity:.3;stroke-width:1.4;stroke-dasharray:5 4}
:root[data-bs-theme='dark'] .sx-cost rect.db{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}
:root[data-bs-theme='dark'] .sx-cost circle.n{fill:#4dabf7}
:root[data-bs-theme='dark'] .sx-cost .num{fill:#10243a}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .sx-cost rect.db{fill:#4dabf7;fill-opacity:.17;stroke:#4dabf7}
:root:not([data-bs-theme]) .sx-cost circle.n{fill:#4dabf7}
:root:not([data-bs-theme]) .sx-cost .num{fill:#10243a}}
</style>
<svg viewBox="0 0 700 262" role="img" aria-label="관계형 DB와 검색엔진 사이의 경계에서 잃게 되는 일곱 가지 — 정합성, read-your-writes, 조인, 정확한 총건수, 깊은 페이지네이션, 장애 격리, 매핑 유연성">
  <rect class="db" x="12" y="26" width="180" height="96" rx="7"/>
  <text class="lbl" x="102" y="52" text-anchor="middle">관계형 DB</text>
  <text class="sub" x="102" y="72" text-anchor="middle">트랜잭션 · 조인</text>
  <text class="sub" x="102" y="88" text-anchor="middle">정확한 집계</text>
  <text class="sub" x="102" y="104" text-anchor="middle">읽은 즉시 반영</text>

  <line class="gap" x1="246" y1="20" x2="246" y2="128"/>
  <text class="cap" x="246" y="16" text-anchor="middle">경계</text>

  <rect class="es" x="300" y="26" width="180" height="96" rx="7"/>
  <text class="lbl" x="390" y="52" text-anchor="middle">검색엔진</text>
  <text class="sub" x="390" y="72" text-anchor="middle">역색인 · 랭킹</text>
  <text class="sub" x="390" y="88" text-anchor="middle">언어 처리</text>
  <text class="sub" x="390" y="104" text-anchor="middle">근사 집계</text>

  <text class="cap" x="14" y="152">경계를 넘으면서 내주는 것</text>
  <circle class="n" cx="24" cy="172" r="9"/><text class="num" x="24" y="176" text-anchor="middle">1</text>
  <text class="sub" x="40" y="176">정합성</text>
  <circle class="n" cx="132" cy="172" r="9"/><text class="num" x="132" y="176" text-anchor="middle">2</text>
  <text class="sub" x="148" y="176">read-your-writes</text>
  <circle class="n" cx="300" cy="172" r="9"/><text class="num" x="300" y="176" text-anchor="middle">3</text>
  <text class="sub" x="316" y="176">조인 (→ 비정규화 강제)</text>
  <circle class="n" cx="490" cy="172" r="9"/><text class="num" x="490" y="176" text-anchor="middle">4</text>
  <text class="sub" x="506" y="176">정확한 총 건수</text>

  <circle class="n" cx="24" cy="204" r="9"/><text class="num" x="24" y="208" text-anchor="middle">5</text>
  <text class="sub" x="40" y="208">깊은 페이지네이션</text>
  <circle class="n" cx="180" cy="204" r="9"/><text class="num" x="180" y="208" text-anchor="middle">6</text>
  <text class="sub" x="196" y="208">장애 격리 (검색만 죽음)</text>
  <circle class="n" cx="380" cy="204" r="9"/><text class="num" x="380" y="208" text-anchor="middle">7</text>
  <text class="sub" x="396" y="208">스키마 유연성 (매핑 변경 = 전체 재색인)</text>

  <text class="sub" x="14" y="244">얻는 것은 하나(표현력)인데 내주는 것은 일곱이다. 그래도 바꿀 값어치가 있는지가 판단의 내용이다.</text>
</svg>
</div>

| 잃는 것 | 사용자에게 보이는 증상 |
|---|---|
| **① 정합성** | 삭제된 항목이 검색에 남는다 / 수정한 이름이 검색에선 옛 이름 |
| **② read-your-writes** | 등록 직후 목록에 없다가 새로고침하면 나온다 (refresh interval 만큼의 공백) |
| **③ 조인 불가 → 비정규화 강제** | 참조하던 이름 하나가 바뀌면 그 값이 박힌 문서를 전부 재색인. 자주 바뀌는 값을 문서에 넣으면 재색인이 폭발한다 |
| **④ 총 건수가 근사값** | `cardinality`는 `precision_threshold`를 넘으면 추정치다. 총 건수가 실제와 다르고, 필터를 걸었다 풀면 숫자가 미묘하게 안 맞는다 |
| **⑤ 깊은 페이지네이션 불가** | `index.max_result_window` 기본 10,000. 사용자가 중간 페이지로 못 간다 |
| **⑥ 클러스터 장애 = 검색 전면 중단** | DB는 살아 있는데 검색만 죽는다. fallback이 없으면 빈 화면 |
| **⑦ 매핑 변경 = 전체 재색인** | 필드 타입 하나 바꾸려면 새 인덱스 + alias 전환. "간단한 필드 추가"가 반나절 작업 |

②는 특히 자주 과소평가된다. Elasticsearch는 기본 `refresh_interval`이 1초라, 색인 직후 즉시 검색되지 않는다. **등록 → 목록 이동** 같은 흐름이 있으면 사용자는 자기가 방금 만든 걸 못 본다. 등록 직후 화면만 DB에서 읽거나, 해당 요청에 한해 refresh를 강제하는 식의 우회가 필요하다.

③은 설계 단계에서 가장 크게 물린다. 검색엔진에는 조인이 없으므로 필요한 값을 문서 안에 복사해 넣어야 하는데, **그 값이 얼마나 자주 바뀌는가**가 곧 재색인 비용이 된다. 자주 바뀌는 상태값(결제 상태 같은)을 문서에 넣으면 재색인이 끝없이 돈다. 이 경우 검색은 ID만 찾고 변동 값은 DB에서 채우는 분리가 낫다.

동기화 방식 자체는 [DB와 검색엔진의 이중 쓰기 동기화](/posts/dual-write-db-and-search-sync/)에서, 읽기 경로를 옮기는 절차는 [목록 조회를 DB에서 검색엔진으로 옮길 때](/posts/search-as-source-of-truth-read/)에서 따로 다뤘다.

## 근거를 말하는 순서

같은 사실이라도 순서에 따라 설득력이 달라진다.

**약한 순서 — 성능이 주장일 때**
> "GIN 인덱스가 느렸고 Heap Recheck가 많이 발생해서 Elasticsearch로 분리했습니다."
>
> → "튜닝은 해보셨나요?"로 되받아친다. 방어에 들어가게 된다.

**강한 순서 — 표현력이 주장이고 성능이 뒷받침일 때**
> "검색 요구사항이 **인덱스로 표현 가능한 질의의 범위를 넘어섰습니다.** 주소·고유명사는 띄어쓰기 변형과 부분 일치가 기본이라 관계형 인덱스로는 조합 폭발이 되고, 관련도 순위가 화면 요구사항에 들어온 시점에 자료구조를 바꾸는 게 맞다고 판단했습니다. 성능 지표로도 같은 방향이었고요."

두 번째는 **자료구조 선택의 문제**로 프레이밍한다. 성능 수치는 주장이 아니라 뒷받침으로 쓰일 때 훨씬 강하다.

## 운영 함정

**함정 1 — 분리해도 O(N)은 따라온다.** 엔진을 바꿔도 질의를 인덱스가 답할 수 있는 형태로 표현하지 못하면 전수 검사는 그대로 남는다. 선행 와일드카드(`*강남*`)가 대표적이다. 자료구조를 바꾼 게 아니라 위치를 옮긴 것뿐이다.

**함정 2 — 부분 분리를 검토하지 않기.** 전부 옮길 필요는 없다. 검색은 ID만 반환하고 표시용 데이터는 DB에서 채우면 ①③⑦의 상당 부분이 사라진다. 대신 왕복이 한 번 는다.

**함정 3 — fallback 없이 전면 의존.** ⑥의 대비는 분리 시점에 같이 설계해야 한다. 검색이 죽으면 최소한 시간순 목록이라도 DB에서 나오게 해두는 것과, 빈 화면이 뜨는 것은 사고 등급이 다르다.

## 면접 한 줄 Q&A

- **Q. 왜 DB 전문검색으로 안 되고 검색엔진이 필요했나?** A. 성능이 아니라 **표현력** 때문이다. 인덱스 설계는 질의 패턴을 안다는 전제 위에 서는데, 사용자 자유 입력은 그 전제를 깬다. 띄어쓰기 변형과 부분 일치가 기본인 도메인에서는 관계형 인덱스가 조합 폭발이 되고, 관련도 순위가 요구사항에 들어오면 자료구조 자체를 바꿔야 한다.
- **Q. 분리하면서 무엇을 포기했나?** A. 정합성, read-your-writes, 조인(비정규화 강제), 정확한 총 건수, 깊은 페이지네이션, 장애 격리, 스키마 유연성이다. 각각에 우회책이 있고 없고를 같이 봐야 한다.
- **Q. 검색엔진에 조인이 없는데 참조 데이터는 어떻게 하나?** A. 문서에 복사해 넣는다. 판단 기준은 **그 값의 변경 빈도**다. 자주 바뀌는 값을 넣으면 재색인이 폭발하므로, 그런 값은 검색으로 ID만 찾고 DB에서 채운다.
- **Q. 등록 직후 검색이 안 되는 문제는?** A. `refresh_interval`(기본 1초) 때문에 색인 직후 즉시 검색되지 않는다. 등록 직후 화면만 DB에서 읽거나 해당 요청에 refresh를 강제한다.
- **Q. 언제는 옮기지 않는 게 맞나?** A. 검색이 부가 기능이고 질의 형태가 닫혀 있으며, 관련도 순위 없이 시간순·이름순으로 충분하고, read-your-writes가 필수인 경우다. 이때는 DB 인덱스가 더 단순하고 정확하다.

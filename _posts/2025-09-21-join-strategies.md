---
title: "조인은 어떻게 실행되는가: 중첩루프부터 해시까지"
date: 2025-09-21 10:30:00 +0900
categories: [Database]
tags: [join, nested-loop, hash-join, merge-join, optimizer, cardinality, join-order]
description: "nested loop·hash·merge 조인의 실행 원리와 비용 모델, 옵티마이저가 카디널리티 추정으로 하나를 고르는 과정, 그리고 추정이 틀렸을 때 어느 알고리즘이 어떻게 무너지는지 정리한다."
---

여러 테이블을 묶어 조회하다 보면 같은 `JOIN` 문이 어떤 날은 빠르고 어떤 날은 느린 경험을 한다. SQL은 *무엇을* 원하는지만 적을 뿐, *어떻게* 합칠지는 옵티마이저가 정한다. 그 "어떻게"가 조인 알고리즘이다.

알고리즘은 셋뿐이고, 각각 **잘하는 조건이 분명하다.** 그 조건과 비용 모델을 알면 실행계획이 블랙박스가 아니게 된다.

## 세 알고리즘의 동작 원리

<div class="jn-algo" markdown="0">
<style>
.jn-algo{margin:1.6rem 0;overflow-x:auto}
.jn-algo svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.jn-algo .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.jn-algo .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.jn-algo .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.jn-algo .cost{font-size:10.5px;font-weight:700;fill:currentColor}
.jn-algo rect.o{fill:#1864ab;fill-opacity:.55}
.jn-algo rect.i{fill:none;stroke:#1864ab;stroke-width:1.3}
.jn-algo rect.ht{fill:#1864ab;fill-opacity:.16;stroke:#1864ab;stroke-width:1.4}
.jn-algo rect.s{fill:#4dabf7;fill-opacity:.75}
.jn-algo .arr{stroke:currentColor;opacity:.3;stroke-width:1.3;fill:none}
.jn-algo .rule{stroke:currentColor;opacity:.14;stroke-width:1}
:root[data-bs-theme='dark'] .jn-algo rect.o{fill:#4dabf7;fill-opacity:.6}
:root[data-bs-theme='dark'] .jn-algo rect.i{stroke:#4dabf7}
:root[data-bs-theme='dark'] .jn-algo rect.ht{fill:#4dabf7;fill-opacity:.2;stroke:#4dabf7}
:root[data-bs-theme='dark'] .jn-algo rect.s{fill:#a5d8ff;fill-opacity:.8}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .jn-algo rect.o{fill:#4dabf7;fill-opacity:.6}
:root:not([data-bs-theme]) .jn-algo rect.i{stroke:#4dabf7}
:root:not([data-bs-theme]) .jn-algo rect.ht{fill:#4dabf7;fill-opacity:.2;stroke:#4dabf7}
:root:not([data-bs-theme]) .jn-algo rect.s{fill:#a5d8ff;fill-opacity:.8}}
</style>
<svg viewBox="0 0 700 348" role="img" aria-label="Nested Loop은 바깥 행마다 안쪽을 탐색하고, Hash Join은 작은 쪽으로 해시 테이블을 만든 뒤 큰 쪽을 훑고, Merge Join은 정렬된 양쪽을 두 포인터로 나란히 전진하며 합친다는 동작 비교">
  <text class="cap" x="14" y="16">Nested Loop — 바깥 행마다 안쪽을 탐색</text>
  <rect class="o" x="14" y="26" width="16" height="16" rx="3"/>
  <rect class="o" x="34" y="26" width="16" height="16" rx="3"/>
  <rect class="o" x="54" y="26" width="16" height="16" rx="3"/>
  <rect class="o" x="74" y="26" width="16" height="16" rx="3"/>
  <text class="sub" x="98" y="39">바깥 R행</text>
  <line class="arr" x1="22" y1="44" x2="22" y2="58"/>
  <line class="arr" x1="42" y1="44" x2="42" y2="58"/>
  <line class="arr" x1="62" y1="44" x2="62" y2="58"/>
  <line class="arr" x1="82" y1="44" x2="82" y2="58"/>
  <rect class="i" x="14" y="60" width="16" height="20" rx="3"/>
  <rect class="i" x="34" y="60" width="16" height="20" rx="3"/>
  <rect class="i" x="54" y="60" width="16" height="20" rx="3"/>
  <rect class="i" x="74" y="60" width="16" height="20" rx="3"/>
  <text class="sub" x="98" y="74">안쪽을 R번 탐색</text>
  <text class="cost" x="300" y="46">인덱스 있음:  O(R × log S)</text>
  <text class="cost" x="300" y="66">인덱스 없음:  O(R × S)</text>
  <text class="sub" x="300" y="82">첫 행이 빨리 나온다 — LIMIT과 궁합이 좋다</text>

  <line class="rule" x1="14" y1="98" x2="686" y2="98"/>

  <text class="cap" x="14" y="124">Hash Join — 작은 쪽으로 해시를 짓고, 큰 쪽을 한 번 훑는다</text>
  <text class="sub" x="14" y="146">① build (작은 쪽)</text>
  <rect class="o" x="130" y="134" width="60" height="16" rx="3"/>
  <line class="arr" x1="196" y1="142" x2="216" y2="142"/>
  <rect class="ht" x="220" y="130" width="120" height="24" rx="5"/>
  <text class="sub" x="280" y="146" text-anchor="middle">해시 테이블 (메모리)</text>
  <text class="sub" x="14" y="176">② probe (큰 쪽)</text>
  <rect class="o" x="130" y="164" width="210" height="16" rx="3"/>
  <text class="sub" x="352" y="176">훑으면서 해시를 조회</text>
  <text class="cost" x="470" y="146">O(R + S)</text>
  <text class="sub" x="470" y="164">각 테이블을 한 번씩만 읽는다</text>
  <text class="sub" x="470" y="180">등가 조인(=)에서만 쓸 수 있다</text>

  <line class="rule" x1="14" y1="196" x2="686" y2="196"/>

  <text class="cap" x="14" y="222">Merge Join — 정렬된 양쪽을 두 포인터로 나란히 전진</text>
  <text class="sub" x="14" y="248">정렬된 R</text>
  <rect class="s" x="130" y="238" width="34" height="14" rx="3"/>
  <rect class="s" x="166" y="238" width="34" height="14" rx="3"/>
  <rect class="s" x="202" y="238" width="34" height="14" rx="3"/>
  <rect class="s" x="238" y="238" width="34" height="14" rx="3"/>
  <rect class="s" x="274" y="238" width="34" height="14" rx="3"/>
  <text class="sub" x="14" y="278">정렬된 S</text>
  <rect class="s" x="130" y="268" width="34" height="14" rx="3"/>
  <rect class="s" x="166" y="268" width="34" height="14" rx="3"/>
  <rect class="s" x="202" y="268" width="34" height="14" rx="3"/>
  <rect class="s" x="238" y="268" width="34" height="14" rx="3"/>
  <rect class="s" x="274" y="268" width="34" height="14" rx="3"/>
  <line class="arr" x1="130" y1="258" x2="308" y2="258"/>
  <text class="sub" x="130" y="300">두 포인터가 한 방향으로만 전진 — 되돌아가지 않는다</text>
  <text class="cost" x="470" y="240">이미 정렬됨:  O(R + S)</text>
  <text class="cost" x="470" y="258">정렬 필요:  + O(R log R + S log S)</text>
  <text class="sub" x="470" y="276">범위 비교(&lt;, &gt;)에도 쓸 수 있다</text>

  <text class="sub" x="14" y="320">Nested Loop만 "안쪽을 반복"한다. 나머지 둘은 각 입력을 한 번씩 읽고 끝낸다 —</text>
  <text class="sub" x="14" y="338">이 차이가 추정 오류에 대한 취약성까지 가른다.</text>
</svg>
</div>

**Nested Loop**은 바깥 행마다 안쪽을 뒤진다. 안쪽을 매번 풀스캔하면 `O(R × S)`로 끔찍하지만, 조인 키에 **인덱스**가 있으면 안쪽 탐색이 인덱스 룩업으로 줄어 `O(R × log S)`가 된다. 그래서 "바깥이 작고 안쪽 조인 키에 인덱스가 있을 때" 최적이고, OLTP의 대부분이 여기 해당한다. **첫 행이 빨리 나온다**는 성질도 중요해서 `LIMIT`이 붙은 쿼리와 궁합이 좋다.

**Hash Join**은 작은 쪽(build)으로 해시 테이블을 만들고 큰 쪽(probe)을 한 번 훑는다. `O(R + S)`로 인덱스가 없어도 빠르다. 대신 **등가 조인에서만** 쓸 수 있고(해시는 `=`만 답한다), 해시 테이블 전체를 만들 때까지 **첫 행이 안 나온다.**

**Merge Join**은 양쪽을 조인 키로 정렬한 뒤 두 포인터를 동시에 전진시킨다. 이미 정렬된 입력이면 정렬 비용이 사라져 매우 효율적이다. 순서를 이용하므로 **범위 비교에도 쓸 수 있다.**

## 요약 비교

| | Nested Loop | Hash Join | Merge Join |
|---|---|---|---|
| 비용 | `O(R × log S)` (안쪽 인덱스) / `O(R × S)` (없으면) | `O(R + S)` | `O(R + S)` + 정렬 비용 |
| 조인 조건 | 모든 조건 (비등가·범위 포함) | **등가(`=`)만** | 등가 + 범위 |
| 메모리 | 거의 안 씀 | `work_mem` (해시 테이블) | `work_mem` (정렬) |
| 첫 행 | **빠르다** | 느리다 (build 완료 후) | 느리다 (정렬 완료 후) |
| 유리한 상황 | 바깥이 작고 안쪽에 인덱스 | 양쪽이 크고 인덱스 없음 | 입력이 이미 정렬돼 있음 |
| 전형적 용도 | OLTP 단건·소량 조회 | 분석·집계 쿼리 | 인덱스 순서 조인, 정렬이 어차피 필요할 때 |

**비등가 조인은 선택지가 없다.** `ON a.x <> b.x`나 `ON a.range @> b.point` 같은 조건은 해시가 답할 수 없어서 Nested Loop으로 간다. 계획에 이유 없이 Nested Loop이 보이면 조인 조건이 등가인지부터 확인한다.

## 메모리를 넘기면 무너지는 방식이 다르다

Hash Join과 Merge Join은 `work_mem`을 쓴다. 넘겼을 때의 대응이 서로 다르고, 계획에 남는 흔적도 다르다.

| 노드 | 한도 초과 시 | 계획의 흔적 |
|---|---|---|
| Hash Join | 배치로 쪼개 여러 번 처리 (grace hash join) | `Batches: N` (N &gt; 1) |
| Merge Join의 Sort | 디스크 임시 파일로 스필 | `Sort Method: external merge  Disk: N kB` |
| Nested Loop | 해당 없음 (한 행씩 흘려보냄) | — |

`Batches: 1`이면 해시가 메모리 안에 다 들어간 것이고, 그보다 크면 이미 디스크를 오가고 있다는 뜻이다. 메모리 구조와 초과 시 동작은 [실행계획은 하드웨어에서 어떻게 도는가](/posts/explain-plan-on-hardware/)에서 더 다뤘다.

## 옵티마이저는 카디널리티로 고른다

옵티마이저가 실제로 하는 일은 **각 후보 계획의 비용을 추정해 가장 싼 것을 고르는 것**이고, 그 추정의 핵심 입력이 **카디널리티**(각 단계에서 나올 행 수)다.

<div class="jn-cross" markdown="0">
<style>
.jn-cross{margin:1.6rem 0;overflow-x:auto}
.jn-cross svg{width:100%;max-width:700px;height:auto;display:block;margin:0 auto;font-family:inherit}
.jn-cross .lbl{fill:currentColor;font-size:11px;font-weight:600}
.jn-cross .sub{fill:currentColor;font-size:9.5px;opacity:.62}
.jn-cross .cap{fill:currentColor;font-size:10px;font-weight:700;opacity:.55}
.jn-cross .ax{fill:currentColor;font-size:9px;opacity:.5}
.jn-cross .grid{stroke:currentColor;opacity:.11;stroke-width:1}
.jn-cross .axis{stroke:currentColor;opacity:.28;stroke-width:1}
.jn-cross path.nl{stroke:#0b3d66;stroke-width:2.2;fill:none}
.jn-cross path.hj{stroke:#4dabf7;stroke-width:2.2;fill:none;stroke-dasharray:7 5}
.jn-cross .tnl{fill:#0b3d66;font-size:10.5px;font-weight:700}
.jn-cross .thj{fill:#4dabf7;font-size:10.5px;font-weight:700}
.jn-cross line.mark{stroke:currentColor;opacity:.4;stroke-width:1;stroke-dasharray:4 3}
:root[data-bs-theme='dark'] .jn-cross path.nl{stroke:#a5d8ff}
:root[data-bs-theme='dark'] .jn-cross path.hj{stroke:#1c7ed6}
:root[data-bs-theme='dark'] .jn-cross .tnl{fill:#a5d8ff}
:root[data-bs-theme='dark'] .jn-cross .thj{fill:#1c7ed6}
@media (prefers-color-scheme:dark){
:root:not([data-bs-theme]) .jn-cross path.nl{stroke:#a5d8ff}
:root:not([data-bs-theme]) .jn-cross path.hj{stroke:#1c7ed6}
:root:not([data-bs-theme]) .jn-cross .tnl{fill:#a5d8ff}
:root:not([data-bs-theme]) .jn-cross .thj{fill:#1c7ed6}}
</style>
<svg viewBox="0 0 700 268" role="img" aria-label="바깥 행 수가 늘수록 Nested Loop 비용은 선형으로 증가하지만 Hash Join은 초기 구축 비용 이후 거의 평평해서 어느 지점에서 교차한다는 그래프">
  <text class="cap" x="14" y="16">바깥 행 수에 따른 총비용 — 두 알고리즘의 교차점</text>

  <line class="grid" x1="80" y1="50" x2="640" y2="50"/>
  <line class="grid" x1="80" y1="100" x2="640" y2="100"/>
  <line class="grid" x1="80" y1="150" x2="640" y2="150"/>
  <line class="axis" x1="80" y1="200" x2="640" y2="200"/>
  <line class="axis" x1="80" y1="40" x2="80" y2="200"/>

  <path class="hj" d="M80 108 L640 88"/>
  <text class="thj" x="636" y="78" text-anchor="end">Hash Join (파선)</text>

  <path class="nl" d="M80 196 L640 44"/>
  <text class="tnl" x="196" y="182">Nested Loop (실선)</text>
  <text class="sub" x="196" y="196">바깥 행 수에 선형</text>

  <line class="mark" x1="453" y1="40" x2="453" y2="200"/>
  <text class="sub" x="453" y="216" text-anchor="middle">교차점</text>

  <text class="ax" x="80" y="232">바깥 행 적음</text>
  <text class="ax" x="580" y="232">바깥 행 많음</text>
  <text class="ax" x="14" y="46">비용</text>

  <text class="sub" x="14" y="256">옵티마이저가 하는 판단은 결국 "지금 바깥 행 수가 교차점의 어느 쪽인가"다. 그 행 수는 추정값이다.</text>
</svg>
</div>

Hash Join은 해시 테이블을 짓는 **구축 비용이 먼저** 들지만 이후로는 거의 평평하고, Nested Loop은 시작이 싸지만 **바깥 행 수에 선형으로** 오른다. 그래서 어느 지점에서 반드시 교차한다.

여기서 결정적인 사실이 나온다. **옵티마이저는 실제 행 수가 아니라 추정 행 수로 판단한다.** 통계가 낡았거나 컬럼 간 상관관계가 있으면 추정이 빗나가고, 교차점의 반대편 알고리즘을 고른다.

```sql
EXPLAIN ANALYZE
SELECT o.id, u.name
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.created_at >= '2025-09-01';
```

`(rows=... )`(추정)와 `(actual rows=...)`(실제)를 나란히 비교하면 어디서 어긋났는지 보인다. 실행계획의 숫자를 읽는 법은 [PostgreSQL 실행계획 읽는 법](/posts/postgresql-explain-plan-anatomy/)에, MySQL 기준 `EXPLAIN` 읽기는 [실행계획 읽는 법](/posts/explain-plan-reading/)에 정리했다.

## 추정이 틀렸을 때 무너지는 정도가 다르다

이게 실무에서 가장 중요한 비대칭이다. **같은 크기의 추정 오류라도 Nested Loop에서 훨씬 치명적이다.**

| 고른 알고리즘 | 실제가 추정보다 100배 많았다면 |
|---|---|
| **Nested Loop** | 안쪽 탐색이 **100배 더 돈다.** 100번 돌 것이 10,000번 → 시간도 100배 |
| Hash Join | probe 입력이 100배 길어진다. 여전히 한 번 훑기라 **선형** 증가에 그친다 |
| Merge Join | 정렬 대상이 100배. `work_mem`을 넘기면 스필하지만 파국은 아니다 |

Nested Loop은 **바깥 행 수가 곧 반복 횟수**라서 추정 오류가 그대로 곱해진다. "쿼리가 갑자기 100배 느려졌다"는 사고의 상당수가 이 모양이다 — 데이터가 늘었는데 통계를 갱신하지 않아 옵티마이저가 여전히 바깥을 작다고 믿고 Nested Loop을 고른 것이다.

> `EXPLAIN ANALYZE`에서 **Nested Loop 안쪽 노드의 `loops` 값**을 먼저 본다. 추정 `rows`와 자릿수가 다르면 그게 원인이다. 그리고 `loops > 1`인 노드의 `actual time`은 1회 평균이라 **곱해야 총합**이 된다.
{: .prompt-tip }

## 조인 순서가 알고리즘보다 클 때가 있다

테이블이 셋 이상이면 문제가 하나 더 붙는다. **어느 순서로 합칠 것인가.** 조인 순서의 경우의 수는 테이블 수에 대해 팩토리얼로 늘어난다.

| 테이블 수 | 가능한 조인 순서 |
|---|---|
| 3개 | 12 |
| 5개 | 1,680 |
| 8개 | 17,297,280 |

전수 탐색이 불가능해지므로 옵티마이저는 일정 개수를 넘으면 **탐색을 포기하거나 휴리스틱으로 전환**한다. PostgreSQL은 `join_collapse_limit`(기본 8)을 넘으면 `FROM`에 적힌 순서를 그대로 쓰고, `geqo_threshold`(기본 12)를 넘으면 유전 알고리즘으로 근사한다.

즉 **테이블이 많은 쿼리에서는 옵티마이저가 최적해를 찾지 않는다.** 그런 쿼리가 느리면 알고리즘을 의심하기 전에 조인 개수를 줄이거나(뷰·CTE로 분리), 선택도 높은 조건을 먼저 적용해 중간 결과를 작게 만드는 쪽을 본다.

중간 결과 크기가 왜 중요하냐면, 조인은 **아래에서 위로 결과를 물려주기** 때문이다. 첫 조인이 100만 행을 내면 그 위의 모든 노드가 100만 행을 다룬다. 조인 순서 최적화의 본질은 "중간 결과를 가능한 한 작게 유지하는 순서 찾기"다.

## 운영 함정

**함정 1 — 통계 노후화.** 대량 적재 후 통계를 갱신하지 않으면 옵티마이저가 작은 테이블로 착각해 Nested Loop을 골라 수십만 번 루프를 돈다. 적재 후 `ANALYZE`가 원칙이다.

**함정 2 — 조인 키 타입·콜레이션 불일치.** `BIGINT` 컬럼과 문자열을 조인하면 암묵적 형변환이 인덱스를 무력화한다. Nested Loop의 안쪽이 인덱스 룩업에서 풀스캔으로 퇴화해 `O(R × S)`가 된다. 양쪽 타입과 콜레이션을 반드시 맞춘다.

**함정 3 — 컬럼 간 상관관계로 인한 과소추정.** `city = '서울' AND district = '강남구'`처럼 상관된 조건들을 옵티마이저는 독립으로 가정해 선택도를 곱한다. 실제보다 훨씬 적게 추정하고, 그 결과 Nested Loop을 고른다. PostgreSQL이라면 `CREATE STATISTICS`로 다중 컬럼 통계를 만든다.

**함정 4 — 비등가 조인에 Hash를 기대하기.** 해시는 `=`만 답한다. 범위·부정 조건이면 Nested Loop밖에 없고, 그건 알고리즘 문제가 아니라 조건의 성질이다.

**함정 5 — 힌트로 알고리즘을 고정하기.** `enable_hashjoin = off` 같은 스위치는 진단용이다. 원인은 대개 추정이므로, 통계·인덱스·쿼리 구조를 고치는 게 순서다.

## 면접 한 줄 Q&A

- **Q. 세 조인 알고리즘의 차이는?** A. Nested Loop은 바깥 행마다 안쪽을 탐색하고(안쪽 인덱스가 있으면 `O(R × log S)`), Hash Join은 작은 쪽으로 해시를 지어 큰 쪽을 한 번 훑고(`O(R + S)`, 등가 조인만), Merge Join은 정렬된 양쪽을 두 포인터로 합친다(정렬돼 있으면 `O(R + S)`).
- **Q. Hash Join이 Nested Loop보다 빠른 경우는?** A. 조인 키에 인덱스가 없고 양쪽이 클 때. Nested Loop은 안쪽을 매 행마다 풀스캔해 `O(R × S)`가 되지만 Hash는 각 테이블을 한 번씩만 읽는다.
- **Q. 그런데도 Nested Loop을 고르는 이유는?** A. 바깥이 작고 안쪽에 인덱스가 있을 때 가장 싸고, **첫 행이 빨리 나와서** `LIMIT`이 붙은 쿼리에 유리하다. 비등가·범위 조인에서는 아예 선택지가 그것뿐이다.
- **Q. 추정이 틀렸을 때 왜 Nested Loop이 특히 위험한가?** A. 바깥 행 수가 곧 반복 횟수여서 오류가 그대로 곱해진다. 100배 과소추정이면 안쪽 탐색이 100배 더 돈다. Hash Join은 같은 오류에도 선형 증가에 그친다.
- **Q. `Batches: 8`은 무슨 뜻인가?** A. 해시 테이블이 `work_mem`에 안 들어가 8개 배치로 쪼개 디스크를 오가며 처리했다는 뜻이다. `Batches: 1`이 메모리 안에서 끝난 상태다.
- **Q. 테이블이 많은 쿼리가 느리면?** A. 조인 순서의 경우의 수가 팩토리얼로 늘어 옵티마이저가 최적해 탐색을 포기했을 수 있다(`join_collapse_limit`, `geqo_threshold`). 조인 개수를 줄이거나 선택도 높은 조건을 먼저 적용해 중간 결과를 작게 만든다.

---
title: "LATERAL 조인의 진짜 비용: 스코프 규칙, loops, 그리고 de-correlate"
date: 2026-08-28 13:00:00 +0900
series: "PostgreSQL"
categories: [Database]
tags: [postgresql, lateral, join, explain, covering-index, index-only-scan, vacuum]
description: "LATERAL이 성능 기능이 아니라 스코프 규칙인 이유, loops가 곱해지는 계획 읽기, 커버링 인덱스와 Visibility Map, GROUP BY de-correlate 리라이팅을 그림으로 정리한다."
---

목록 조회에서 구분 코드별로 `EXISTS`를 네 번 걸던 쿼리를 `LATERAL` 집계 한 번으로 합친 적이 있다. 결과는 빨라졌는데, "왜 빨라졌는가"를 잘못 설명하면 다음 최적화에서 반드시 틀린 선택을 하게 된다. 그 리팩터링을 처음부터 다시 뜯어본다.

도메인은 일반화해서 쓴다 — 프로젝트(`project`) 목록을 조회하면서, 매핑 테이블(`project_member`)에서 역할별 참여 여부 네 개를 플래그로 뽑는 형태다.

```sql
FROM project p
LEFT JOIN LATERAL (
    SELECT
        MAX(CASE WHEN x.role_type = 'OWNER'    THEN 1 ELSE 0 END) AS has_owner,
        MAX(CASE WHEN x.role_type = 'MANAGER'  THEN 1 ELSE 0 END) AS has_manager,
        MAX(CASE WHEN x.role_type = 'REVIEWER' THEN 1 ELSE 0 END) AS has_reviewer,
        MAX(CASE WHEN x.role_type = 'VIEWER'   THEN 1 ELSE 0 END) AS has_viewer
    FROM project_member x
    JOIN member m ON m.member_id = x.member_id
    WHERE x.project_id = p.project_id
      AND x.del_yn = 'N'
      AND m.member_name IS NOT NULL
      AND m.member_name != ''
) c ON TRUE
WHERE p.del_yn = 'N'
  AND p.project_id IN (...)
```

## 서브쿼리에는 벽이 있다 — LATERAL은 그 벽을 허문다

`LATERAL`을 "빠르게 해주는 키워드"로 알고 있으면 처음부터 틀린다. 정의는 성능과 아무 관계가 없다.

> `FROM` 절의 서브쿼리가 **자기보다 앞에 나온 `FROM` 항목의 컬럼을 참조**할 수 있게 해준다.
{: .prompt-tip }

<div class="lt-scope" markdown="0">
<style>
.lt-scope{margin:1.5rem 0;overflow-x:auto}
.lt-scope svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lt-scope .lbl{fill:currentColor;font-size:12.5px;font-weight:600}
.lt-scope .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.lt-scope .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;fill:currentColor}
.lt-scope rect.box{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.35}
.lt-scope line.wall{stroke:#e03131;stroke-width:3;opacity:.85}
.lt-scope line.open{stroke:#2f9e44;stroke-width:3;opacity:.85;stroke-dasharray:7 7}
.lt-scope .cbad{fill:#e03131;font-size:11px;font-weight:700}
.lt-scope .cok{fill:#2f9e44;font-size:11px;font-weight:700}
.lt-scope .arr{stroke:currentColor;opacity:.3;stroke-width:1.5;fill:none}
.lt-scope circle.blocked{fill:#e03131;animation:ltblk 3.4s ease-in-out infinite}
.lt-scope circle.pass{fill:#2f9e44;animation:ltpass 3.4s ease-in-out infinite}
@keyframes ltblk{0%{transform:translate(0,0);opacity:0}15%{opacity:1}45%{transform:translate(150px,0);opacity:1}58%{transform:translate(150px,0);opacity:1}62%{transform:translate(140px,0)}70%{transform:translate(150px,0)}100%{transform:translate(150px,0);opacity:0}}
@keyframes ltpass{0%{transform:translate(0,0);opacity:0}15%{opacity:1}80%{transform:translate(268px,0);opacity:1}100%{transform:translate(268px,0);opacity:0}}
</style>
<svg viewBox="0 0 720 240" role="img" aria-label="일반 서브쿼리는 바깥 FROM 항목을 참조할 수 없어 차단되고, LATERAL은 그 경계를 열어 바깥 행을 참조할 수 있게 된다는 비교">
  <text class="cbad" x="16" y="20">일반 서브쿼리 — 바깥을 볼 수 없다</text>
  <rect class="box" x="16" y="30" width="150" height="48" rx="7"/>
  <text class="lbl" x="91" y="50" text-anchor="middle">project p</text>
  <text class="sub" x="91" y="66" text-anchor="middle">바깥 FROM</text>
  <line class="wall" x1="196" y1="26" x2="196" y2="84"/>
  <rect class="box" x="226" y="30" width="210" height="48" rx="7"/>
  <text class="mono" x="331" y="50" text-anchor="middle">WHERE x.project_id = p.project_id</text>
  <text class="sub" x="331" y="66" text-anchor="middle">독립적으로 먼저 평가되어야 함</text>
  <text class="cbad" x="452" y="46">ERROR: invalid reference to</text>
  <text class="cbad" x="452" y="62">FROM-clause entry for table "p"</text>
  <circle class="blocked" cx="176" cy="54" r="5"/>

  <text class="cok" x="16" y="150">LATERAL — 경계가 열린다</text>
  <rect class="box" x="16" y="160" width="150" height="48" rx="7"/>
  <text class="lbl" x="91" y="180" text-anchor="middle">project p</text>
  <text class="sub" x="91" y="196" text-anchor="middle">바깥 FROM</text>
  <line class="open" x1="196" y1="156" x2="196" y2="214"/>
  <rect class="box" x="226" y="160" width="210" height="48" rx="7"/>
  <text class="mono" x="331" y="180" text-anchor="middle">WHERE x.project_id = p.project_id</text>
  <text class="sub" x="331" y="196" text-anchor="middle">바깥 행 하나마다 다시 평가</text>
  <text class="cok" x="452" y="176">바깥 행을 참조할 수 있다</text>
  <text class="sub" x="452" y="192">= 실행 순서가 고정된다는 뜻이기도 하다</text>
  <circle class="pass" cx="176" cy="184" r="5"/>
</svg>
</div>

그래서 `LATERAL`을 빼면 "더 느려지는" 게 아니라 **아예 실행이 안 된다.**

```text
ERROR:  invalid reference to FROM-clause entry for table "p"
HINT:   There is an entry for table "p", but it cannot be
        referenced from this part of the query.
```

그리고 하나 더 — **`LATERAL`이 일반 조인보다 본질적으로 빠른 게 아니다.** 오히려 대부분은 일반 조인이 빠르다. 일반 조인은 플래너가 Hash Join, Merge Join, 조인 순서 교체까지 자유롭게 고를 수 있지만, `LATERAL`은 "바깥 행마다 한 번"이라는 **순서가 고정된 Nested Loop**에 묶인다.

## 그럼 왜 빨라졌나 — 4번 읽던 걸 1번으로

이득의 정체는 `LATERAL`이라는 키워드가 아니라, 리팩터링이 없앤 **중복 탐색**이다.

<div class="lt-exists" markdown="0">
<style>
.lt-exists{margin:1.5rem 0;overflow-x:auto}
.lt-exists svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lt-exists .lbl{fill:currentColor;font-size:12px;font-weight:600}
.lt-exists .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.lt-exists rect.box{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.35}
.lt-exists rect.tbl{fill:none;stroke:#1971c2;stroke-width:1.6;opacity:.8}
.lt-exists .cbad{fill:#e03131;font-size:11px;font-weight:700}
.lt-exists .cok{fill:#2f9e44;font-size:11px;font-weight:700}
.lt-exists .arr4{stroke:#e03131;opacity:.55;stroke-width:1.4;fill:none}
.lt-exists .arr1{stroke:#2f9e44;opacity:.7;stroke-width:2;fill:none}
.lt-exists .scan{animation:ltsc 4s ease-in-out infinite}
.lt-exists .n1{animation-delay:0s}.lt-exists .n2{animation-delay:.35s}
.lt-exists .n3{animation-delay:.7s}.lt-exists .n4{animation-delay:1.05s}
@keyframes ltsc{0%,100%{opacity:.2}18%,42%{opacity:1}}
</style>
<svg viewBox="0 0 720 252" role="img" aria-label="EXISTS 4개는 매핑 테이블을 네 번 탐색하고 LATERAL 집계는 한 번만 탐색한다는 비교">
  <text class="cbad" x="16" y="20">EXISTS 4개 — 같은 테이블을 네 번 탐색</text>
  <rect class="box scan n1" x="16" y="30" width="88" height="24" rx="5"/>
  <text class="sub" x="60" y="46" text-anchor="middle">EXISTS OWNER</text>
  <rect class="box scan n2" x="112" y="30" width="88" height="24" rx="5"/>
  <text class="sub" x="156" y="46" text-anchor="middle">EXISTS MANAGER</text>
  <rect class="box scan n3" x="208" y="30" width="88" height="24" rx="5"/>
  <text class="sub" x="252" y="46" text-anchor="middle">EXISTS REVIEWER</text>
  <rect class="box scan n4" x="304" y="30" width="88" height="24" rx="5"/>
  <text class="sub" x="348" y="46" text-anchor="middle">EXISTS VIEWER</text>
  <path class="arr4" d="M60 54 L200 96"/>
  <path class="arr4" d="M156 54 L204 96"/>
  <path class="arr4" d="M252 54 L208 96"/>
  <path class="arr4" d="M348 54 L212 96"/>
  <rect class="tbl" x="130" y="100" width="160" height="30" rx="6"/>
  <text class="lbl" x="210" y="120" text-anchor="middle">project_member</text>
  <text class="cbad" x="310" y="120">탐색 4회</text>

  <text class="cok" x="16" y="176">LATERAL 집계 1개 — 한 번 탐색해 값 4개를 동시에</text>
  <rect class="box" x="16" y="186" width="376" height="24" rx="5"/>
  <text class="sub" x="204" y="202" text-anchor="middle">MAX(CASE WHEN role_type = … ) × 4  —  한 번의 스캔 안에서</text>
  <path class="arr1" d="M204 210 L210 226"/>
  <rect class="tbl" x="130" y="230" width="160" height="22" rx="6"/>
  <text class="sub" x="210" y="245" text-anchor="middle">project_member</text>
  <text class="cok" x="310" y="245">탐색 1회</text>
</svg>
</div>

> 이득의 정체는 "LATERAL이 빨라서"가 아니라 **"같은 데이터를 네 번 읽던 걸 한 번으로 줄여서"** 다. 면접에서 이 차이를 말하면 무게가 완전히 달라진다.
{: .prompt-info }

## ON TRUE가 붙는 이유

`LEFT JOIN`은 문법적으로 `ON` 절을 요구한다. 생략할 수 없다. 그런데 상관 조건은 이미 서브쿼리 안 `WHERE`에 들어가 있어 붙일 게 없으니, 항등식 `TRUE`를 넣는다. INNER 쪽은 생략형이 따로 있다.

```sql
CROSS JOIN LATERAL (...) c          -- ≡ JOIN LATERAL (...) c ON TRUE
LEFT  JOIN LATERAL (...) c ON TRUE  -- LEFT는 ON을 생략할 수 없음
```

## 계획에서의 모양 — loops는 곱해야 한다

`LATERAL`은 `Nested Loop Left Join`으로 나타난다. 바깥 행 하나마다 안쪽이 통째로 한 번씩 도는 구조다.

<div class="lt-loops" markdown="0">
<style>
.lt-loops{margin:1.5rem 0;overflow-x:auto}
.lt-loops svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lt-loops .lbl{fill:currentColor;font-size:12px;font-weight:600}
.lt-loops .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.lt-loops .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;fill:currentColor}
.lt-loops rect.box{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.35}
.lt-loops rect.row{fill:#1971c2;opacity:.55}
.lt-loops rect.inner{fill:none;stroke:#f08c00;stroke-width:1.6;opacity:.85}
.lt-loops .cwarn{fill:#f08c00;font-size:11px;font-weight:700}
.lt-loops .cbad{fill:#e03131;font-size:12px;font-weight:700}
.lt-loops .arr{stroke:currentColor;opacity:.3;stroke-width:1.4;fill:none}
.lt-loops .rw{animation:ltrw 4s linear infinite}
.lt-loops .r1{animation-delay:0s}.lt-loops .r2{animation-delay:.5s}.lt-loops .r3{animation-delay:1s}
.lt-loops .r4{animation-delay:1.5s}.lt-loops .r5{animation-delay:2s}.lt-loops .r6{animation-delay:2.5s}
@keyframes ltrw{0%,100%{opacity:.28}10%,22%{opacity:1}}
</style>
<svg viewBox="0 0 720 244" role="img" aria-label="바깥 행 20개마다 안쪽 노드가 한 번씩 실행되어 loops가 20이 되고, 표시되는 시간과 행 수는 1회 평균이라 곱해야 총합이 된다는 설명">
  <text class="lbl" x="16" y="20">바깥 — project 20행</text>
  <rect class="row rw r1" x="16" y="30" width="16" height="16" rx="3"/>
  <rect class="row rw r2" x="38" y="30" width="16" height="16" rx="3"/>
  <rect class="row rw r3" x="60" y="30" width="16" height="16" rx="3"/>
  <rect class="row rw r4" x="82" y="30" width="16" height="16" rx="3"/>
  <rect class="row rw r5" x="104" y="30" width="16" height="16" rx="3"/>
  <rect class="row rw r6" x="126" y="30" width="16" height="16" rx="3"/>
  <text class="sub" x="152" y="43">… 20행</text>

  <path class="arr" d="M76 50 L76 70"/>
  <text class="sub" x="86" y="66">행 하나마다 안쪽을 통째로 한 번</text>

  <rect class="inner" x="16" y="76" width="300" height="56" rx="7"/>
  <text class="cwarn" x="30" y="96">Aggregate  →  project_member 접근</text>
  <text class="sub" x="30" y="114">한 번 도는 데 3.4ms · 6행 반환</text>
  <text class="sub" x="30" y="127">이게 20번 반복된다</text>

  <text class="mono" x="16" y="164">-&gt;  Aggregate (actual time=3.412..3.413 rows=6 loops=20)</text>
  <text class="cbad" x="342" y="182">↑ 1회 평균이다. 총합이 아니다.</text>
  <text class="mono" x="16" y="204">rows  :  6 × 20 = 120건</text>
  <text class="mono" x="16" y="226">time  :  3.4ms × 20 ≈ 68ms</text>
  <text class="sub" x="240" y="204">loops를 안 곱하면 병목이 3ms짜리로 보인다</text>
</svg>
</div>

위험은 둘이다. 첫째, **바깥 행 수 × 안쪽 비용**이 그대로 곱해진다. 안쪽이 1ms라도 바깥이 1,000행이면 1초다. `LATERAL`은 플래너에게 "이 순서로 돌아라"라고 지시하는 것이라, 안쪽이 비싸도 다른 조인 전략으로 도망갈 수 없다.

둘째가 실무에서 진짜 많이 틀리는 부분인데, **`loops > 1`인 노드의 `actual time`과 `rows`는 "1회 평균"이다.**

## 실제 계획 — 820만 건 읽고 120건 남기기

`IN (...)` 리스트에 PK 20개가 들어간 상태의 계획이다.

```text
Nested Loop Left Join  (actual time=0.412..68.921 rows=20 loops=1)
  ->  Index Scan using pk_project p  (actual time=0.038..0.104 rows=20 loops=1)
        Index Cond: (project_id = ANY ('{...20개...}'))
        Filter: (del_yn = 'N')
  ->  Aggregate  (actual time=3.421..3.422 rows=1 loops=20)
        ->  Nested Loop  (actual time=0.184..3.301 rows=6 loops=20)
              ->  Seq Scan on project_member x  (actual time=0.019..2.914 rows=8 loops=20)
                    Filter: ((project_id = p.project_id) AND (del_yn = 'N'))
                    Rows Removed by Filter: 412339
              ->  Index Scan using pk_member m  (actual time=0.028..0.029 rows=1 loops=160)
                    Index Cond: (member_id = x.member_id)
                    Filter: ((member_name IS NOT NULL) AND (member_name <> ''))
```

`loops`를 곱해 깔때기를 그려 보면 이 계획이 무슨 짓을 하고 있는지 한눈에 보인다.

<div class="lt-funnel" markdown="0">
<style>
.lt-funnel{margin:1.5rem 0;overflow-x:auto}
.lt-funnel svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lt-funnel .lbl{fill:currentColor;font-size:11.5px;font-weight:600}
.lt-funnel .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.lt-funnel .num{font-size:13px;font-weight:700}
.lt-funnel rect.b0{fill:#e03131;opacity:.8}
.lt-funnel rect.b1{fill:#f08c00;opacity:.8}
.lt-funnel rect.b2{fill:#1971c2;opacity:.75}
.lt-funnel rect.b3{fill:#2f9e44;opacity:.85}
.lt-funnel .n0{fill:#e03131}.lt-funnel .n1{fill:#f08c00}
.lt-funnel .n2{fill:#1971c2}.lt-funnel .n3{fill:#2f9e44}
.lt-funnel .shrink{animation:ltfn 5s ease-in-out infinite}
.lt-funnel .s1{animation-delay:.3s}.lt-funnel .s2{animation-delay:.6s}.lt-funnel .s3{animation-delay:.9s}
@keyframes ltfn{0%,100%{opacity:.7}25%,75%{opacity:1}}
</style>
<svg viewBox="0 0 720 234" role="img" aria-label="820만 건을 스캔해 160건이 필터를 통과하고 120건이 조인까지 생존해 최종 20행을 반환하는 깔때기">
  <text class="sub" x="16" y="18">Seq Scan × 20 loops  —  (8 + 412,339) × 20  —  테이블 전체를 20번 통째로 읽음</text>
  <rect class="b0 shrink" x="16" y="26" width="560" height="30" rx="5"/>
  <text class="num n0" x="590" y="47">8,246,940</text>

  <text class="sub" x="16" y="82">Filter 통과  —  rows=8 × 20</text>
  <rect class="b1 shrink s1" x="16" y="90" width="30" height="26" rx="5"/>
  <text class="num n1" x="590" y="109">160</text>

  <text class="sub" x="16" y="142">member 조인까지 생존  —  rows=6 × 20</text>
  <rect class="b2 shrink s2" x="16" y="150" width="24" height="26" rx="5"/>
  <text class="num n2" x="590" y="169">120</text>

  <text class="sub" x="16" y="202">최종 반환</text>
  <rect class="b3 shrink s3" x="16" y="210" width="10" height="20" rx="4"/>
  <text class="num n3" x="590" y="227">20</text>

  <text class="sub" x="180" y="227">820만 건을 읽어 20행을 만든다 — 비율로 41만 대 1</text>
</svg>
</div>

여기서 한 걸음 더 나가면 결정적인 관찰이 나온다. **41만이라는 숫자가 매핑 테이블 전체 행 수와 같다.** 즉 이 계획은 "필터로 좀 많이 버렸다"가 아니라 **"테이블 전체를 20번 통째로 읽었다"** 이다. `Seq Scan` + `loops=20`을 보면 곧바로 이 문장이 나와야 한다.

시간으로 보면 병목도 명확하다.

```text
Seq Scan:  2.914ms × 20 loops ≈ 58ms
전체:                            68.9ms
                                 ↑ 84%가 이 한 노드
```

## 커버링 인덱스 — 출력 컬럼까지 넣는다

인덱스를 설계할 때 **탐색 키만** 보면 절반만 한 것이다. 서브쿼리가 그 테이블에서 읽어야 하는 컬럼 전부를 역산한다.

```sql
WHERE x.project_id = ?                     -- 탐색 키
  AND x.del_yn = 'N'                        -- 필터
JOIN member ON m.member_id = x.member_id    -- 출력 필요
MAX(CASE WHEN x.role_type = ...)            -- 출력 필요
```

네 개가 전부다. 그럼 **힙에 아예 안 가는** 인덱스를 만들 수 있다.

<div class="lt-cover" markdown="0">
<style>
.lt-cover{margin:1.5rem 0;overflow-x:auto}
.lt-cover svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lt-cover .lbl{fill:currentColor;font-size:12px;font-weight:600}
.lt-cover .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.lt-cover rect.box{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.35}
.lt-cover rect.idx{fill:none;stroke:#1971c2;stroke-width:1.6;opacity:.85}
.lt-cover rect.heap{fill:none;stroke:#e03131;stroke-width:1.6;opacity:.8}
.lt-cover .cbad{fill:#e03131;font-size:11px;font-weight:700}
.lt-cover .cok{fill:#2f9e44;font-size:11px;font-weight:700}
.lt-cover .arr{stroke:currentColor;opacity:.3;stroke-width:1.4;fill:none}
.lt-cover circle.trip{fill:#e03131;animation:lttrip 3.4s linear infinite}
.lt-cover circle.only{fill:#2f9e44;animation:ltonly 3.4s linear infinite}
@keyframes lttrip{0%{transform:translate(0,0);opacity:0}10%{opacity:1}30%{transform:translate(132px,0)}50%{transform:translate(132px,44px)}70%{transform:translate(132px,0)}92%{transform:translate(300px,0);opacity:1}100%{transform:translate(300px,0);opacity:0}}
@keyframes ltonly{0%{transform:translate(0,0);opacity:0}12%{opacity:1}40%{transform:translate(132px,0)}88%{transform:translate(300px,0);opacity:1}100%{transform:translate(300px,0);opacity:0}}
</style>
<svg viewBox="0 0 720 250" role="img" aria-label="일반 인덱스는 인덱스에서 위치를 찾고 힙까지 왕복하지만 커버링 인덱스는 인덱스만 읽고 끝난다는 비교">
  <text class="cbad" x="16" y="20">키만 인덱싱 — 인덱스 → 힙 왕복</text>
  <rect class="box" x="16" y="30" width="76" height="34" rx="6"/>
  <text class="sub" x="54" y="51" text-anchor="middle">탐색</text>
  <rect class="idx" x="124" y="30" width="110" height="34" rx="6"/>
  <text class="sub" x="179" y="45" text-anchor="middle">인덱스</text>
  <text class="sub" x="179" y="58" text-anchor="middle">(project_id)</text>
  <rect class="heap" x="124" y="82" width="110" height="34" rx="6"/>
  <text class="sub" x="179" y="97" text-anchor="middle">힙 (테이블 본체)</text>
  <text class="sub" x="179" y="110" text-anchor="middle">나머지 컬럼 읽으러</text>
  <rect class="box" x="300" y="30" width="80" height="34" rx="6"/>
  <text class="sub" x="340" y="51" text-anchor="middle">결과</text>
  <line class="arr" x1="92" y1="47" x2="124" y2="47"/>
  <line class="arr" x1="179" y1="64" x2="179" y2="82"/>
  <line class="arr" x1="234" y1="47" x2="300" y2="47"/>
  <text class="cbad" x="396" y="52">행마다 힙 랜덤 접근이 따라붙는다</text>
  <circle class="trip" cx="32" cy="47" r="5"/>

  <text class="cok" x="16" y="164">INCLUDE 커버링 — 인덱스만 읽고 끝</text>
  <rect class="box" x="16" y="174" width="76" height="34" rx="6"/>
  <text class="sub" x="54" y="195" text-anchor="middle">탐색</text>
  <rect class="idx" x="124" y="174" width="110" height="44" rx="6"/>
  <text class="sub" x="179" y="190" text-anchor="middle">인덱스</text>
  <text class="sub" x="179" y="203" text-anchor="middle">(project_id)</text>
  <text class="sub" x="179" y="215" text-anchor="middle">INCLUDE(member_id, role_type)</text>
  <rect class="box" x="300" y="174" width="80" height="34" rx="6"/>
  <text class="sub" x="340" y="195" text-anchor="middle">결과</text>
  <line class="arr" x1="92" y1="191" x2="124" y2="191"/>
  <line class="arr" x1="234" y1="191" x2="300" y2="191"/>
  <text class="cok" x="396" y="190">필요한 컬럼이 인덱스 안에 다 있다</text>
  <text class="sub" x="396" y="206">→ Index Only Scan · Heap Fetches: 0</text>
  <circle class="only" cx="32" cy="191" r="5"/>
</svg>
</div>

```sql
CREATE INDEX idx_pm_project_cover
    ON project_member (project_id)
 INCLUDE (member_id, role_type)
 WHERE del_yn = 'N';
```

```text
->  Index Only Scan using idx_pm_project_cover on project_member x
      Index Cond: (project_id = p.project_id)
      Heap Fetches: 0
      (actual time=0.018..0.021 rows=8 loops=20)
```

| | before | after |
|---|---|---|
| 노드 | Seq Scan | Index Only Scan |
| Rows Removed by Filter | 412,339 | 없어짐 |
| 스캔 총량 | 8,246,940 | 160 |
| 노드 시간 | 2.914 × 20 ≈ 58ms | 0.021 × 20 ≈ 0.4ms |
| 전체 | 68.9ms | 약 2ms |

## Index Only Scan인데 왜 힙에 가나 — Visibility Map

`Index Only Scan`이 잡혔다고 끝이 아니다. **`Heap Fetches:` 줄을 반드시 확인한다.**

```text
Index Only Scan ...
  Heap Fetches: 8291     ← "Index Only"인데 힙에 가고 있다
```

이유는 구조적이다. **인덱스에는 튜플의 가시성(visibility) 정보가 없다.** 인덱스 엔트리를 봐도 "이 행이 지금 내 트랜잭션에 보이는 행인지"를 알 수 없어서, 원래대로면 힙에 가서 확인해야 한다. 그 확인을 건너뛰게 해주는 게 **Visibility Map(VM)** 이고, VM은 **VACUUM이 갱신한다.**

<div class="lt-vm" markdown="0">
<style>
.lt-vm{margin:1.5rem 0;overflow-x:auto}
.lt-vm svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lt-vm .lbl{fill:currentColor;font-size:12px;font-weight:600}
.lt-vm .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.lt-vm rect.box{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.35}
.lt-vm rect.vmok{fill:#2f9e44;opacity:.8}
.lt-vm rect.vmno{fill:#e03131;opacity:.8}
.lt-vm .cok{fill:#2f9e44;font-size:10.5px;font-weight:700}
.lt-vm .cbad{fill:#e03131;font-size:10.5px;font-weight:700}
.lt-vm .arr{stroke:currentColor;opacity:.3;stroke-width:1.4;fill:none}
.lt-vm .pulse{animation:ltvm 3.6s ease-in-out infinite}
.lt-vm .v1{animation-delay:0s}.lt-vm .v2{animation-delay:.4s}.lt-vm .v3{animation-delay:.8s}
@keyframes ltvm{0%,100%{opacity:.35}30%,60%{opacity:1}}
</style>
<svg viewBox="0 0 720 208" role="img" aria-label="Visibility Map에서 전부 보이는 페이지는 힙을 건너뛰고, 표시가 없는 페이지는 힙까지 가야 하며 VACUUM이 이 맵을 갱신한다는 설명">
  <text class="lbl" x="16" y="20">Visibility Map — 페이지마다 1비트</text>
  <rect class="vmok pulse v1" x="16" y="30" width="30" height="22" rx="4"/>
  <rect class="vmok pulse v2" x="52" y="30" width="30" height="22" rx="4"/>
  <rect class="vmno pulse v3" x="88" y="30" width="30" height="22" rx="4"/>
  <rect class="vmok pulse v1" x="124" y="30" width="30" height="22" rx="4"/>
  <rect class="vmno pulse v2" x="160" y="30" width="30" height="22" rx="4"/>
  <text class="cok" x="206" y="39">초록 = all-visible → 힙 건너뜀 (Heap Fetches 0)</text>
  <text class="cbad" x="206" y="55">빨강 = 표시 없음 → 힙까지 가서 가시성 확인</text>

  <rect class="box" x="16" y="86" width="180" height="42" rx="7"/>
  <text class="sub" x="106" y="104" text-anchor="middle">UPDATE / DELETE 발생</text>
  <text class="sub" x="106" y="119" text-anchor="middle">해당 페이지 표시가 꺼진다</text>
  <line class="arr" x1="196" y1="107" x2="250" y2="107"/>
  <rect class="box" x="250" y="86" width="170" height="42" rx="7"/>
  <text class="sub" x="335" y="104" text-anchor="middle">VACUUM이 정리 후</text>
  <text class="sub" x="335" y="119" text-anchor="middle">다시 표시를 켠다</text>
  <line class="arr" x1="420" y1="107" x2="474" y2="107"/>
  <rect class="box" x="474" y="86" width="180" height="42" rx="7"/>
  <text class="sub" x="564" y="104" text-anchor="middle">VACUUM이 못 따라오면</text>
  <text class="cbad" x="564" y="119" text-anchor="middle">이름만 Index Only</text>

  <text class="sub" x="16" y="164">즉 갱신이 잦은 테이블에서는 계획에 Index Only Scan이 찍혀도 실제로는 힙에 다 갈 수 있다.</text>
  <text class="sub" x="16" y="184">노드 이름이 아니라 Heap Fetches 숫자를 믿는다.</text>
</svg>
</div>

## 반복이 무서운 게 아니라 안쪽이 비싼 게 무섭다

같은 화면이 `IN` 리스트에 500개를 넣는다면? **인덱스를 만든 뒤라면 `LATERAL` 구조를 그대로 둬도 된다.**

```text
0.021ms × 500 loops ≈ 10ms
```

Nested Loop + Index Scan은 바깥 행 수에 선형이라 500 정도는 무섭지 않다. `member` 조인이 500번 도는 것도 문제가 아니다 — 이미 PK Index Scan 1회 0.029ms짜리라 500번이면 15ms 남짓, 선형으로만 는다. 진짜 문제였던 건 `Seq Scan` 쪽이었다. **20번에 820만 건이면 500번엔 2억 건이다.**

> "LATERAL은 반복되니까 나쁘다"가 아니라 **"안쪽이 O(1)이면 반복은 싸다"** 가 맞는 감각이다. `loops` 수가 아니라 **안쪽 노드의 복잡도**가 비용을 정한다.
{: .prompt-info }

## 바깥이 더 커지면 — de-correlate 리라이팅

바깥이 수천~수만으로 커지면 그때는 상관관계 자체를 제거한다. `IN` 리스트를 안쪽으로 밀어 넣고, 상관 조건을 `GROUP BY`로 바꾼다.

```sql
FROM project p
LEFT JOIN (
    SELECT x.project_id,
           MAX(CASE WHEN x.role_type = 'OWNER'    THEN 1 ELSE 0 END) AS has_owner,
           MAX(CASE WHEN x.role_type = 'MANAGER'  THEN 1 ELSE 0 END) AS has_manager,
           MAX(CASE WHEN x.role_type = 'REVIEWER' THEN 1 ELSE 0 END) AS has_reviewer,
           MAX(CASE WHEN x.role_type = 'VIEWER'   THEN 1 ELSE 0 END) AS has_viewer
      FROM project_member x
      JOIN member m ON m.member_id = x.member_id
     WHERE x.del_yn = 'N'
       AND x.project_id IN (...)          -- 리스트를 안쪽으로 밀어넣음
       AND m.member_name IS NOT NULL AND m.member_name <> ''
     GROUP BY x.project_id                -- 상관관계를 GROUP BY로 대체
) c ON c.project_id = p.project_id
```

<div class="lt-deco" markdown="0">
<style>
.lt-deco{margin:1.5rem 0;overflow-x:auto}
.lt-deco svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lt-deco .lbl{fill:currentColor;font-size:12px;font-weight:600}
.lt-deco .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.lt-deco .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;fill:currentColor}
.lt-deco rect.box{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.35}
.lt-deco rect.rep{fill:#f08c00;opacity:.7}
.lt-deco rect.once{fill:#2f9e44;opacity:.85}
.lt-deco .cwarn{fill:#f08c00;font-size:11px;font-weight:700}
.lt-deco .cok{fill:#2f9e44;font-size:11px;font-weight:700}
.lt-deco .big{font-size:13px;font-weight:700}
.lt-deco .rp{animation:ltrp 4s linear infinite}
.lt-deco .q1{animation-delay:0s}.lt-deco .q2{animation-delay:.25s}.lt-deco .q3{animation-delay:.5s}
.lt-deco .q4{animation-delay:.75s}.lt-deco .q5{animation-delay:1s}.lt-deco .q6{animation-delay:1.25s}
.lt-deco .q7{animation-delay:1.5s}.lt-deco .q8{animation-delay:1.75s}
@keyframes ltrp{0%,100%{opacity:.25}12%,26%{opacity:1}}
</style>
<svg viewBox="0 0 720 250" role="img" aria-label="LATERAL은 바깥 행마다 안쪽을 반복해 O 엔 곱하기 엠이지만 de-correlate하면 안쪽을 한 번만 돌아 O 엔 더하기 엠이 된다는 비교">
  <text class="cwarn" x="16" y="20">LATERAL — Nested Loop, 바깥 행마다 안쪽을 다시</text>
  <rect class="rep rp q1" x="16" y="30" width="34" height="22" rx="4"/>
  <rect class="rep rp q2" x="56" y="30" width="34" height="22" rx="4"/>
  <rect class="rep rp q3" x="96" y="30" width="34" height="22" rx="4"/>
  <rect class="rep rp q4" x="136" y="30" width="34" height="22" rx="4"/>
  <rect class="rep rp q5" x="176" y="30" width="34" height="22" rx="4"/>
  <rect class="rep rp q6" x="216" y="30" width="34" height="22" rx="4"/>
  <rect class="rep rp q7" x="256" y="30" width="34" height="22" rx="4"/>
  <rect class="rep rp q8" x="296" y="30" width="34" height="22" rx="4"/>
  <text class="sub" x="340" y="45">… 바깥 행 수만큼 반복</text>
  <text class="mono" x="16" y="74">Nested Loop Left Join</text>
  <text class="mono" x="16" y="90">  -&gt;  Index Scan on project</text>
  <text class="mono" x="16" y="106">  -&gt;  Aggregate  (loops=500)</text>
  <text class="cwarn big" x="440" y="92">O(N × 안쪽비용)</text>

  <text class="cok" x="16" y="150">de-correlate — 안쪽을 한 번만</text>
  <rect class="once" x="16" y="160" width="34" height="22" rx="4"/>
  <text class="sub" x="62" y="175">단 1회 · GROUP BY로 한꺼번에 집계</text>
  <text class="mono" x="16" y="204">Hash Left Join</text>
  <text class="mono" x="16" y="220">  -&gt;  Index Scan on project</text>
  <text class="mono" x="16" y="236">  -&gt;  Hash  -&gt;  HashAggregate  (loops=1)</text>
  <text class="cok big" x="440" y="222">O(N + M)</text>
</svg>
</div>

바깥 행 수와 무관하게 안쪽을 1회만 돈다. 참고로 **PostgreSQL은 집계가 들어있는 LATERAL을 스스로 de-correlate 해주지 않는다.** 사람이 직접 다시 써야 하는 리라이팅이다.

## LEFT의 성격이 뒤집히는 지점

마지막이 이 세트에서 가장 미묘한 부분이다. 원래 `LATERAL`에서 `LEFT`는 사실 **의미상 중복**이었다. `GROUP BY` 없는 집계 쿼리는 입력이 0행이어도 **항상 정확히 1행**을 반환하기 때문이다.

```sql
SELECT MAX(...) FROM project_member WHERE <아무것도 매칭 안 됨>
→ 0행이 아니라, NULL 하나를 담은 1행을 반환
```

그래서 매칭 여부와 무관하게 늘 1행이 오고, `LEFT`든 `INNER`든 바깥 행이 사라질 일이 없다. 증거는 호출부에 있다 — `COALESCE(c.has_owner, 0) = 1`이 필요하다는 것 자체가 "행은 오는데 값이 NULL"인 경우를 이미 다루고 있다는 뜻이다.

그런데 위 리라이팅에서는 `GROUP BY`가 생겼다. **그 순간 매칭 없는 프로젝트는 서브쿼리 결과에 아예 행이 없다.**

<div class="lt-left" markdown="0">
<style>
.lt-left{margin:1.5rem 0;overflow-x:auto}
.lt-left svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.lt-left .lbl{fill:currentColor;font-size:12px;font-weight:600}
.lt-left .sub{fill:currentColor;font-size:9.5px;opacity:.6}
.lt-left .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;fill:currentColor}
.lt-left rect.box{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.35}
.lt-left rect.keep{fill:none;stroke:#2f9e44;stroke-width:1.6;opacity:.85}
.lt-left rect.lost{fill:none;stroke:#e03131;stroke-width:1.6;opacity:.85;stroke-dasharray:5 4}
.lt-left .cok{fill:#2f9e44;font-size:11px;font-weight:700}
.lt-left .cbad{fill:#e03131;font-size:11px;font-weight:700}
.lt-left .vanish{animation:ltvan 4s ease-in-out infinite}
@keyframes ltvan{0%,30%{opacity:1}62%,100%{opacity:.12}}
</style>
<svg viewBox="0 0 720 226" role="img" aria-label="GROUP BY가 없는 집계는 매칭이 없어도 NULL 한 행을 반환하지만 GROUP BY가 생기면 행 자체가 없어져 INNER 조인 시 바깥 행이 사라진다는 비교">
  <text class="cok" x="16" y="20">GROUP BY 없는 집계 — 매칭 0건이어도</text>
  <rect class="box" x="16" y="30" width="150" height="34" rx="6"/>
  <text class="sub" x="91" y="51" text-anchor="middle">매칭 0건</text>
  <text class="sub" x="180" y="51">→</text>
  <rect class="keep" x="204" y="30" width="170" height="34" rx="6"/>
  <text class="mono" x="289" y="51" text-anchor="middle">NULL 한 행이 온다</text>
  <text class="cok" x="396" y="46">LEFT / INNER 결과 동일</text>
  <text class="sub" x="396" y="62">→ LEFT는 미래 변경 대비 "보험"</text>

  <text class="cbad" x="16" y="130">GROUP BY 추가 후 — 매칭 0건이면</text>
  <rect class="box" x="16" y="140" width="150" height="34" rx="6"/>
  <text class="sub" x="91" y="161" text-anchor="middle">매칭 0건</text>
  <text class="sub" x="180" y="161">→</text>
  <rect class="lost vanish" x="204" y="140" width="170" height="34" rx="6"/>
  <text class="mono vanish" x="289" y="161" text-anchor="middle">행 자체가 없다</text>
  <text class="cbad" x="396" y="156">INNER면 바깥 행이 조용히 사라진다</text>
  <text class="sub" x="396" y="172">→ LEFT는 이제 "필수"</text>
  <text class="sub" x="16" y="210">같은 리팩터링 안에서 LEFT의 성격이 중복 → 필수로 뒤집힌다. 개념이 실전에서 물리는 지점이다.</text>
</svg>
</div>

> 원래 형태에서 `LEFT`는 미래 변경에 대한 **보험**이었지만, de-correlate 형태에서는 **필수**다. `INNER`로 쓰면 참여 멤버가 없는 프로젝트가 목록에서 조용히 사라진다. 리스트에서 항목이 빠지는 버그는 재현도 어렵고 발견도 늦다.
{: .prompt-warning }

## 운영 함정

**함정 1 — `LATERAL`을 성능 기능으로 설명하기.** 없으면 에러가 나는 스코프 규칙이다. `EXISTS` N회를 1회로 합쳤을 때의 이득은 "LATERAL이 빨라서"가 아니라 "같은 테이블을 N번 읽던 걸 1번으로 줄여서"다.

**함정 2 — `loops`를 안 곱하기.** `loops > 1`인 노드의 시간·행 수는 1회 평균이다. 곱하지 않으면 84%를 차지하는 병목이 3ms짜리로 보인다.

**함정 3 — `Index Only Scan`을 이름만 믿기.** `Heap Fetches:`가 0이 아니면 힙에 가고 있다. 인덱스에 가시성 정보가 없어 Visibility Map에 의존하는데, VACUUM이 못 따라오는 갱신 잦은 테이블에서 흔하다.

**함정 4 — 탐색 키만 인덱스에 넣기.** 출력 컬럼까지 `INCLUDE`에 넣어야 힙 접근이 사라진다.

**함정 5 — de-correlate하면서 `LEFT`를 빼기.** `GROUP BY`가 생긴 순간 `LEFT`는 선택이 아니라 필수가 된다.

## 면접 한 줄 Q&A

- **Q. LATERAL이 일반 서브쿼리와 결정적으로 다른 점은?** A. `FROM` 절 서브쿼리가 앞선 `FROM` 항목의 컬럼을 참조할 수 있게 하는 **스코프 규칙**이다. 없으면 느려지는 게 아니라 `invalid reference to FROM-clause entry` 에러가 난다.
- **Q. LATERAL은 일반 조인보다 빠른가?** A. 아니다. 대부분은 일반 조인이 빠르다. LATERAL은 "바깥 행마다 한 번"이라는 순서가 고정된 Nested Loop에 묶여 플래너가 Hash/Merge Join을 못 고른다. 이득이 나는 건 같은 테이블 반복 탐색을 1회로 줄일 때다.
- **Q. `loops=20`인 노드의 `actual time=3.4ms`는?** A. 1회 평균이다. 총합은 `3.4 × 20 ≈ 68ms`. 행 수도 마찬가지로 곱해야 한다.
- **Q. `Index Only Scan`인데 왜 느린가?** A. `Heap Fetches:`를 본다. 인덱스에는 가시성 정보가 없어 Visibility Map으로 확인해야 힙을 건너뛰는데, VM은 VACUUM이 갱신하므로 갱신이 잦은 테이블에서는 이름만 Index Only이고 힙에 다 간다.
- **Q. 바깥 행이 수만 건이면 LATERAL을 어떻게 바꾸나?** A. 상관 조건을 `GROUP BY`로 대체하고 `IN` 리스트를 안쪽으로 밀어 넣어 de-correlate한다. `Nested Loop O(N × 안쪽비용)`이 `Hash Left Join + HashAggregate O(N + M)`이 된다. 이때부터 `LEFT`는 필수다.

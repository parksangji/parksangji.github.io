---
title: 동기화 (2) — 세마포어·조건 변수, 그리고 데드락의 네 가지 조건
date: 2023-06-01 10:00:00 +0900
description: "세마포어와 조건 변수, 생산자-소비자 문제, 데드락의 네 가지 조건과 예방·회피·탐지 — 식사하는 철학자로 보는 동기화 심화."
series: "운영체제 A-Z"
categories: [OS]
tags: [os, semaphore, condition-variable, deadlock, dining-philosophers, monitor, producer-consumer]
mermaid: true
image:
  path: /assets/img/posts/os-semaphore-deadlock.png
  lqip: "data:image/jpeg;base64,/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAMCBv/EACEQAAICAgIBBQAAAAAAAAAAAAECAAMRIRJxBBQiMjOh/8QAFgEBAQEAAAAAAAAAAAAAAAAAAQAC/8QAFhEBAQEAAAAAAAAAAAAAAAAAAAEh/9oADAMBAAIRAxEAPwDnj49js7rUzLk7HcgwwSCMEaIMv6iytmRRWRyJ9yKT+ydl7uvFggGvioB11N1iJzT0uihmXAMxKPczpxY5Ali1i37H7MxEQphERAv/2Q=="
  alt: "동기화: 세마포어와 데드락 — 운영체제 A-Z"
---

## "락 하나로는 표현되지 않는 것들"

앞 글의 뮤텍스는 "한 번에 하나만"을 보장합니다. 그런데 현실의 동기화 문제는 그 모양이 아닙니다.

- **자원이 여러 개**: 커넥션 풀에 연결이 10개 있다. "한 번에 하나"가 아니라 "한 번에 열까지"를 세고 싶다.
- **순서·조건**: 소비자는 버퍼가 *비어 있으면* 기다려야 하고, 생산자가 채우면 *그때* 깨어나야 한다. 단순 상호배제로는 "조건이 충족될 때까지 잠들기"를 표현할 수 없다.

이 두 가지를 위해 **세마포어**와 **조건 변수**가 있습니다. 그리고 락을 둘 이상 쓰는 순간, 동기화의 가장 악명 높은 함정이 열립니다 — **데드락**. 이 글은 두 도구를 정확히 익히고, 데드락이 *수학적으로 언제* 발생하는지(네 조건)와 어떻게 끊는지를 끝까지 봅니다.

## 세마포어: 자원의 개수를 세는 카운터

세마포어는 **정수 카운터 + 두 원자 연산**입니다. `P`(wait, 프루번): 카운터를 1 줄이고, 음수가 되면 블록. `V`(signal, 페르호헌): 카운터를 1 늘리고, 대기자가 있으면 하나 깨움.

- **카운팅 세마포어**: 초깃값 N → 동시에 N개까지 자원 사용 허용(커넥션 풀·세마포어 기반 throttling).
- **바이너리 세마포어**: 초깃값 1 → 뮤텍스처럼 동작. 단, **결정적 차이**가 있습니다.

> **현실 체크 — "바이너리 세마포어 ≠ 뮤텍스."** 뮤텍스에는 **소유권(ownership)** 이 있습니다. 잠근 스레드만 풀 수 있죠. 세마포어는 소유 개념이 없어 **아무 스레드나 V** 할 수 있습니다. 그래서 "락을 건 쪽이 푼다"는 상호배제엔 뮤텍스를, "한쪽이 신호를 보내 다른 쪽을 깨운다"는 시그널링엔 세마포어를 씁니다. 뮤텍스는 우선순위 상속(priority inheritance)으로 우선순위 역전도 막을 수 있는데, 세마포어는 소유자가 없어 그게 불가능합니다.

```c
sem_t slots;
sem_init(&slots, 0, 10);   /* 동시 10개까지 */

sem_wait(&slots);          /* P: 빈 슬롯 없으면 블록 */
do_work_with_connection();
sem_post(&slots);          /* V: 슬롯 반납 */
```

## 조건 변수: "조건이 될 때까지 자고, 되면 깨워줘"

세마포어로도 만들 수 있지만, "어떤 술어(predicate)가 참이 될 때까지 대기"를 직접 표현하는 도구가 **조건 변수**입니다. 핵심 규칙 세 가지를 어기면 100% 버그가 납니다.

1. **항상 락과 함께**: `wait`는 호출 시 락을 **원자적으로 풀고 잠들었다가**, 깨어날 때 **다시 잡습니다**. 술어 검사와 대기 사이의 틈(lost wakeup)을 없애기 위해서입니다.
2. **`if`가 아니라 `while`**: 깨어났다고 조건이 참이라는 보장이 없습니다. **스푸리어스 웨이크업**(가짜 깨움)과, 깨어난 뒤 다른 스레드가 자원을 가로채는 경우 때문에 조건을 **다시 검사**해야 합니다.
3. **상태를 바꾼 뒤 signal**: 술어를 참으로 만들고 나서 깨웁니다.

```c
pthread_mutex_lock(&m);
while (count == 0)                  /* ★ if가 아니라 while */
    pthread_cond_wait(&not_empty, &m);  /* 락 풀고 잠 → 깨면 락 재획득 */
item = buffer[--count];
pthread_mutex_unlock(&m);
```

`wait` 안에서 락이 풀리기 때문에, 그 사이 다른 스레드가 들어와 `count`를 바꿀 수 있습니다. 그래서 깨어나면 반드시 `while`로 다시 확인하는 것이 **모니터(monitor)** 패턴의 핵심입니다(자바 `synchronized`+`wait/notify`, 파이썬 `threading.Condition`이 모두 이 모델).

## 데드락: 락 둘이 만나는 순간

생산자-소비자에서 한 걸음만 나아가면, 서로 다른 락을 두 개 잡는 코드가 흔해집니다. 그리고 잡는 **순서**가 엇갈리면 — 아무도 영원히 진행하지 못합니다.

```c
/* 스레드 1 */            /* 스레드 2 */
lock(A);                  lock(B);
lock(B);  // ← B 대기     lock(A);  // ← A 대기
```

스레드 1이 A를, 스레드 2가 B를 쥔 채 서로의 것을 기다리면 둘 다 멈춥니다. **식사하는 철학자** 문제가 이 교착을 가장 선명하게 보여줍니다. 5명이 둥글게 앉아, 각자 양옆 포크 두 개가 있어야 먹을 수 있습니다. **모두가 동시에 왼쪽 포크를 집으면**, 오른쪽 포크는 옆 사람이 쥐고 있어 — 다섯 명 전원이 영원히 기다립니다.

<div class="os-phil" markdown="0">
<style>
.os-phil{margin:1.4rem 0;overflow-x:auto}
.os-phil svg{width:100%;max-width:460px;height:auto;display:block;margin:0 auto;font-family:inherit}
.os-phil .tbl{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.3}
.os-phil .ph{fill:none;stroke:currentColor;stroke-width:1.6;opacity:.7}
.os-phil .lbl{fill:currentColor;font-size:11px;font-weight:600}
.os-phil .cap{fill:currentColor;font-size:12px;font-weight:600}
.os-phil .fork{animation:osphilfork 9s ease-in-out infinite}
@keyframes osphilfork{
  0%,8%{fill:#8a8a8a;opacity:.45}
  18%,38%{fill:#1971c2;opacity:.95}
  46%,62%{fill:#e03131;opacity:1}
  74%,92%{fill:#2f9e44;opacity:.95}
  100%{fill:#8a8a8a;opacity:.45}}
.os-phil .c1,.os-phil .c2,.os-phil .c3{opacity:0;fill:currentColor;font-size:12px;font-weight:600;text-anchor:middle}
.os-phil .c1{animation:osc1 9s ease-in-out infinite}
.os-phil .c2{animation:osc2 9s ease-in-out infinite}
.os-phil .c3{animation:osc3 9s ease-in-out infinite}
@keyframes osc1{0%,8%{opacity:0}14%,40%{opacity:1}44%,100%{opacity:0}}
@keyframes osc2{0%,44%{opacity:0}48%,64%{opacity:1}68%,100%{opacity:0}}
@keyframes osc3{0%,70%{opacity:0}76%,94%{opacity:1}98%,100%{opacity:0}}
</style>
<svg viewBox="0 0 360 320" role="img" aria-label="식사하는 철학자 다섯 명이 모두 왼쪽 포크를 집은 뒤 오른쪽 포크를 기다리며 순환 대기로 교착되었다가, 락 순서를 통일해 해소되는 애니메이션">
  <circle class="tbl" cx="170" cy="150" r="72"/>
  <circle class="ph" cx="170" cy="45"  r="18"/><text class="lbl" x="170" y="49" text-anchor="middle">P0</text>
  <circle class="ph" cx="270" cy="118" r="18"/><text class="lbl" x="270" y="122" text-anchor="middle">P1</text>
  <circle class="ph" cx="232" cy="235" r="18"/><text class="lbl" x="232" y="239" text-anchor="middle">P2</text>
  <circle class="ph" cx="108" cy="235" r="18"/><text class="lbl" x="108" y="239" text-anchor="middle">P3</text>
  <circle class="ph" cx="70"  cy="118" r="18"/><text class="lbl" x="70"  y="122" text-anchor="middle">P4</text>
  <rect class="fork" x="214" y="74"  width="6" height="20" rx="2" transform="rotate(40 217 84)"/>
  <rect class="fork" x="248" y="166" width="6" height="20" rx="2" transform="rotate(-70 251 176)"/>
  <rect class="fork" x="167" y="225" width="6" height="20" rx="2" transform="rotate(0 170 235)"/>
  <rect class="fork" x="86"  y="166" width="6" height="20" rx="2" transform="rotate(70 89 176)"/>
  <rect class="fork" x="117" y="74"  width="6" height="20" rx="2" transform="rotate(-40 120 84)"/>
  <text class="c1" x="170" y="154">① 모두 왼쪽 포크 집음</text>
  <text class="c2" x="170" y="148">② 오른쪽 포크 대기</text>
  <text class="c2" x="170" y="164" style="fill:#e03131">순환 대기 = DEADLOCK</text>
  <text class="c3" x="170" y="154" style="fill:#2f9e44">③ 락 순서 통일 → 해소</text>
  <text class="cap" x="170" y="308" text-anchor="middle">5명 · 포크 5개 · 각자 양옆 두 개가 필요</text>
</svg>
</div>

## 데드락이 성립하는 네 가지 조건 (Coffman)

데드락은 운이 나빠서가 아니라, **네 조건이 동시에 모두** 성립할 때만 발생합니다. 하나라도 깨면 데드락은 불가능합니다 — 이게 모든 예방 전략의 출발점입니다.

| 조건 | 의미 | 이걸 깨는 방법 |
|---|---|---|
| **상호배제** | 자원을 한 번에 하나만 점유 | 자원을 공유 가능하게(읽기 전용·lock-free) |
| **점유와 대기** | 가진 채로 다른 것을 더 기다림 | 필요한 락을 **한 번에 모두** 획득(아니면 전부 포기) |
| **비선점** | 남이 쥔 걸 강제로 못 뺏음 | 일정 시간 못 얻으면 가진 것도 놓기(`trylock`+백오프) |
| **순환 대기** | 대기 사슬이 원을 이룸 | **락에 전역 순서**를 부여, 항상 그 순서로만 획득 |

이 네 조건의 "순환 대기"는 **자원 할당 그래프**의 사이클로 정확히 드러납니다. 프로세스(원)와 자원(사각형) 사이의 "점유" 화살표와 "요청" 화살표가 닫힌 고리를 만들면 — 그게 데드락입니다.

<div class="os-rag" markdown="0">
<style>
.os-rag{margin:1.4rem 0;overflow-x:auto}
.os-rag svg{width:100%;max-width:420px;height:auto;display:block;margin:0 auto;font-family:inherit}
.os-rag .nd{fill:none;stroke:currentColor;stroke-width:1.6;opacity:.7}
.os-rag .lbl{fill:currentColor;font-size:12px;font-weight:600}
.os-rag .sub{fill:currentColor;font-size:10px;opacity:.6}
.os-rag .edge{stroke:#1971c2;stroke-width:2;fill:none;opacity:0}
.os-rag .e1{animation:osrag 6s ease-in-out infinite}
.os-rag .e2{animation:osrag 6s ease-in-out infinite 0.7s}
.os-rag .e3{animation:osrag 6s ease-in-out infinite 1.4s}
.os-rag .e4{animation:osrag 6s ease-in-out infinite 2.1s}
@keyframes osrag{0%{opacity:0}8%{opacity:.9}68%{opacity:.9;stroke:#1971c2}84%,100%{opacity:1;stroke:#e03131}}
.os-rag .cyc{opacity:0;fill:#e03131;font-size:12px;font-weight:700;text-anchor:middle;animation:osragc 6s ease-in-out infinite}
@keyframes osragc{0%,78%{opacity:0}88%,98%{opacity:1}100%{opacity:0}}
</style>
<svg viewBox="0 0 360 300" role="img" aria-label="자원 할당 그래프에서 P1이 R1을 점유하고 R2를 요청, P2가 R2를 점유하고 R1을 요청하여 사이클이 형성되며 데드락으로 빨갛게 표시되는 애니메이션">
  <circle class="nd" cx="80"  cy="70"  r="26"/><text class="lbl" x="80"  y="74"  text-anchor="middle">P1</text>
  <rect   class="nd" x="244" y="44" width="52" height="52" rx="4"/><text class="lbl" x="270" y="74"  text-anchor="middle">R1</text>
  <circle class="nd" cx="270" cy="220" r="26"/><text class="lbl" x="270" y="224" text-anchor="middle">P2</text>
  <rect   class="nd" x="54"  y="194" width="52" height="52" rx="4"/><text class="lbl" x="80"  y="224" text-anchor="middle">R2</text>
  <path class="edge e1" d="M244,68 L110,68" marker-end="url(#osragarr)"/>
  <path class="edge e2" d="M80,98 L80,190" marker-end="url(#osragarr)"/>
  <path class="edge e3" d="M106,222 L242,222" marker-end="url(#osragarr)"/>
  <path class="edge e4" d="M270,192 L270,100" marker-end="url(#osragarr)"/>
  <defs><marker id="osragarr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#1971c2"/></marker></defs>
  <text class="sub" x="170" y="58">R1→P1 점유 · P2→R1 요청</text>
  <text class="sub" x="40"  y="150">P1→R2</text>
  <text class="sub" x="298" y="150">R2→P2</text>
  <text class="cyc" x="170" y="160">사이클 = 데드락!</text>
</svg>
</div>

> **현실 체크 — "실무 데드락의 99%는 락 순서 불일치다."** 거창한 은행원 알고리즘을 돌리는 서비스는 거의 없습니다. 대신 **모든 락에 전역 순서를 정하고(예: 주소 오름차순·ID 순), 항상 그 순서로만 획득**합니다. 순환 대기 조건이 원천 차단되니까요. 리눅스 커널은 `lockdep`이 런타임에 락 획득 순서를 추적해 잠재적 역순을 *실제 교착 전에* 경고합니다. 두 계좌 이체에서 `lock(min(a,b)); lock(max(a,b));`가 교과서적 예입니다.

## 데드락에 대한 네 가지 태도

- **예방(prevention)**: 네 조건 중 하나를 설계로 원천 봉쇄. 가장 흔한 게 **락 순서화**(순환 대기 차단).
- **회피(avoidance)**: 매 할당마다 "이걸 주면 안전 상태가 유지되나"를 검사 → **은행원 알고리즘**. 최대 자원 요구를 미리 알아야 해 현실 적용이 드뭅니다.
- **탐지 & 복구(detection)**: 일단 허용하고, 주기적으로 자원 할당 그래프의 사이클을 찾아 한 프로세스를 죽이거나 롤백. DB가 이 방식(교착 감지 후 victim 트랜잭션 abort).
- **무시(ostrich algorithm)**: "거의 안 일어나니 무시"하고 생기면 재부팅. 데스크톱 OS의 현실적 태도.

## 직접 들여다보기

```bash
# 멈춘(D/blocked) 스레드들이 어디서 대기 중인지 — 데드락 디버깅의 시작
gdb -p <pid> -batch -ex "thread apply all bt"
cat /proc/<pid>/stack          # 커널 스택: 어떤 락/대기에 걸렸나
cat /proc/<pid>/task/*/status  # State: D (uninterruptible) 가 흔한 신호

# 세마포어/IPC 객체 확인
ipcs -s

# 커널 락 순서 역전 경고 (개발 커널)
dmesg | grep -i lockdep
```

```c
/* 조건 변수로 만든 유한 버퍼 — 생산자/소비자 */
void produce(int x){
  pthread_mutex_lock(&m);
  while (count == CAP) pthread_cond_wait(&not_full, &m);
  buf[count++] = x;
  pthread_cond_signal(&not_empty);   /* 소비자 깨움 */
  pthread_mutex_unlock(&m);
}
```

## 면접/리뷰 단골 질문

- **Q. 뮤텍스와 세마포어의 차이는?** → 뮤텍스는 소유권이 있어 잠근 쪽만 푼다(상호배제·우선순위 상속 가능). 세마포어는 소유 개념 없는 카운터로 아무나 V 할 수 있다(시그널링·N개 자원 카운팅).
- **Q. 조건 변수에서 왜 `while`로 검사하나?** → 스푸리어스 웨이크업과, 깨어난 뒤 다른 스레드가 자원을 가로채는 경우 때문. `if`면 조건이 거짓인데 진행해 버린다.
- **Q. 데드락 4조건은? 어느 걸 깨는 게 현실적인가?** → 상호배제·점유와대기·비선점·순환대기. 실무는 **락 전역 순서화로 순환 대기를 차단**하는 게 가장 흔하다.
- **Q. 데드락과 라이브락·기아의 차이는?** → 데드락은 아무도 진행 못 하고 멈춤. 라이브락은 서로 양보하다 계속 상태만 바뀌며 진전 없음. 기아는 특정 스레드만 계속 자원을 못 얻음(우선순위·운).
- **Q. 은행원 알고리즘이 실무에서 드문 이유는?** → 모든 프로세스의 최대 자원 요구를 사전에 알아야 하고 매 할당마다 안전성 검사 비용이 커서. 대신 예방(순서화)이나 탐지(DB)가 쓰인다.

## 정리

- 세마포어는 **자원 개수를 세는 카운터**(P/V), 소유권이 없어 시그널링·N개 자원 throttling에 맞다. 상호배제엔 소유권 있는 뮤텍스를 쓴다.
- 조건 변수는 "조건이 될 때까지 대기" — **항상 락과 함께, `while`로 재검사, 상태 변경 후 signal**(모니터 패턴).
- 데드락은 **상호배제·점유와대기·비선점·순환대기** 네 조건이 동시에 성립할 때만 발생 → 하나만 깨면 불가능.
- 순환 대기는 **자원 할당 그래프의 사이클**로 드러나며, 실무 해법은 대부분 **락 전역 순서화**다.
- 대응은 예방·회피(은행원)·탐지&복구(DB)·무시(타조) 네 갈래이고, 상황에 따라 선택한다.

> 다음 글: 동기화의 세계를 떠나, 모든 프로세스가 "나만의 거대한 메모리"라는 환상을 갖는 비밀 — [가상 메모리]({% post_url 2023-06-19-os-virtual-memory %})로 내려갑니다. 락의 출발점이 궁금하면 [동기화 (1) 경쟁 상태와 락]({% post_url 2023-05-14-os-synchronization-locks %})으로.

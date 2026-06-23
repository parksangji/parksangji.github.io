---
title: "가상 스레드(Virtual Threads)와 Spring Boot"
date: 2025-11-20 11:15:00 +0900
series: "Spring Boot"
categories: [Backend]
tags: [spring-boot, virtual-threads, java21, concurrency, loom, pinning]
mermaid: true
image:
  path: /assets/img/posts/springboot-virtual-threads.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnTGWJIHekMLdhQ8jcqDxmoiT60kSKUIYL3NXpdIuY7bz2X5MZqgGIYN3FadxrtxPZi2bAXGDQ730Azn++aYaKKaASiiimM//Z"
  alt: 가상 스레드와 Spring Boot
---

## 스레드가 비싸서 생긴 고민들

전통적인 Spring MVC는 **요청 하나당 스레드 하나**(thread-per-request)를 씁니다. 그런데 OS 스레드는 비쌉니다 — 스택만 보통 1MB 안팎이고, 컨텍스트 스위칭 비용도 듭니다. 그래서 톰캣 기본값도 워커 스레드 200개 수준의 풀로 제한하죠.

문제는 **I/O 대기**입니다. 외부 API·DB 호출로 200ms를 기다리는 동안 그 스레드는 CPU를 한 톨도 안 쓰면서 풀의 한 자리를 점유합니다. 동시 요청이 200개를 넘으면 큐가 쌓이고 응답이 밀립니다. 이 "I/O 대기 동안 스레드가 놀고 있다"는 낭비를 피하려고 우리는 리액티브(WebFlux)의 복잡함을 감수해 왔습니다.

Java 21의 **가상 스레드**(JEP 444)는 이 고민의 전제를 바꿉니다. 이 글은 "한 줄 켜면 빨라진다"에서 멈추지 않고, **JVM이 캐리어 스레드 위에서 가상 스레드를 어떻게 갈아끼우는지**, 그래서 **무엇을 조심해야 하는지**까지 내려갑니다.

## 핵심 그림: 마운트와 언마운트

가상 스레드는 OS 스레드가 아닙니다. JVM이 관리하는 객체에 가깝고, 실제 실행은 소수의 **캐리어 스레드**(carrier, 전용 `ForkJoinPool`) 위에 **마운트(mount)** 되어 일어납니다. 가상 스레드가 블로킹 I/O를 만나면 JVM이 캐리어에서 **언마운트(unmount)** 시키고, 그 캐리어로 *다른* 가상 스레드를 올립니다. 캐리어는 절대 놀지 않습니다.

아래 애니메이션이 그 전부입니다 — <span style="color:#1971c2;font-weight:600">가상 스레드(파랑)</span>가 캐리어에 올라가 실행되다가, I/O 대기를 만나면 아래로 <span style="color:#f08c00;font-weight:600">언마운트(주황)</span>되어 비키고, 다음 가상 스레드가 그 자리에 올라탑니다.

<div class="vt-anim" markdown="0">
<style>
.vt-anim{margin:1.4rem 0;overflow-x:auto}
.vt-anim svg{width:100%;max-width:720px;height:auto;display:block;margin:0 auto;font-family:inherit}
.vt-anim .lbl{fill:currentColor;font-size:12.5px;font-weight:600}
.vt-anim .sub{fill:currentColor;font-size:9.5px;opacity:.55}
.vt-anim .zone{fill:none;stroke:currentColor;stroke-width:1.5;opacity:.3}
.vt-anim .carrier{fill:none;stroke:currentColor;stroke-width:2;opacity:.45;animation:vtpulse 5s ease-in-out infinite}
.vt-anim .vt{fill:#1971c2}
.vt-anim .v1{animation:vtcycle 5s ease-in-out infinite}
.vt-anim .v2{animation:vtcycle 5s ease-in-out infinite 1.7s}
.vt-anim .v3{animation:vtcycle 5s ease-in-out infinite 3.4s}
@keyframes vtcycle{
  0%{transform:translate(0,0);opacity:0}
  6%{opacity:1}
  18%{transform:translate(250px,0)}
  52%{transform:translate(250px,0)}
  72%{transform:translate(490px,78px);opacity:1;fill:#f08c00}
  84%{opacity:0}
  100%{transform:translate(490px,78px);opacity:0}
}
@keyframes vtpulse{0%,100%{opacity:.35}50%{opacity:.7}}
</style>
<svg viewBox="0 0 700 200" role="img" aria-label="소수의 캐리어 스레드 위에서 다수의 가상 스레드가 마운트되고, I/O 블로킹 시 언마운트되어 다른 가상 스레드가 올라타는 애니메이션">
  <rect class="zone" x="8" y="40" width="120" height="120" rx="8"/>
  <text class="lbl" x="68" y="30" text-anchor="middle">가상 스레드</text>
  <text class="sub" x="68" y="176" text-anchor="middle">수만 개 대기</text>
  <rect class="carrier" x="288" y="74" width="150" height="52" rx="8"/>
  <text class="lbl" x="363" y="64" text-anchor="middle">캐리어 스레드</text>
  <text class="sub" x="363" y="148" text-anchor="middle">= CPU 코어 수 (ForkJoinPool)</text>
  <rect class="zone" x="560" y="120" width="132" height="56" rx="8"/>
  <text class="sub" x="626" y="112" text-anchor="middle">I/O 대기 (언마운트)</text>
  <circle class="vt v1" cx="60" cy="100" r="9"/>
  <circle class="vt v2" cx="60" cy="100" r="9"/>
  <circle class="vt v3" cx="60" cy="100" r="9"/>
</svg>
</div>

그 결과, 우리는 **익숙한 블로킹 코드(thread-per-request)를 그대로 쓰면서** 수만 동시성을 얻습니다. 콜백·`Mono`·`Flux` 없이요.

```mermaid
flowchart LR
    R["요청 1만 개"] --> VT["가상 스레드 1만 개<br/>(요청마다 하나)"]
    VT -->|실행 중| C["캐리어 스레드<br/>(코어 수만큼)"]
    VT -.I/O 블로킹 시 언마운트.-> C
    C -->|언마운트된 동안| VT2["다른 가상 스레드 마운트"]
```

## 왜 "풀링"이 오히려 안티패턴인가

플랫폼 스레드 시대의 본능은 "비싼 스레드를 풀에 모아 재사용한다"입니다. 가상 스레드에선 이게 **거꾸로** 입니다. 가상 스레드는 생성 비용이 거의 없으므로(스택이 힙에 저장되고 필요할 때만 커짐), **재사용하지 말고 작업마다 새로 만드는 게 정석**입니다.

```java
// ❌ 옛 본능: 고정 풀로 가상 스레드를 제한
var pool = Executors.newFixedThreadPool(200);   // 의미 없음

// ✅ 정석: 작업당 하나
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (var task : tasks) executor.submit(task);
}   // close()가 모든 작업 완료를 기다림 (구조적 동시성과 잘 맞음)
```

풀로 개수를 200개로 묶는 순간, 가상 스레드의 존재 이유(무제한 동시성)를 스스로 없애는 셈입니다.

## Spring Boot에서 켜기 — 그리고 어디까지 바뀌나

Spring Boot 3.2부터 한 줄입니다 (Boot 4도 동일, **Java 21+ 필수**).

```yaml
spring:
  threads:
    virtual:
      enabled: true
```

이 플래그 하나가 건드리는 범위를 알아야 디버깅이 됩니다.

| 영역 | 적용되는 것 |
|------|------------|
| 내장 톰캣/Jetty | 요청 처리 실행기가 가상 스레드 기반으로 교체 |
| `@Async` | `SimpleAsyncTaskExecutor`가 작업마다 가상 스레드 사용 |
| `@Scheduled` | 태스크 스케줄러 실행기에 적용 |
| Spring AMQP / Kafka 리스너 등 | 컨테이너가 가상 스레드 실행기 채택 |

우리 비즈니스 코드는 바꿀 게 없습니다. 다만 "켜면 다 빨라진다"가 아니라 **I/O 대기가 병목이던 워크로드**에서만 효과가 납니다. CPU 바운드 작업은 캐리어 = 코어 수가 한계라 이점이 없습니다.

## 가장 큰 함정 1: 피닝(pinning)

언마운트는 공짜가 아닙니다. **가상 스레드가 `synchronized` 블록/메서드 안에 있거나 네이티브(JNI) 프레임 안에 있을 때 블로킹하면, 캐리어에서 분리되지 못하고 "고정(pinned)"** 됩니다. 그 캐리어는 통째로 묶여, 가상 스레드의 핵심 이점이 사라집니다. 캐리어가 코어 수만큼뿐이라, 피닝이 몰리면 사실상 데드락처럼 동시성이 말라붙습니다.

```java
// ❌ synchronized 안에서 블로킹 → JDK 21~23에서 캐리어 핀
synchronized (lock) {
    jdbcCall();          // 이 블로킹 동안 캐리어가 묶인다
}

// ✅ ReentrantLock은 가상 스레드 인지 → 블로킹해도 언마운트 가능
lock.lock();
try { jdbcCall(); }
finally { lock.unlock(); }
```

**버전 정합성이 중요합니다.**

- **JDK 21~23**: `synchronized` + 블로킹은 핀을 유발. 이 구간에선 핫 경로의 `synchronized`를 `ReentrantLock`으로 바꾸는 게 권장사항.
- **JDK 24+ (JEP 491)**: "Synchronize Virtual Threads without Pinning"으로 `synchronized` 블로킹이 더 이상 캐리어를 고정하지 않음. 즉 24부터는 `ReentrantLock`으로 바꾸는 동기가 대부분 사라짐. 남는 핀 원인은 주로 네이티브 프레임.

## 가장 큰 함정 2: 병목이 스레드 풀에서 *다운스트림*으로 이동

가상 스레드를 켜면 동시 요청을 1만 개 받을 수 있습니다. 그런데 **DB 커넥션 풀(HikariCP)은 여전히 10~30개**입니다. 예전에는 톰캣 스레드 풀(200개)이 자연스러운 throttle였는데, 그 마개가 사라지면서 1만 개 요청이 동시에 커넥션을 달라고 몰려 커넥션 획득 타임아웃이 폭발합니다.

→ 교훈: **가상 스레드는 한정 자원의 보호를 대신해 주지 않습니다.** 스레드 풀이라는 우연한 방어막이 사라졌으니, 외부 호출·DB 접근은 `Semaphore`나 명시적 동시성 제한으로 *의도적으로* 보호해야 합니다.

```java
private final Semaphore dbGate = new Semaphore(30);   // 커넥션 풀 크기에 맞춤

dbGate.acquire();
try { repository.query(); }
finally { dbGate.release(); }
```

## 관찰·디버깅: 핀을 눈으로 확인하기

추측하지 말고 핀을 측정합니다.

```bash
# JDK 21~23: 핀이 발생하면 스택트레이스 로깅
java -Djdk.tracePinnedThreads=full -jar app.jar
```

더 현대적인 방법은 **JFR(Java Flight Recorder)** 이벤트입니다. `jdk.VirtualThreadPinned`(핀 발생), `jdk.VirtualThreadStart/End`를 기록해 어디서 얼마나 핀이 나는지 정량화할 수 있습니다. JDK 24부터는 `jdk.tracePinnedThreads`가 사실상 의미를 잃으므로(피닝이 거의 사라짐) JFR 기반 관찰이 표준입니다.

```bash
java -XX:StartFlightRecording=filename=rec.jfr,duration=60s -jar app.jar
jfr print --events jdk.VirtualThreadPinned rec.jfr
```

## WebFlux는 이제 필요 없나?

"오직 동시성 때문에 어쩔 수 없이 WebFlux"였던 케이스는 **MVC + 가상 스레드**로 상당수 대체됩니다 — 디버깅 가능한 평범한 스택트레이스, 익숙한 명령형 코드라는 큰 이점과 함께요. 다만 **백프레셔(소비 속도에 맞춘 흐름 제어), 스트리밍, 전 구간 논블로킹 파이프라인**이 본질적으로 필요하면 여전히 WebFlux/Reactor가 답입니다. 선택 기준은 [MVC vs WebFlux 글]({% post_url 2025-09-25-springboot-mvc-vs-webflux %})에서 자세히 다룹니다.

## 면접/리뷰 단골 질문

- **Q. 가상 스레드를 풀링하면 왜 안 되나?** → 생성 비용이 거의 0이라 재사용 이득이 없고, 풀 크기로 묶는 순간 무제한 동시성이라는 존재 이유가 사라진다. `newVirtualThreadPerTaskExecutor()`가 정석.
- **Q. 피닝이 뭐고 어떻게 피하나?** → `synchronized`/네이티브 프레임 안에서 블로킹하면 캐리어가 고정됨. JDK 21~23은 `ReentrantLock`으로 회피, JDK 24+(JEP 491)부터 `synchronized` 핀은 해소됨.
- **Q. 가상 스레드를 켰더니 커넥션 타임아웃이 늘었다. 왜?** → 스레드 풀이라는 암묵적 throttle가 사라져 다운스트림(DB 커넥션 풀)으로 부하가 직격. `Semaphore` 등으로 명시적 제한 필요.
- **Q. CPU 바운드 작업도 빨라지나?** → 아니다. 캐리어 = 코어 수가 상한이라 I/O 대기형에만 유효.

## 정리

- 가상 스레드 = JVM이 캐리어(ForkJoinPool) 위에 **마운트/언마운트**하는 초경량 스레드. 블로킹 코드 그대로 고동시성.
- Spring Boot는 `spring.threads.virtual.enabled=true` 한 줄(Java 21+). 톰캣·`@Async`·스케줄러·리스너에 적용.
- **풀링 금지** — 작업마다 새로. **피닝 주의** — JDK 21~23은 `synchronized` 회피, 24+는 대부분 해소.
- **병목은 사라지지 않고 다운스트림으로 이동** — 커넥션 풀 등 한정 자원은 `Semaphore`로 직접 보호.
- 핀은 `-Djdk.tracePinnedThreads`(21~23) 또는 **JFR `jdk.VirtualThreadPinned`** 로 측정. CPU 바운드엔 무의미.

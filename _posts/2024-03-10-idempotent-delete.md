---
title: "이미 지운 걸 또 지우면 에러여야 할까"
date: 2024-03-10 10:30:00 +0900
categories: [Backend]
tags: [idempotency, delete, http-semantics, not-found, concurrency]
description: "DELETE는 멱등해야 한다는 HTTP 규약의 의미, 이미 없는 리소스에 200과 404 중 무엇을 줄지, 그리고 동시 삭제 경쟁을 다룬다."
---

삭제 API를 만들다 보면 사소해 보이지만 답하기 까다로운 질문에 부딪힌다. "이미 삭제된 리소스에 다시 DELETE 요청이 오면 어떻게 응답할 것인가." 404로 "없다"고 할지, 200으로 "삭제됐다(원하는 상태다)"고 할지. 이 선택은 멱등성이라는 HTTP의 핵심 원칙과 직결된다.

## 핵심 개념 — 멱등성이란 무엇인가

**멱등(idempotent)**하다는 건 "같은 요청을 한 번 보내든 여러 번 보내든 서버의 최종 상태가 동일하다"는 뜻이다. HTTP 명세상 GET, PUT, DELETE는 멱등해야 한다. POST는 그렇지 않다.

DELETE가 멱등이라는 건 직관적이다. "리소스 X를 삭제하라"를 한 번 실행하면 X가 없어진다. 두 번째 실행해도 결과는 같다. X는 여전히 없다. **최종 상태가 같다.** 멱등성은 응답 코드가 매번 같아야 한다는 뜻이 아니라, 부수 효과로 인한 **서버 상태**가 같아야 한다는 뜻임에 주의하자.

이 점이 중요한 이유는 네트워크다. 클라이언트가 DELETE를 보냈는데 응답을 못 받으면(타임아웃) 재시도한다. 첫 요청이 사실 성공했다면, 재시도는 "이미 없는 리소스"를 지우려는 요청이 된다. 멱등하지 않게 설계해 두 번째 요청에서 에러를 던지면, 정상 동작인데도 클라이언트는 실패로 인식한다.

## 코드 예시 — 200이냐 404냐

두 가지 합리적 설계가 있고, 일관성만 지키면 둘 다 정당하다.

**설계 A — 리소스 중심(404)**: "그 리소스가 지금 존재하지 않으면 404." 멱등성은 서버 상태로 보장되므로, 두 번째 요청이 404를 받아도 규약 위반이 아니다.

```java
@DeleteMapping("/orders/{id}")
public ResponseEntity<Void> delete(@PathVariable Long id) {
    boolean removed = orderService.delete(id); // 영향받은 행 수 > 0 ?
    return removed
            ? ResponseEntity.noContent().build()  // 204
            : ResponseEntity.notFound().build();   // 404
}
```

**설계 B — 결과 중심(204/200)**: "DELETE의 목적은 '없는 상태'를 만드는 것이다. 이미 없다면 목적은 달성됐으니 성공이다." 존재 여부와 무관하게 204를 반환한다.

```java
@DeleteMapping("/orders/{id}")
public ResponseEntity<Void> delete(@PathVariable Long id) {
    orderService.deleteIfExists(id); // 있으면 지우고, 없어도 조용히 통과
    return ResponseEntity.noContent().build(); // 항상 204
}
```

설계 B는 재시도 클라이언트에게 더 친절하다. 첫 요청이든 재시도든 항상 204를 받으므로 분기 처리가 단순하다. 설계 A는 "방금 내가 지웠나, 원래 없었나"를 구분해야 하는 감사(audit) 요구가 있을 때 유용하다. 무엇을 택하든 API 전반에서 일관되게 적용하는 게 핵심이다.

## 동시 삭제 경쟁 — TOCTOU

흔한 안티패턴은 "존재 확인 후 삭제"를 두 단계로 나누는 것이다.

```java
// 위험: check-then-act
if (orderRepo.exists(id)) {   // (1) 확인
    orderRepo.delete(id);     // (2) 삭제 — 사이에 다른 요청이 이미 지웠을 수 있다
}
```

(1)과 (2) 사이에 다른 요청이 같은 행을 지우면, (2)가 0건을 삭제하거나 예외를 던진다. 이를 **TOCTOU(time-of-check to time-of-use)** 경쟁이라 한다. 해법은 확인과 삭제를 하나의 원자적 쿼리로 합치는 것이다.

```sql
DELETE FROM orders WHERE id = ?;
```

`DELETE`는 그 자체로 "있으면 지운다"를 원자적으로 수행한다. 영향받은 행 수(affected rows)가 1이면 내가 지운 것이고, 0이면 이미 없던 것이다. 별도 SELECT 없이 이 반환값으로 분기하면 경쟁이 사라진다.

## 운영 함정

소프트 삭제(soft delete, `deleted_at` 플래그)를 쓰는 시스템에선 멱등성 정의가 더 미묘하다. 이미 `deleted_at`이 찍힌 행에 다시 DELETE가 오면 타임스탬프를 갱신할지 그대로 둘지 정해야 한다. 보통은 **첫 삭제 시각을 보존**하는 게 감사 관점에서 맞다. 또 외래 키로 참조되는 행을 하드 삭제하면 제약 위반이 터지므로, 연관 삭제 정책(CASCADE vs RESTRICT)을 명시적으로 설계해야 한다.

## 핵심 요약

- 멱등성은 "여러 번 보내도 서버 최종 상태가 같다"는 뜻이다. 응답 코드가 같아야 한다는 뜻이 아니다.
- 이미 없는 리소스에 204(결과 중심)든 404(리소스 중심)든, 일관되게만 하면 정당하다. 재시도엔 204가 친절하다.
- "존재 확인 후 삭제"는 TOCTOU 경쟁을 만든다. 단일 `DELETE` 쿼리의 affected rows로 원자적으로 판단하라.

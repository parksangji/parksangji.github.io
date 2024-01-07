---
title: "왜 체크예외는 롤백하지 않는가 — Spring 기본 롤백 규칙"
date: 2024-01-07 10:30:00 +0900
categories: [Backend]
tags: [transaction, rollback, checked-exception, rollbackfor, spring]
description: "Spring @Transactional의 기본 롤백 규칙은 unchecked 예외만 롤백한다. 체크예외가 조용히 커밋되는 이유와 try-catch가 롤백을 무력화하는 함정을 정리한다."
---

예외 처리와 저장 로직이 한 메서드에 섞이는 순간, 흔히 이런 버그가 생긴다. 분명히 예외가 났는데 데이터는 멀쩡히 커밋되어 있다. 원인은 대부분 Spring의 **기본 롤백 규칙**을 오해한 데 있다.

## 기본 규칙: unchecked만 롤백한다

`@Transactional`의 롤백 규칙은 직관과 다르다. 기본값은 다음과 같다.

- `RuntimeException`(unchecked)과 `Error` → **롤백**
- `Exception`(checked) → **커밋**

```java
@Transactional
public void register(User user) throws IOException {
    userRepository.save(user);
    fileService.writeProfile(user);  // IOException(체크예외) 발생
    // 트랜잭션은 롤백되지 않고 커밋된다 → user는 저장됨
}
```

`IOException`이 던져져도 `save`는 그대로 커밋된다. 분명 예외인데 데이터가 남는다.

왜 이렇게 설계됐나. 이 규칙은 EJB의 관례를 이어받은 것으로, 그 바탕엔 **체크예외 = 호출자가 복구할 것으로 예상되는, 비즈니스적으로 의미 있는 상황**이라는 철학이 깔려 있다. "재고 없음" 같은 예상된 분기는 굳이 데이터를 되돌릴 필요가 없을 수 있다는 가정이다. 반대로 unchecked는 **프로그래밍 오류나 회복 불가능한 상태**로 보아 안전하게 롤백한다.

이 가정이 현대 코드와 항상 맞는 건 아니다. 그래서 명시적으로 규칙을 바꿔야 할 때가 많다.

## rollbackFor로 규칙을 바꾼다

체크예외에서도 롤백하고 싶으면 `rollbackFor`를 명시한다.

```java
@Transactional(rollbackFor = Exception.class)
public void register(User user) throws IOException {
    userRepository.save(user);
    fileService.writeProfile(user);  // 이제 IOException도 롤백
}
```

반대로 특정 예외는 롤백에서 제외하려면 `noRollbackFor`를 쓴다. 규칙은 던져진 예외 타입과의 상속 거리로 가장 가까운 규칙이 적용된다.

## 더 흔한 함정: try-catch가 롤백을 삼킨다

규칙보다 더 자주 사고를 내는 건 **예외를 잡아서 삼키는 코드**다.

```java
@Transactional
public void register(User user) {
    userRepository.save(user);
    try {
        riskyOperation();           // RuntimeException 발생
    } catch (Exception e) {
        log.error("실패했지만 무시", e);  // 삼킴 → 메서드는 정상 종료
    }
    // 예외가 밖으로 안 나갔으므로 커밋된다
}
```

Spring의 트랜잭션 롤백은 **AOP 프록시가 메서드 밖으로 빠져나오는 예외를 감지**해서 작동한다. catch로 예외를 삼키면 프록시는 아무 일도 없었다고 판단하고 커밋한다. 내부에서 부분 실패가 있었어도 트랜잭션은 정상 종료된다.

부분 실패가 전체를 무효화해야 한다면, 잡되 다시 던지거나 명시적으로 롤백을 표시해야 한다.

```java
} catch (Exception e) {
    log.error("실패", e);
    TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
}
```

## 운영 함정

**같은 클래스 내부 호출은 트랜잭션이 안 먹는다.** `@Transactional`은 프록시 기반이라, 같은 객체의 다른 메서드를 `this.method()`로 직접 호출하면 프록시를 거치지 않아 트랜잭션이 적용되지 않는다. 자기 호출(self-invocation)에서 롤백이 안 일어나면 이걸 의심한다.

## 면접 한 줄 Q&A

- **Q. Spring 트랜잭션의 기본 롤백 대상은?** unchecked(RuntimeException)와 Error만. 체크예외는 기본적으로 커밋된다. 바꾸려면 `rollbackFor`를 명시한다.
- **Q. try-catch로 예외를 삼키면?** 프록시가 예외를 못 보므로 롤백이 일어나지 않고 커밋된다. 롤백이 필요하면 다시 던지거나 `setRollbackOnly()`를 호출한다.

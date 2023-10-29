---
title: "같은 객체, 다른 검증: 등록과 수정의 규칙 차이"
date: 2023-10-29 10:30:00 +0900
categories: [Backend]
tags: [validation, validation-groups, dto, bean-validation, create-update]
description: "하나의 DTO로 등록과 수정을 처리할 때, 검증 그룹(validation groups)으로 필수/선택 규칙을 시점별로 분기하는 법."
---

등록할 땐 비밀번호가 필수지만 수정할 땐 비워두면 "안 바꿈"이다. 같은 필드, 다른 규칙. 이 주에는 등록·수정 검증을 다뤘다. 핵심은 하나의 DTO에 *시점별로 다른 검증 규칙*을 어떻게 깔끔하게 입히느냐 — **검증 그룹(validation groups)**이다.

## 핵심 개념 — 검증 그룹의 동작 원리

Bean Validation(JSR-380)의 제약 애너테이션은 `groups` 속성을 가진다. 기본값은 `Default` 그룹이다. 검증을 트리거할 때 어떤 그룹으로 검증할지 지정하면, 그 그룹에 속한 제약만 실행된다.

```java
public interface OnCreate {}
public interface OnUpdate {}

public class UserForm {
    @NotNull(groups = OnUpdate.class)              // 수정 땐 식별자 필수
    private Long id;

    @NotBlank(groups = {OnCreate.class, OnUpdate.class})
    private String name;                            // 둘 다 필수

    @NotBlank(groups = OnCreate.class)             // 등록 땐 필수
    @Size(min = 8, groups = {OnCreate.class, OnUpdate.class})
    private String password;                        // 수정 땐 선택, 단 채우면 8자 이상
}
```

원리는 단순하다. `@NotBlank(groups = OnCreate.class)`는 *OnCreate 그룹으로 검증할 때만* 활성화된다. 수정 요청을 `OnUpdate`로 검증하면 이 제약은 평가되지 않으므로 password를 비워도 통과한다. 단 `@Size`는 양쪽 그룹에 있으니, 값이 있으면 길이 규칙은 적용된다. "비우면 통과, 채우면 검증"이 자연스럽게 표현된다.

## 컨트롤러에서 그룹 지정

Spring MVC에서는 `@Validated(그룹)`으로 어떤 그룹을 적용할지 고른다. `@Valid`와 달리 `@Validated`는 그룹 지정을 지원한다.

```java
@PostMapping("/users")
public ResponseEntity<?> create(
        @Validated(OnCreate.class) @RequestBody UserForm form) {
    userService.create(form);
    return ResponseEntity.status(HttpStatus.CREATED).build();
}

@PutMapping("/users/{id}")
public ResponseEntity<?> update(
        @PathVariable Long id,
        @Validated(OnUpdate.class) @RequestBody UserForm form) {
    userService.update(id, form);
    return ResponseEntity.ok().build();
}
```

같은 `UserForm`을 두 엔드포인트가 공유하지만, 검증 규칙은 그룹으로 분기된다. DTO를 두 벌 만들어 중복을 늘리는 대신, 규칙 차이만 그룹으로 표현하는 것이 핵심이다.

## 운영 함정

**함정 1 — 그룹 간 검증 순서가 필요한데 무시한다.** 형식 검증(`@Size`)이 통과해야 비즈니스 검증(중복 체크)을 하고 싶을 때, 그냥 두면 모든 제약이 한꺼번에 평가돼 에러가 뒤섞인다. 순서가 중요하면 `@GroupSequence`로 그룹 실행 순서를 정의한다. 앞 그룹이 실패하면 뒤 그룹은 평가하지 않는다.

**함정 2 — 부분 수정(PATCH)을 그룹만으로 처리하려 한다.** "보낸 필드만 수정"하는 PATCH는 그룹으로 해결되지 않는다. `null`이 "변경 안 함"인지 "null로 설정"인지 구분이 안 되기 때문이다. 이 경우 `Optional` 래핑이나 JSON Merge Patch, 혹은 전송된 필드 집합을 추적하는 별도 처리가 필요하다. 검증 그룹은 "필수/선택 차이"를 다루지, "전송 여부"를 다루지 않는다.

## 핵심 요약

- 검증 그룹 = 마커 인터페이스로 제약을 분류하고, `@Validated(그룹)`으로 시점별 활성화.
- 등록/수정처럼 규칙만 다른 경우 DTO를 복제하지 말고 그룹으로 분기한다.
- 면접 한 줄: "`@Valid`와 `@Validated` 차이?" → "`@Validated`만 검증 그룹 지정을 지원한다. 시점별 규칙 분기엔 `@Validated`."

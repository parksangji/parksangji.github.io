---
title: "Spring Data JPA 기본기: Repository와 쿼리 메서드"
date: 2025-10-02 14:10:00 +0900
series: "Spring Boot"
categories: [Backend, Spring Boot]
tags: [spring-boot, jpa, spring-data, n+1]
image:
  path: /assets/img/posts/springboot-data-jpa-basics.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnTEzEkCmtEQM4pWldSyg8VESe5oRIAEkAdTV+XSLmO289l+TGaoKxVgR1FadxrtxPZi2bAXGDSd7gZz/fNMNFFNAJRRRTGf/Z"
  alt: Spring Data JPA 기본기
---

## SQL을 한 줄도 안 썼는데 조회가 된다

Spring Data JPA를 처음 봤을 때 가장 신기했던 건, **인터페이스만 선언했는데 구현체 없이 동작**한다는 점이었습니다. `findByEmail`이라고 메서드 이름만 지었더니 알아서 쿼리가 나가더라고요. 어떻게 이게 되는지, 그리고 어디까지 믿고 써도 되는지 정리해봅니다.

## Repository 인터페이스

엔티티와 기본 CRUD는 `JpaRepository`를 상속하면 끝입니다.

```java
public interface UserRepository extends JpaRepository<User, Long> {
}
```

이 인터페이스의 구현체는 우리가 만들지 않습니다. Spring Data가 **런타임에 프록시 구현체를 생성**해 Bean으로 등록해줍니다. `save`, `findById`, `findAll`, `delete` 같은 메서드가 공짜로 따라옵니다.

## 쿼리 메서드 (메서드 이름으로 쿼리 생성)

메서드 이름의 규칙을 파싱해서 쿼리를 자동으로 만들어줍니다.

```java
public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);

    List<User> findByAgeGreaterThanEqualAndStatus(int age, Status status);

    boolean existsByEmail(String email);

    long countByStatus(Status status);
}
```

`findBy`, `And`, `GreaterThanEqual`, `Between`, `In`, `OrderBy` 같은 키워드를 조합합니다. 간단한 조회엔 정말 편하지만, 이름이 길어지면 가독성이 떨어지니 그땐 `@Query`를 씁니다.

## @Query로 직접 작성

복잡한 조회는 JPQL(또는 네이티브 SQL)을 직접 적습니다.

```java
@Query("select u from User u where u.team.name = :teamName")
List<User> findByTeamName(@Param("teamName") String teamName);
```

## 페이징

목록 API엔 페이징이 필수죠. `Pageable`을 파라미터로 받으면 됩니다.

```java
Page<User> findByStatus(Status status, Pageable pageable);
```

```java
Page<User> page = userRepository.findByStatus(
        Status.ACTIVE, PageRequest.of(0, 20, Sort.by("createdAt").descending()));
page.getTotalElements(); // 전체 개수
page.getContent();       // 현재 페이지 데이터
```

## 꼭 알아야 할 함정: N+1

연관 엔티티를 조회할 때 가장 자주 만나는 성능 문제가 **N+1** 입니다. 사용자 목록 100건을 가져온 뒤, 각 사용자의 팀을 지연 로딩하면 팀 조회 쿼리가 100번 더 나갑니다(1 + N).

해결은 **fetch join**으로 한 번에 가져오는 것입니다.

```java
@Query("select u from User u join fetch u.team")
List<User> findAllWithTeam();
```

> 조회 메서드가 잘 도는 것 같아도, 실제 나가는 SQL을 꼭 확인하세요. `spring.jpa.show-sql=true` 또는 `p6spy` 같은 도구로 쿼리 개수를 보면 N+1이 바로 보입니다.
{: .prompt-tip }

## 정리

- `JpaRepository`만 상속하면 기본 CRUD가 공짜. 구현체는 Spring Data가 생성.
- 간단 조회는 **쿼리 메서드**, 복잡하면 **`@Query`**.
- 목록은 **`Pageable`** 로 페이징.
- 연관 조회 시 **N+1**을 항상 의심하고, 실제 SQL을 확인해 fetch join으로 해결하자.

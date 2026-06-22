---
title: "Starter와 의존성 관리(BOM): 버전 지옥에서 벗어나기"
date: 2025-09-11 10:20:00 +0900
series: "Spring Boot"
categories: [Backend, Spring Boot]
tags: [spring-boot, starter, dependency-management, bom]
image:
  path: /assets/img/posts/springboot-starter-dependency.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn/IL5I9aRrchSc9KUTtGSABTWuGIwQOaESQgEkAdTV+XSLmO289l+TGaoBirBh1BrTuNduJ7MWzYC4waTvcDOf75phoopoBKKKKYz/9k="
  alt: Spring Boot Starter와 의존성 관리
---

## 라이브러리 버전 맞추기가 왜 이렇게 힘들까

Spring을 직접 쓰던 시절, 가장 짜증 났던 건 **버전 충돌**이었습니다. `spring-web`, `spring-context`, Jackson, 로깅 라이브러리… 각각 호환되는 버전을 일일이 찾아 맞춰야 했고, 하나만 어긋나도 `NoSuchMethodError` 같은 게 런타임에 터졌습니다. 이른바 "jar 지옥"이죠. 😵

Spring Boot의 **Starter**와 **의존성 관리(BOM)** 가 이 고통을 거의 없애줍니다.

## Starter: 묶음 의존성

Starter는 "어떤 기능을 하려면 보통 같이 필요한 라이브러리들"을 하나로 묶어둔 의존성입니다. 예를 들어 `spring-boot-starter-web` 하나면:

- `spring-webmvc`, 내장 톰캣, JSON 처리(Jackson), 검증(Validation) 등이 한 번에 따라옵니다.

```gradle
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    runtimeOnly 'org.postgresql:postgresql'
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}
```

개별 라이브러리를 나열하는 대신 **의도("웹을 하고 싶다")** 단위로 의존성을 추가하게 됩니다.

## 버전을 안 적는 이유: BOM

위 예시에서 Spring 관련 의존성에 **버전이 없는 것** 보이시나요? 이게 가능한 이유가 **BOM(Bill of Materials)** 입니다.

`spring-boot-dependencies`라는 BOM이 수백 개 라이브러리의 **서로 호환되는 버전 조합**을 미리 정의해 둡니다. 우리는 버전을 생략하고, Boot가 검증해 둔 버전을 그대로 쓰는 거죠.

- **Maven**: `spring-boot-starter-parent`를 부모로 두면 BOM이 적용됩니다.
- **Gradle**: `io.spring.dependency-management` 플러그인 또는 Spring Boot Gradle 플러그인이 BOM을 적용합니다.

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.1.0</version>
</parent>
```

이 `parent`의 버전 하나만 올리면, 수백 개 라이브러리 버전이 **검증된 조합으로 한꺼번에** 올라갑니다. 업그레이드가 훨씬 안전해집니다.

## 버전을 덮어써야 할 때

특정 라이브러리만 다른 버전을 써야 한다면, BOM이 관리하는 버전 프로퍼티를 덮어쓰면 됩니다.

```gradle
ext['jackson.version'] = '2.18.2'   // BOM 기본값 대신 지정
```

> 단, 이렇게 덮어쓰면 Boot가 검증한 조합에서 벗어나는 것이라 호환성 리스크가 생깁니다. 꼭 필요할 때만 신중하게 하세요.
{: .prompt-warning }

## Spring Boot 4의 모듈화

참고로 **Spring Boot 4**부터는 거대했던 모듈들이 더 잘게 쪼개졌습니다(autoconfigure 등). 필요한 모듈만 가져오게 되어 의존성이 가벼워지고 경계가 명확해졌습니다. Starter를 쓰면 이 변화는 대부분 자동으로 흡수되니, 우리가 신경 쓸 일은 거의 없습니다.

## 정리

- **Starter** = 기능 단위로 묶인 의존성. 개별 라이브러리 대신 의도 단위로 추가.
- **BOM(`spring-boot-dependencies`)** 이 호환 버전 조합을 관리 → 그래서 버전을 안 적어도 된다.
- 업그레이드는 **parent/플러그인 버전 하나**만 올리면 검증된 조합으로 일괄 적용.
- 개별 버전 덮어쓰기는 가능하지만 호환성 리스크가 있으니 최소화하자.

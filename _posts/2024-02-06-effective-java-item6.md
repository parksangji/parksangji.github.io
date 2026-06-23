---
title: "[이펙티브 자바] 아이템 6: 불필요한 객체 생성을 피하라"
date: 2024-02-06 10:00:00 +0900
series: "이펙티브 자바"
categories: [Java]
tags: [java, effective-java, performance, object]
image:
  path: /assets/img/posts/effective-java-item6.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnvKZySBSG3fGcUec6EhTxUbOxOSaskVULSBO5OK2bzw69rZG4MoOBnFYkb7JFbrg5rdvfEQurE2/lYJGM5pDMNvvGmmiigQlJRRQM/9k="
  alt: "이펙티브 자바 아이템 6"
---

## 똑같은 객체를 매번 새로 만들고 있었다

코드를 짜다 보면 의식하지 못한 채 **같은 기능의 객체를 반복 생성**하는 경우가 많습니다. 대부분은 문제없지만, 무거운 객체이거나 반복 횟수가 많으면 성능에 영향을 줍니다. 이펙티브 자바 아이템 6은 "불필요한 객체 생성을 피하라"고 말합니다.

## String 리터럴

가장 흔한 예시입니다.

```java
String a = new String("hello");  // ❌ 매번 새 String 인스턴스 생성
String b = "hello";              // ✅ 리터럴 → 문자열 풀에서 재사용
```

`new String("hello")`는 실행될 때마다 새 객체를 만듭니다. 반면 리터럴 `"hello"`는 JVM의 **문자열 풀(string pool)** 에서 같은 인스턴스를 재사용합니다.

## 비싼 객체는 캐싱하라

생성 비용이 큰 객체를 반복해서 만들면 손해입니다. 정규식 `Pattern`이 대표적입니다.

```java
// ❌ 호출할 때마다 Pattern을 내부에서 새로 컴파일
static boolean isRomanNumeral(String s) {
    return s.matches("^(?=.)M*(C[MD]|D?C{0,3})...$");
}

// ✅ Pattern을 한 번만 컴파일해 재사용
private static final Pattern ROMAN = Pattern.compile("^(?=.)M*(C[MD]|D?C{0,3})...$");
static boolean isRomanNumeral(String s) {
    return ROMAN.matcher(s).matches();
}
```

`String.matches`는 내부적으로 매번 `Pattern.compile`을 합니다. 컴파일은 비싼 작업이라, 반복 호출되는 곳이면 `Pattern`을 상수로 빼서 재사용하는 게 좋습니다.

## 오토박싱을 조심하라

기본 타입과 박싱 타입을 섞으면, 의도치 않은 **오토박싱**으로 객체가 대량 생성될 수 있습니다.

```java
// ❌ sum이 Long(박싱 타입) → 반복마다 Long 객체 생성
Long sum = 0L;
for (long i = 0; i < Integer.MAX_VALUE; i++) {
    sum += i;   // sum = Long.valueOf(sum.longValue() + i) ...
}

// ✅ 기본 타입 long 사용
long sum = 0L;
for (long i = 0; i < Integer.MAX_VALUE; i++) {
    sum += i;
}
```

이 차이만으로 실행 시간이 몇 배씩 벌어지기도 합니다. **박싱 타입보다 기본 타입을 우선**하고, 의도치 않은 오토박싱을 경계하세요.

## 주의: "객체 생성 = 무조건 나쁨"은 아니다

이 아이템을 "객체를 만들지 마라"로 오해하면 안 됩니다. 요즘 JVM은 작은 객체 생성/회수가 매우 저렴합니다. **방어적 복사**(아이템 50)처럼 꼭 새 객체를 만들어야 하는 경우엔 만드는 게 맞습니다. 핵심은 **"불필요하게 비싼/반복적인" 생성**을 피하라는 것입니다.

## 정리

- `new String(...)` 대신 문자열 **리터럴**.
- 생성 비용이 큰 객체(`Pattern` 등)는 **상수로 캐싱**해 재사용.
- 의미 없는 **오토박싱**을 피하고 기본 타입을 우선.
- 단, 필요한 객체 생성까지 아끼라는 뜻은 아니다(방어적 복사 등은 예외).

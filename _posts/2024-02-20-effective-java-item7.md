---
title: "[이펙티브 자바] 아이템 7: 다 쓴 객체 참조를 해제하라"
date: 2024-02-20 11:00:00 +0900
series: "이펙티브 자바"
categories: [Java, Effective Java]
tags: [java, effective-java, memory-leak, gc]
image:
  path: /assets/img/posts/effective-java-item7.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnvKZiSBxTfJYjIoaRsFQeKjyR3qyRyoWkCdycVs3nh17WyNwZQcDOKxI32SK3XBzW7e+IhdWJt/KwSMZzSGYbfeNNNFFAhKSiigZ//9k="
  alt: "이펙티브 자바 아이템 7"
---

## "자바는 GC가 있는데 메모리 누수가 나요?"

가비지 컬렉터(GC)가 있으니 메모리 관리는 신경 안 써도 된다고 생각하기 쉽습니다. 하지만 **다 썼는데도 참조가 남아 있는 객체**는 GC가 회수하지 못합니다. 이게 자바의 메모리 누수입니다.

## 직접 메모리를 관리하는 스택의 함정

이펙티브 자바의 유명한 예시, 직접 구현한 스택입니다.

```java
public Object pop() {
    if (size == 0) throw new EmptyStackException();
    return elements[--size];   // ❌ elements[size]는 여전히 객체를 참조!
}
```

`pop`으로 꺼냈지만 배열 `elements[size]`에는 **여전히 그 객체의 참조가 남아 있습니다.** 스택이 줄어들어도 그 자리의 객체는 GC 대상이 안 되어 메모리에 계속 남죠. 이런 게 쌓이면 누수입니다.

해결은 **다 쓴 참조를 null로** 만드는 것입니다.

```java
public Object pop() {
    if (size == 0) throw new EmptyStackException();
    Object result = elements[--size];
    elements[size] = null;   // ✅ 참조 해제 → GC가 회수 가능
    return result;
}
```

## 그렇다고 모든 변수를 null 처리하라는 건 아니다

이건 **클래스가 자기 메모리를 직접 관리할 때**의 이야기입니다. 일반적인 지역 변수는 스코프를 벗어나면 자동으로 해제되니, 굳이 `null` 처리할 필요가 없습니다(오히려 코드만 지저분해짐). **예외적으로** 위 스택처럼 직접 배열로 원소를 관리하는 경우에만 신경 쓰면 됩니다.

## 누수가 잘 생기는 3대 지점

1. **자기 메모리를 직접 관리하는 클래스**: 위 스택 예시.
2. **캐시**: 캐시에 넣고 안 비우면 계속 쌓임. 키가 살아있는 동안만 유효하면 `WeakHashMap`을 쓰면 자동 정리됩니다.
3. **리스너/콜백**: 등록만 하고 해제하지 않으면 계속 쌓임. 약한 참조(weak reference)로 등록하면 GC가 알아서 회수합니다.

```java
// 캐시 누수 방지: 키에 대한 외부 참조가 사라지면 엔트리 자동 제거
Map<Key, Value> cache = new WeakHashMap<>();
```

## 누수 찾기

메모리 누수는 눈에 잘 안 보입니다. **힙 프로파일러**(VisualVM, JProfiler 등)나 힙 덤프 분석으로 "예상보다 안 줄어드는 객체"를 추적하는 게 정석입니다.

## 정리

- GC가 있어도, **참조가 남으면** 회수 안 된다 → 메모리 누수.
- 자기 메모리를 관리하는 클래스는 **다 쓴 참조를 `null`로**.
- 단, 일반 지역 변수까지 null 처리할 필요는 없다(스코프로 해결).
- 캐시는 `WeakHashMap`, 리스너는 약한 참조로 누수를 예방.

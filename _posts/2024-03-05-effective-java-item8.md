---
title: "[이펙티브 자바] 아이템 8: finalizer와 cleaner 사용을 피하라"
date: 2024-03-05 14:00:00 +0900
series: "이펙티브 자바"
categories: [Java]
tags: [java, effective-java, finalizer, cleaner, autocloseable]
image:
  path: /assets/img/posts/effective-java-item8.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDAWEvk5qJ0KnoaeZmClRx71EXcjBPFWSCLvdV9Titq88Ova2RuDKDgZxWJG+yRW9Dmt298RC6sTb+VgkYzmkMw2+8aaaKKBCUlFFAz/9k="
  alt: "이펙티브 자바 아이템 8"
---

## "소멸자" 같은 게 자바에도 있던데?

C++의 소멸자(destructor)에 익숙하면, 자바의 `finalize()`를 "객체가 사라질 때 정리해주는 것"으로 기대하게 됩니다. 그런데 이펙티브 자바 아이템 8은 단호합니다: **finalizer와 cleaner는 쓰지 마라.**

## 왜 피해야 하나

**finalizer**(자바 9부터 deprecated)와 그 대안인 **cleaner** 모두 문제가 많습니다.

1. **실행 시점을 보장할 수 없다.** GC 구현에 맡겨지므로, 객체가 더는 안 쓰여도 finalizer가 **언제 실행될지(심지어 실행될지조차)** 알 수 없습니다. 그래서 "파일을 닫는다" 같은 시급한 작업을 절대 맡기면 안 됩니다.
2. **성능이 나쁘다.** finalizer가 있는 객체는 생성·회수가 훨씬 느립니다.
3. **신뢰할 수 없다.** finalizer 도중 예외가 나면 무시되고, 객체가 불완전한 상태로 남을 수 있습니다.
4. **보안 문제(finalizer 공격).** 생성 중 예외가 난 객체의 finalizer를 악용하는 공격이 가능합니다.

## 대신 무엇을 쓰나: AutoCloseable

리소스 정리가 필요하면 **`AutoCloseable`을 구현하고 `close()`** 를 제공하세요. 그리고 [try-with-resources](/posts/effective-java-item9/)로 사용하면 됩니다.

```java
public class FileWrapper implements AutoCloseable {
    private final FileInputStream in;

    public FileWrapper(String path) throws IOException {
        this.in = new FileInputStream(path);
    }

    @Override
    public void close() throws IOException {
        in.close();   // 명시적이고 즉시 실행되는 정리
    }
}
```

```java
try (FileWrapper f = new FileWrapper("data.txt")) {
    // 사용
}   // 블록을 벗어나면 close() 자동 호출 — 시점이 명확하다
```

## cleaner의 유일한 쓸모: 안전망

그럼 cleaner는 완전 무용지물이냐면, **"안전망(safety net)"** 역할은 할 수 있습니다. 사용자가 `close()`를 깜빡했을 때를 대비한 **최후의 보루**로만, 그것도 보조적으로 두는 정도입니다. 절대 주된 정리 수단으로 삼으면 안 됩니다.

## 정리

- **finalizer/cleaner는 시점 보장 X, 느림, 불신, 보안 문제** → 사용 금지.
- 리소스 정리는 **`AutoCloseable` + `close()` + try-with-resources**로.
- cleaner는 기껏해야 `close()` 누락 대비 **안전망** 정도로만.

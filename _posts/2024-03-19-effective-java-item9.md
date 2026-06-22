---
title: "[이펙티브 자바] 아이템 9: try-finally보다 try-with-resources를 사용하라"
date: 2024-03-19 10:30:00 +0900
series: "이펙티브 자바"
categories: [Java, Effective Java]
tags: [java, effective-java, try-with-resources, autocloseable]
image:
  path: /assets/img/posts/effective-java-item9.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnvKZySBUTAg4xUnmupIBppmfvirJGou91X1OK2rzw69rZG4MoOBnFYiPskV/Q5rdvfEQurE2/lYJGM5pDMNvvGmmiigQlJRRQM//Z"
  alt: "이펙티브 자바 아이템 9"
---

## 자원 닫기, try-finally로 하다 보면

파일·소켓·DB 커넥션처럼 다 쓰면 `close()`를 호출해야 하는 자원이 많습니다. 전통적으로는 `try-finally`로 닫았는데, 자원이 둘 이상이면 코드가 금방 지저분해집니다.

```java
// ❌ 자원 두 개 → 중첩 try-finally
InputStream in = new FileInputStream(src);
try {
    OutputStream out = new FileOutputStream(dst);
    try {
        byte[] buf = new byte[1024];
        int n;
        while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
    } finally {
        out.close();
    }
} finally {
    in.close();
}
```

## 더 큰 문제: 예외가 삼켜진다

`try-finally`엔 미묘한 함정이 있습니다. `try` 블록과 `finally`의 `close()`에서 **둘 다 예외가 나면, 나중에 난 `close()` 예외가 앞의 진짜 원인을 덮어버립니다.** 디버깅할 때 정작 중요한 첫 예외가 사라지는 거죠.

## 해결: try-with-resources

`AutoCloseable`을 구현한 자원이라면 **try-with-resources**로 훨씬 깔끔하게 쓸 수 있습니다.

```java
// ✅ try-with-resources
try (InputStream in = new FileInputStream(src);
     OutputStream out = new FileOutputStream(dst)) {
    byte[] buf = new byte[1024];
    int n;
    while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
}
// 블록을 벗어나면 선언의 '역순'으로 close()가 자동 호출됨
```

- 자원을 `()` 안에 선언하면, 블록이 끝날 때 **자동으로 `close()`** 됩니다(여러 개면 역순).
- 코드가 짧고 명확해집니다.

## 억제된 예외(Suppressed)

try-with-resources는 예외 문제도 해결합니다. `try` 본문과 `close()` 양쪽에서 예외가 나면, **본문의 예외가 주(primary)** 가 되고 `close()`의 예외는 **"억제됨(suppressed)"** 으로 함께 보존됩니다. 스택 트레이스에 `Suppressed:`로 표시되어 둘 다 볼 수 있죠.

```java
try {
    // ...
} catch (IOException e) {
    for (Throwable sup : e.getSuppressed()) {
        // close()에서 발생해 억제된 예외들
    }
}
```

`catch` 절도 함께 쓸 수 있어, 자원 정리와 예외 처리를 한 구조로 묶을 수 있습니다.

## 정리

- 자원 회수는 **`try-finally` 대신 `try-with-resources`**.
- 코드가 짧고, 여러 자원도 깔끔하게(역순 자동 close).
- **억제된 예외** 메커니즘으로 진짜 원인 예외가 사라지지 않는다.
- 전제: 자원이 [`AutoCloseable`을 구현](/posts/effective-java-item8/)해야 한다.

---
title: "개발과 운영의 외부 API 키를 가르는 법"
date: 2023-03-11 10:30:00 +0900
categories: [Infra]
tags: [external-api, profiles, api-key, environment, http-client, config]
description: "외부 연동 시 환경별 키·엔드포인트를 프로파일로 분기하고, 개발 빌드에서 실제 발송을 막는 가드와 HTTP 자원을 안전하게 닫는 패턴을 정리한다."
---

외부 메일·주소록 같은 API를 붙일 때 가장 무서운 사고는 코드 버그가 아니라 **개발 환경이 운영 데이터를 건드리는 것**이다. 로컬에서 테스트 메일을 보낸다는 게 운영 키로 실제 고객 수만 명에게 발송되는 식이다. 이 글은 환경별 키 분기, 운영 호출 차단 가드, 그리고 HTTP 자원을 새지 않게 닫는 패턴을 다룬다.

## 핵심: 키는 코드가 아니라 환경에 산다

API 키·엔드포인트·리스트 식별자 같은 값을 코드에 박으면 환경을 가를 수 없고, 깃 히스토리에 비밀이 남는다. 스프링 프로파일로 환경별 설정을 분리하고, 값은 **환경변수/시크릿**으로 주입한다.

```yaml
# application.yml (공통 — 비밀 없음)
external:
  mail:
    enabled: true
    base-url: ${MAIL_API_URL}
    api-key: ${MAIL_API_KEY}     # 실제 값은 환경변수로

---
# application-dev.yml
external:
  mail:
    enabled: false               # 개발에선 실제 발송 자체를 끈다
```

핵심은 `enabled` 플래그다. 개발 프로파일에선 발송 기능 자체를 꺼서, 키가 잘못 주입되어도 외부로 나가지 않게 한다.

## 운영 호출 차단 가드

설정 분기만으로는 부족하다. 코드에 **이중 가드**를 둔다.

```java
@Service
@RequiredArgsConstructor
public class MailGateway {
    private final MailProperties props;   // @ConfigurationProperties

    public void send(MailRequest req) {
        if (!props.isEnabled()) {
            log.info("[mail] disabled in this profile, skip: {}", req.getSubject());
            return;                        // 개발/테스트에선 조용히 건너뜀
        }
        post(props.getBaseUrl(), props.getApiKey(), req);
    }
}
```

`enabled=false`면 호출을 시도조차 하지 않는다. 설정 실수로 운영 키가 개발에 흘러들어도, 코드의 가드가 마지막 방어선이 된다. "설정과 코드 두 군데서 막는다"가 외부 발송류의 기본 자세다.

## HTTP 자원은 try/finally로 닫는다

외부 호출은 커넥션·스트림 같은 자원을 연다. 예외가 나도 반드시 닫혀야 커넥션 풀이 고갈되지 않는다.

```java
public String post(String url, String apiKey, MailRequest body) {
    HttpURLConnection conn = null;
    try {
        conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(3000);          // 타임아웃은 필수
        conn.setReadTimeout(5000);
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Authorization", "Bearer " + apiKey);
        conn.setDoOutput(true);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(toJson(body).getBytes(StandardCharsets.UTF_8));
        }
        return readResponse(conn);
    } catch (IOException e) {
        throw new ExternalApiException("mail send failed", e);
    } finally {
        if (conn != null) conn.disconnect();   // 무슨 일이 있어도 닫는다
    }
}
```

`try-with-resources`로 스트림을 닫고, 커넥션은 `finally`에서 `disconnect`한다. **타임아웃을 안 걸면** 외부가 응답을 안 줄 때 스레드가 무한정 묶여 풀이 말라버린다 — 외부 호출엔 connect/read 타임아웃이 항상 있어야 한다.

## 운영 함정

- **로그에 키를 찍는 실수.** 디버깅한다고 헤더 전체를 로그로 남기면 `Authorization`의 키가 평문으로 남는다. 외부 호출 로깅은 키를 마스킹해야 한다.
- **재시도가 멱등성을 깬다.** 타임아웃 났다고 무턱대고 재시도하면, 사실 발송은 성공했는데 클라이언트만 실패로 본 경우 중복 발송이 된다. 멱등 키(요청 식별자)를 외부 API가 지원하면 그걸 실어야 안전하다.

## 핵심 요약

- 키·엔드포인트는 코드가 아닌 프로파일/환경변수로. 개발 프로파일은 `enabled=false`로 발송을 끈다.
- 설정 분기와 코드 가드, 두 겹으로 운영 호출을 막는다.
- 외부 호출엔 타임아웃과 `finally` 자원 해제가 필수. 재시도는 멱등성을 확인하고.

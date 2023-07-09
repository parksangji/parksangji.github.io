---
title: "같은 핸들러로 HTML과 JSON을 모두 줄 때"
date: 2023-07-09 10:30:00 +0900
categories: [Backend]
tags: [content-negotiation, accept, view, json, controller]
description: "같은 데이터를 화면(HTML)과 API(JSON)로 분기하는 콘텐츠 협상의 원리와, 컨트롤러의 책임을 깔끔히 나누는 설계를 다룬다."
---

같은 리소스를 브라우저는 화면으로, 모바일·외부 연동은 JSON으로 받고 싶어 한다. 이때 흔한 유혹은 `getUserList`와 `getUserListJson` 두 개의 메서드를 만들고 조회 로직을 복붙하는 것이다. 데이터를 만드는 일은 같은데 *표현 형식*만 다를 뿐인데도 말이다. Spring MVC는 이 분기를 위해 **콘텐츠 협상(content negotiation)** 이라는 메커니즘을 기본 제공한다.

## 콘텐츠 협상은 누가 결정하는가

클라이언트는 요청에 `Accept` 헤더로 "나는 이런 형식을 원한다"를 알린다. 브라우저는 보통 `Accept: text/html...`, API 클라이언트는 `Accept: application/json`을 보낸다. 서버는 이 헤더와 **자신이 생산할 수 있는 형식**의 교집합에서 최적을 골라 응답한다.

Spring에서 이 결정을 내리는 것이 `ContentNegotiationManager`다. 우선순위는 보통 (1) URL 확장자나 파라미터(`?format=json`) → (2) `Accept` 헤더 순이며, 최신 설정에선 헤더 기반을 권장한다. 핸들러가 반환한 객체를 두고, 매니저가 협상한 미디어 타입에 맞는 `HttpMessageConverter`(JSON이면 `MappingJackson2HttpMessageConverter`)를 골라 직렬화한다. 같은 컨트롤러 메서드라도 협상 결과에 따라 **뷰 렌더링**으로 갈지 **메시지 컨버터 직렬화**로 갈지가 갈린다.

## 핵심은 "데이터 생성"과 "표현"의 분리

좋은 설계의 원칙은 명확하다. **조회/가공 로직은 서비스가 한 번만** 하고, 컨트롤러는 그 결과를 어떤 형식으로 내보낼지만 결정한다. 표현 형식이 달라진다고 비즈니스 로직이 두 벌이 되어선 안 된다.

```java
@Controller
@RequestMapping("/users")
public class UserController {

    private final UserService userService;

    // HTML 뷰 — 서버 사이드 렌더링
    @GetMapping(produces = MediaType.TEXT_HTML_VALUE)
    public String list(UserSearch cond, Model model) {
        model.addAttribute("users", userService.search(cond));
        return "users/list";              // 뷰 이름 → 템플릿 렌더링
    }

    // JSON — 같은 서비스, 다른 표현
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public List<UserDto> listJson(UserSearch cond) {
        return userService.search(cond);  // 객체 → 메시지 컨버터 직렬화
    }
}
```

`produces` 속성이 핵심이다. 같은 URL·메서드에 대해 Spring은 요청의 `Accept`를 보고 둘 중 매칭되는 핸들러로 라우팅한다. `text/html`을 원하면 첫 번째, `application/json`을 원하면 두 번째가 선택된다. 두 메서드 모두 `userService.search(cond)`라는 **동일한 데이터 소스**를 쓴다는 점이 중요하다. 분기되는 것은 오직 표현 계층뿐이다.

`@Controller`에 `@ResponseBody`를 붙이면 "뷰 이름이 아니라 반환 객체 자체가 본문"이라는 신호다. 클래스 전체가 JSON 전용이면 `@RestController`(= `@Controller` + `@ResponseBody`)를 쓴다.

## 운영 함정

**Accept를 안 보내는 클라이언트.** 일부 구형 클라이언트나 잘못 설정된 fetch는 `Accept: */*`를 보낸다. 이러면 서버의 기본 우선순위에 따라 엉뚱한 형식이 나갈 수 있다. API 엔드포인트는 `produces`를 명시하고, 협상 실패 시 `406 Not Acceptable`을 받는 것이 모호한 HTML 응답보다 낫다. JSON API라면 차라리 경로를 `/api/...`로 분리해 협상에 기대지 않는 것도 견고한 선택이다.

**뷰 전용 모델을 JSON에 흘리지 마라.** HTML 뷰엔 페이징 위젯용 부가 데이터가 붙기 쉬운데, 같은 객체를 JSON으로 직렬화하면 의도치 않은 내부 필드까지 노출된다. 표현별로 DTO를 분리하거나, 직렬화 대상 필드를 명시적으로 통제하라.

## 핵심 요약

- 콘텐츠 협상은 `Accept` 헤더와 서버가 생산 가능한 형식의 교집합에서 응답 형식을 고르는 메커니즘이다.
- `produces`로 같은 URL을 형식별 핸들러로 라우팅하되, **데이터 생성 로직은 서비스에서 한 번만** 한다.
- API는 협상에 과하게 기대지 말고 경로 분리·`produces` 명시·`406` 응답으로 모호함을 없앤다.

**면접 한 줄 Q&A.** "`@ResponseBody`는 무슨 일을 하나?" → 반환값을 뷰 이름으로 보지 않고, 협상된 미디어 타입의 메시지 컨버터로 직렬화해 응답 본문에 직접 쓴다.

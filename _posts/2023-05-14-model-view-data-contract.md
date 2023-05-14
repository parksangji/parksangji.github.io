---
title: "컨트롤러가 뷰에 넘기는 데이터의 계약"
date: 2023-05-14 10:30:00 +0900
categories: [Backend]
tags: [mvc, model, view, attribute, contract, dto]
description: "컨트롤러가 Model에 담는 값과 뷰가 기대하는 키의 암묵적 계약. 키 누락이 왜 조용한 실패로 이어지는지, DTO로 어떻게 계약을 명시화하는지 정리한다."
---

이번 주는 화면에 내려줄 데이터를 컨트롤러에서 뷰로 전달하는 부분을 손봤다. 단순해 보이지만 MVC에서 컨트롤러와 뷰 사이에는 **암묵적인 계약**이 있고, 이 계약이 깨질 때 디버깅이 가장 까다롭다.

## Model은 문자열 키로 묶인 약한 계약

Spring MVC에서 컨트롤러는 `Model`에 속성을 담고, 뷰 템플릿은 그 키로 값을 꺼낸다.

```java
@GetMapping("/orders")
public String list(Model model) {
    model.addAttribute("orders", orderService.findAll());
    model.addAttribute("totalCount", orderService.count());
    return "order/list"; // 뷰 이름
}
```

```html
<!-- 뷰: model의 "orders", "totalCount" 키에 의존 -->
<span th:text="${totalCount}">0</span>
<tr th:each="o : ${orders}">...</tr>
```

문제는 이 연결이 **문자열 키 기반의 약한 결합**이라는 점이다. 컨트롤러가 `"orders"`로 담고 뷰가 `${order}`로 꺼내면(오타), 컴파일러는 아무 말도 안 한다. 타입 체크가 없다. 계약이 코드가 아니라 관례로만 존재한다.

## 키 누락은 왜 "조용한 실패"인가

가장 위험한 건 키가 아예 없을 때다. 뷰가 기대하는 키를 컨트롤러가 안 담으면, 많은 템플릿 엔진은 **예외 대신 null/빈 값**으로 처리한다. 즉 화면이 깨지지 않고 그냥 "데이터가 빈 것처럼" 보인다. 사용자는 "목록이 비었네"라고 생각하고, 로그에도 에러가 없다. 원인을 찾으려면 컨트롤러와 뷰를 눈으로 대조해야 한다 — 컴파일러도 런타임도 알려주지 않기 때문이다.

조건 분기에서 특정 경로만 키를 빠뜨리는 경우가 특히 악질이다. 정상 경로는 멀쩡하고 예외 경로에서만 빈 화면이 나온다.

```java
public String list(Model model, @RequestParam(required=false) String q) {
    if (q != null) {
        model.addAttribute("orders", search(q));
        // totalCount 깜빡 → 검색 화면만 카운트가 0으로 보임
    } else {
        model.addAttribute("orders", findAll());
        model.addAttribute("totalCount", count());
    }
    return "order/list";
}
```

## DTO로 계약을 명시화한다

해법은 화면이 필요로 하는 데이터를 **하나의 응답 객체(View DTO)로 묶는 것**이다. 흩어진 속성들을 객체 하나로 모으면, 그 객체의 필드가 곧 "뷰가 받을 데이터의 명세"가 된다. 필드를 빠뜨릴 수 없고(생성자/빌더가 강제), 타입이 보장되며, 변경 시 컴파일러가 도와준다.

```java
public record OrderListView(List<OrderRow> rows, long totalCount, int page) {}

@GetMapping("/orders")
public String list(Model model, PageQuery q) {
    OrderListView view = orderService.buildListView(q); // 한 덩어리
    model.addAttribute("view", view);
    return "order/list";
}
```

```html
<span th:text="${view.totalCount}">0</span>
<tr th:each="r : ${view.rows}">...</tr>
```

엔티티를 그대로 뷰에 넘기지 않고 DTO를 두면 부수 효과로 **과노출 방지**(엔티티의 민감 필드가 화면 변수로 새는 것 차단)와 **지연 로딩 예외 회피**(뷰 렌더 시점에 세션이 닫혀 터지는 문제)도 함께 해결된다.

## 운영 함정

- **엔티티 직접 노출**: 엔티티를 Model에 그대로 담으면 비밀번호 해시 같은 필드가 템플릿에서 접근 가능해지고, 연관 객체 지연 로딩이 뷰에서 터진다. DTO로 끊는다.
- **flash/redirect 속성 분실**: redirect 후에는 일반 Model 속성이 사라진다. `RedirectAttributes`의 flash 속성을 써야 한 번 살아남는다.

## 핵심 요약

- 컨트롤러-뷰는 **문자열 키 기반의 약한 계약**이라 오타·누락이 컴파일에 안 잡힌다.
- 키 누락은 예외 없이 **빈 값으로 조용히 실패**해 디버깅이 어렵다.
- 화면 데이터를 **View DTO 하나로 묶으면** 계약이 코드로 강제되고 과노출·지연로딩 문제도 함께 막힌다.

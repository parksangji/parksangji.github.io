---
title: "MyBatis: WHERE 1=1 대신 trim으로 해결하기"
date: 2024-10-29 11:00:00 +0900
categories: [Backend, MyBatis]
tags: [mybatis, dynamic-sql, trim, where]
image:
  path: /assets/img/posts/mybatis-where-trim.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmihJJAJpuxuwNOLuCQDxTd7jvSLbGkEHBFOKEDNNLEnJOacZCVxTFdCN940hoooExKKKKZJ//2Q=="
  alt: "MyBatis WHERE 1=1 대신 trim"
---

## 동적 조건 검색의 단골 패턴, WHERE 1=1

MyBatis로 검색 쿼리를 짜다 보면, 조건이 선택적으로 붙는 경우가 많습니다. 이름이 있으면 이름으로, 상태가 있으면 상태로 거는 식이죠. 이때 흔히 쓰는 게 `WHERE 1=1` 입니다.

```xml
<select id="search" resultType="User">
  SELECT * FROM users
  WHERE 1=1
  <if test="name != null">
    AND name = #{name}
  </if>
  <if test="status != null">
    AND status = #{status}
  </if>
</select>
```

`WHERE 1=1`을 둔 이유는, 조건이 하나도 없거나 `AND`로 시작해도 SQL이 깨지지 않게 하기 위함입니다. 첫 조건 앞의 `AND`를 `1=1`이 받아주니까요.

## WHERE 1=1의 문제

동작은 하지만 찜찜한 점이 있습니다.

- 항상 참인 `1=1`이 쿼리에 남아 **의미 없는 조건**이 붙습니다.
- 가독성이 떨어지고, "왜 1=1이 있지?"를 모르는 사람에겐 혼란.
- 깔끔한 SQL을 지향한다면 군더더기.

## 해결 1: `<where>` 태그

MyBatis의 `<where>` 태그는 **내부에 조건이 하나라도 있을 때만 `WHERE`를 붙이고, 맨 앞의 `AND`/`OR`를 자동으로 제거**해줍니다.

```xml
<select id="search" resultType="User">
  SELECT * FROM users
  <where>
    <if test="name != null">
      AND name = #{name}
    </if>
    <if test="status != null">
      AND status = #{status}
    </if>
  </where>
</select>
```

- 조건이 하나도 없으면 → `WHERE` 자체가 안 붙음.
- 첫 조건이 `AND name = ...`이어도 → 앞의 `AND`를 떼서 `WHERE name = ...`로.

`1=1` 없이도 깔끔하게 해결됩니다.

## 해결 2: `<trim>` 태그 (더 유연)

`<where>`는 사실 `<trim>`의 특수한 형태입니다. `<trim>`은 접두사/접미사를 직접 제어할 수 있어 더 유연합니다.

```xml
<trim prefix="WHERE" prefixOverrides="AND |OR ">
  <if test="name != null">
    AND name = #{name}
  </if>
  <if test="status != null">
    AND status = #{status}
  </if>
</trim>
```

- `prefix="WHERE"`: 내용이 있으면 앞에 `WHERE`를 붙임.
- `prefixOverrides="AND |OR "`: 내용 맨 앞의 `AND ` 또는 `OR `를 제거.

`UPDATE`의 `SET` 절에도 같은 원리로 `<set>` 태그(또는 `<trim prefix="SET" suffixOverrides=",">`)를 써서 끝의 쉼표를 제거할 수 있습니다.

```xml
<update id="update">
  UPDATE users
  <set>
    <if test="name != null">name = #{name},</if>
    <if test="status != null">status = #{status},</if>
  </set>
  WHERE id = #{id}
</update>
```

## 정리

- `WHERE 1=1`은 동작하지만 **군더더기**다.
- `<where>`: 조건 있을 때만 `WHERE`, 맨 앞 `AND/OR` 자동 제거.
- `<trim>`: `prefix`/`prefixOverrides`로 더 유연하게 제어(`<where>`의 일반형).
- `UPDATE`엔 `<set>`으로 끝 쉼표 정리. 깔끔한 동적 SQL을 만들자.

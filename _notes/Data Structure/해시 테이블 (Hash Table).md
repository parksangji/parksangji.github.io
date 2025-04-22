---
title: 해시 테이블 (Hash Table)
category: Data Structure
layout: note
---

해시 테이블은 키(Key)를 값(Value)에 매핑하는 자료구조이다. 해시 함수를 사용하여 키를 해시 값으로 변환하고, 이 해시 값을 배열의인덱스로 사용하여 값을 저장하거나 검색한다. 해시 테이블은 평균적으로 매우 빠른 검색, 삽입, 삭제 속도(O(1))를 제공한다. 

구성 요소:
- 키(Key): 저장하거나 검색할 데이터를 식별하는 고유한 값이다. 
- 값(Value): 키와 연결된 데이터이다.
- 해시 함수(Hash Function): 키를 해시 값(배열의 인덱스)으로 변환하는 함수이다. 좋은 해시 함수는 키를 가능한 한 균든하게 분산시켜 해시 충돌(Collision)을 최소화해야한다.
- 해시 값(Hash Value): 해시 함수에 의해 생성된 정수 값으로, 배열의 인덱스로 사용된다. 
- 버킷(Bucket) / 슬롯(Slot): 배열의 각 요소로, 키-값 쌍이 저장되는 공간이다. 

![[스크린샷 2025-03-24 오후 4.09.45.png]]

해시 충돌 (Collision):
서로 다른 키가 동일한 해시 값을 가지는 경우를 해시 충돌이라고 한다. 해시 충돌은 해시 테이블의 성능을 저하시키는 주요 원인이므로, 이를 해결하기 위한 방법이 필요한다. 
	1. 개방 주소법(Open Addressing):
		- 충돌이 발생하면, 다른 빈 버킷을 찾아 데이터를 저장하는 방법
		- 선형 탐사(Linear Probing): 충돌 발생 시, 다른 인덱스로 이동하여 빈 버킷을 찾는다.
		- 제곱 탐사(Quadratic Probing): 충돌 발생 시, 제곱만큼 떨어진 인덱스로 이동하여 빈 버킷을 찾는다. 
		- 이중 해싱(Double Hashing): 다른 해시 함수를 사용하여 이동할 거리를 계산한다. 
	2. 분리 연결법(Separete Chaining):
		- 각 버킷을 연결 리스트 또는 트리로 만들어, 충돌이 발생한 키 값 쌍을 해당 버킷의 연결 리스트에 추가하는 방법
		- Java의 HashMap은 분리 연결법을 사용하며, 버킷의 연결 리스트가 길어지면 성능 향상을 위해 트리로 구조(Red-Black Tree)를 변경한다.
		![[스크린샷 2025-03-24 오후 4.14.58.png]]

```java
import java.util.HashMap;
import java.util.Map;

public class HashTableExample {

    public static void main(String[] args) {

        Map<String, Integer> hashMap = new HashMap<>();

        // 데이터 삽입
        hashMap.put("apple", 1);
        hashMap.put("banana", 2);
        hashMap.put("cherry", 3);

        // 데이터 검색
        System.out.println("Value of apple: " + hashMap.get("apple")); // Output: 1

        // 데이터 삭제
        hashMap.remove("banana");

        // 데이터 존재 여부 확인
        System.out.println("Is banana present? " + hashMap.containsKey("banana")); // Output: false

        // 모든 키-값 쌍 출력
        for (Map.Entry<String, Integer> entry : hashMap.entrySet()) {
            System.out.println(entry.getKey() + ": " + entry.getValue());
        }
    }
}
```
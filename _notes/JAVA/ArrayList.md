---
title: ArrayList
category: JAVA
---
- 배열 기반의 리스트 구현체.
- 내부적으로 배열을 사용하여 요소를 저장.
- 인덱스를 이용한 빠른 접근(O(1)).
- 요소의 삽입/삭제는 느림 (최악의 경우 O(n)).
- 크기가 동적으로 조절됨.

```java 
List<String> arrayList = new ArrayList<>();
arrayList.add("apple");
arrayList.add("banana");
arrayList.add(1, "orange"); // 중간 삽입

String fruit = arrayList.get(0); // 접근

arrayList.remove(2);
arrayList.remove("banana");

int size = arrayList.size();

boolean isEmpty = arrayList.isEmpty();
boolean contains = arrayList.contains("apple");
```

- **초기 용량(capacity) 설정:** `ArrayList`는 요소를 추가할 때 용량이 부족하면 새로운 배열을 할당하고 기존 요소를 복사하는 과정을 거칩니다. 잦은 용량 변경은 성능 저하를 유발할 수 있습니다. 따라서, 저장할 요소의 개수를 예측할 수 있다면, 생성 시점에 적절한 초기 용량을 설정하여 불필요한 배열 복사를 줄일 수 있습니다.
    
    ```java
    List<Integer> numbers = new ArrayList<>(1000); // 초기 용량 1000으로 설정
    ```
    
- **`ensureCapacity()` 활용:** `ensureCapacity()` 메서드를 사용하여 미리 용량을 확보할 수 있습니다. 대량의 데이터를 한 번에 추가하기 전에 호출하면 성능 향상에 도움이 됩니다.
    
    ```java
    numbers.ensureCapacity(2000); // 최소 2000개의 요소를 저장할 수 있도록 용량 확보
    ```
    
- **`trimToSize()` 활용:** `trimToSize()` 메서드를 사용하여 현재 요소 개수에 맞춰 용량을 줄일 수 있습니다. 메모리 사용량을 최적화할 때 유용합니다. (단, 이후에 요소를 추가하면 다시 용량 증가가 발생할 수 있습니다.)
    
    ```java
    numbers.trimToSize(); // 현재 요소 개수에 맞춰 용량 축소
    ```
    
- **`addAll()`을 이용한 효율적인 리스트 병합:** 여러 개의 리스트를 하나의 리스트로 합칠 때, 반복문을 사용하여 `add()`를 호출하는 것보다 `addAll()`을 사용하는 것이 더 효율적입니다.
    
    ```java 
    List<String> list1 = Arrays.asList("a", "b", "c");
    List<String> list2 = Arrays.asList("d", "e", "f");
    List<String> combinedList = new ArrayList<>();
    combinedList.addAll(list1);
    combinedList.addAll(list2); // 효율적인 리스트 병합
    ```
    
- **`subList` 활용:** `subList` 를 사용하면 원래 리스트의 일부를 나타내는 새로운 리스트를 만들 수 있습니다. 이 때, _새 리스트는 별도의 데이터를 가지는 게 아니라 원래 리스트를 가리키고 있습니다._ 따라서 `subList`에서 수정이 일어나면 원래 리스트도 변경되고, 반대도 마찬가지입니다.
    

```java
    List<Integer> numbers = new ArrayList<>(Arrays.asList(0, 1, 2, 3, 4, 5, 6, 7, 8, 9));
    List<Integer> subList = numbers.subList(2, 5); // [2, 3, 4] - numbers의 2,3,4 인덱스
    System.out.println(subList);  // [2, 3, 4]
    subList.set(0, 99); // subList를 변경
    System.out.println(subList); // [99, 3, 4]
    System.out.println(numbers); // [0, 1, 99, 3, 4, 5, 6, 7, 8, 9] - 원본도 변경됨

    // subList를 이용한 부분 삭제
    numbers.subList(2,5).clear();  // 인덱스 2, 3, 4 삭제
    System.out.println(numbers); // [0, 1, 5, 6, 7, 8, 9]
```
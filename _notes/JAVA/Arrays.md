---
title: Arrays
category: JAVA
layout: note
---

`Arrays` 클래스는 배열을 다루기 위한 다양한 유틸리티 메서드를 제공하는 클래스입니다. 배열의 복사, 정렬, 검색, 비교 등 배열과 관련된 작업들을 손쉽게 처리할 수 있도록 도와줍니다.

**주요 기능:**

- **배열 복사:**
    - `copyOf(originalArray, newLength)`: 지정된 길이만큼 새로운 배열로 복사합니다.
    - `copyOfRange(originalArray, from, to)`: 지정된 범위의 요소를 새로운 배열로 복사합니다.
- **배열 정렬:**
    - `sort(array)`: 배열의 요소를 오름차순으로 정렬합니다.
    - `sort(array, fromIndex, toIndex)`: 지정된 범위의 요소를 오름차순으로 정렬합니다.
    - `sort(array, Comparator)`: `Comparator`를 사용하여 사용자 정의 정렬을 수행합니다. (예: 내림차순)
- **배열 검색:**
    - `binarySearch(array, key)`: 정렬된 배열에서 이진 검색을 사용하여 지정된 키의 인덱스를 찾습니다. (배열은 반드시 정렬되어 있어야 합니다.)
- **배열 비교:**
    - `equals(array1, array2)`: 두 배열의 내용이 같은지 비교합니다.
    - `deepEquals(array1, array2)`: 다차원 배열의 내용까지 재귀적으로 비교합니다.
- **배열 채우기:**
    - `fill(array, value)`: 배열의 모든 요소를 지정된 값으로 채웁니다.
    - `fill(array, fromIndex, toIndex, value)`: 지정된 범위의 요소를 지정된 값으로 채웁니다.
- **배열을 List로 변환:**
    - `asList(array)`: 배열을 `List`로 변환합니다. (단, 반환된 `List`는 크기를 변경할 수 없습니다.)

**예제:**

```java
import java.util.Arrays;
import java.util.Comparator;

public class ArraysExample {

    public static void main(String[] args) {
        int[] numbers = {5, 2, 8, 1, 9, 4};

        // 배열 복사
        int[] copiedNumbers = Arrays.copyOf(numbers, numbers.length);
        System.out.println("Copied Array: " + Arrays.toString(copiedNumbers)); // [5, 2, 8, 1, 9, 4]

        // 배열 정렬 (오름차순)
        Arrays.sort(numbers);
        System.out.println("Sorted Array: " + Arrays.toString(numbers)); // [1, 2, 4, 5, 8, 9]

        // 배열 정렬 (내림차순) - Comparator 사용
        Integer[] numbers2 = {5, 2, 8, 1, 9, 4}; // Integer[] 사용해야함
        Arrays.sort(numbers2, Comparator.reverseOrder());
        System.out.println("Reverse Sorted Array: " + Arrays.toString(numbers2)); // [9, 8, 5, 4, 2, 1]
       
        // 배열 검색 (이진 검색 - 정렬된 배열에서만 사용 가능)
        int index = Arrays.binarySearch(numbers, 8);
        System.out.println("Index of 8: " + index); // 4

        // 배열 비교
        int[] numbers3 = {1, 2, 4, 5, 8, 9};
        boolean areEqual = Arrays.equals(numbers, numbers3);
        System.out.println("Arrays are equal: " + areEqual); // true

        // 배열 채우기
        Arrays.fill(numbers, 0);
        System.out.println("Filled Array: " + Arrays.toString(numbers)); // [0, 0, 0, 0, 0, 0]
        
        // 배열을 List로
        String[] strArray = {"a", "b", "c"};
        List<String> strList = Arrays.asList(strArray);
        System.out.println("List from array: " + strList); // [a, b, c]
        // strList.add("d");  // UnsupportedOperationException 발생 - 크기 변경 불가
    }
}
```


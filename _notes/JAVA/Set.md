---
title: Set
category: JAVA
layout: note
---
- 중복되지 않는 요소들의 집합.
- 순서를 보장하지 않음 (HashSet).

**기본 사용법:**

```java
Set<String> set = new HashSet<>();
set.add("apple");
set.add("banana");
set.add("apple"); // 중복은 무시됨
boolean contains = set.contains("banana");
set.remove("banana");
int size = set.size();
boolean isEmpty = set.isEmpty();
```

- **`HashSet`:** 해시 테이블 기반의 `Set` 구현체. 빠른 검색, 삽입, 삭제 (평균 O(1)). 순서 보장 X.
    
- **`LinkedHashSet`:** 삽입 순서를 유지하는 `Set` 구현체. `HashSet`과 거의 동일한 성능을 가지면서, 요소를 추가한 순서대로 순회할 수 있습니다.
    
- **`TreeSet`:** 정렬된 순서로 요소를 저장하는 `Set` 구현체. 레드-블랙 트리(red-black tree) 기반. 요소들은 `Comparable` 인터페이스 또는 생성자에 제공된 `Comparator`에 따라 정렬됩니다. 검색, 삽입, 삭제는 O(log n) 시간이 걸립니다.
    
    ```java
    // TreeSet (자동으로 오름차순 정렬)
    Set<Integer> treeSet = new TreeSet<>();
    treeSet.add(5);
    treeSet.add(1);
    treeSet.add(3);
    treeSet.add(1); // 중복 무시
    System.out.println(treeSet); // [1, 3, 5]
    
    // TreeSet (Comparator를 사용한 내림차순 정렬)
    Set<Integer> treeSetDescending = new TreeSet<>(Comparator.reverseOrder());
    treeSetDescending.addAll(Arrays.asList(5, 1, 3));
    System.out.println(treeSetDescending); // [5, 3, 1]
    ```
    
- **집합 연산 활용:** `Set` 인터페이스는 집합 연산(합집합, 교집합, 차집합)을 위한 메서드를 제공합니다.
    
    ```java
    Set<Integer> set1 = new HashSet<>(Arrays.asList(1, 2, 3));
    Set<Integer> set2 = new HashSet<>(Arrays.asList(3, 4, 5));
    
    // 합집합 (union)
    Set<Integer> union = new HashSet<>(set1);
    union.addAll(set2); // set1의 복사본을 만들고, 여기에 set2를 추가
    System.out.println("Union: " + union); // [1, 2, 3, 4, 5]
    
    // 교집합 (intersection)
    Set<Integer> intersection = new HashSet<>(set1);
    intersection.retainAll(set2);  // set1과 set2에 공통으로 있는 요소만 남김
    System.out.println("Intersection: " + intersection); // [3]
    
    // 차집합 (difference)
    Set<Integer> difference = new HashSet<>(set1);
    difference.removeAll(set2);  // set1에서 set2의 요소를 제거
    System.out.println("Difference: " + difference); // [1, 2]
    ```
    
- **`EnumSet`**: `enum` 타입만을 위한 `Set` 구현입니다. 매우 효율적이고, 비트 연산을 사용하여 구현되어 있습니다.
    
    ```java
    enum Day { MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY }
    
    // EnumSet 생성
    EnumSet<Day> weekdays = EnumSet.range(Day.MONDAY, Day.FRIDAY);
    System.out.println("Weekdays: " + weekdays); // [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY]
    
    EnumSet<Day> weekend = EnumSet.complementOf(weekdays); // 여집합
    System.out.println("Weekend: " + weekend);  // [SATURDAY, SUNDAY]
    ```
---
title: Collections
category: JAVA
layout: note
---
Collections Framework는 여러 개의 객체를 효율적으로 저장, 관리, 처리할 수 있는 다양한 자료구조 클래스와 인터페이스를 제공하는 라이브러리입니다. `List`, `Set`, `Map`, `Queue`, [[Stack]] 등의 인터페이스와 그 구현체들을 포함합니다.

**주요 인터페이스:**

- **`List` (순서 O, 중복 O):**
    - [[ArrayList]]: 배열 기반의 리스트, 빠른 접근 속도, 삽입/삭제는 느림.
    - [[LinkedList]]: 연결 리스트 기반, 삽입/삭제는 빠르지만, 접근 속도는 느림.
    - `Vector`: `ArrayList`와 유사하지만, 동기화(synchronized)를 지원하여 스레드 안전(thread-safe)함. (성능은 `ArrayList`보다 느림)
- **[[Set]] (순서 X, 중복 X):**
    - `HashSet`: 해시 테이블 기반, 빠른 검색 속도. 순서 보장 X.
    - `LinkedHashSet`: `HashSet`과 유사하지만, 삽입 순서를 유지.
    - `TreeSet`: 레드-블랙 트리 기반, 정렬된 순서로 요소를 저장. (정렬 기준은 `Comparable` 또는 `Comparator`로 지정)
- **`Map` (키-값 쌍, 키 중복 X, 값 중복 O):**
    - [[HashMap]]: 해시 테이블 기반, 빠른 검색 속도. 순서 보장 X.
    - `LinkedHashMap`: `HashMap`과 유사하지만, 삽입 순서를 유지.
    - `TreeMap`: 레드-블랙 트리 기반, 키를 정렬된 순서로 저장. (정렬 기준은 `Comparable` 또는 `Comparator`로 지정)
- **[[Queue]] (FIFO, First-In-First-Out):**
    - [[LinkedList]]: `Queue` 인터페이스를 구현하는 클래스 중 하나.
    - [[PriorityQueue]]: 우선순위 큐. 요소들은 `Comparable` 또는 `Comparator`에 의해 정렬된 순서대로 꺼내짐.

**[[Collections]] 클래스:**

`Collections` 클래스는 `Collection` 객체를 다루기 위한 다양한 유틸리티 메서드(static)를 제공합니다. (정렬, 검색, 동기화 등)

- `sort(List)`: 리스트를 정렬합니다.
- `binarySearch(List, key)`: 정렬된 리스트에서 이진 검색을 수행합니다.
- `reverse(List)`: 리스트의 요소 순서를 뒤집습니다.
- `shuffle(List)`: 리스트의 요소를 무작위로 섞습니다.
- `max(Collection)`, `min(Collection)`: 컬렉션에서 최대/최소값을 찾습니다.
- `synchronizedXXX()` 메서드들 (예: `synchronizedList(List)`, `synchronizedSet(Set)`): 동기화된(thread-safe) 컬렉션을 반환합니다.

```java
import java.util.*;

public class CollectionsExample {

    public static void main(String[] args) {
        // List (ArrayList)
        List<String> names = new ArrayList<>();
        names.add("Alice");
        names.add("Bob");
        names.add("Charlie");
        names.add("Alice"); // 중복 허용

        System.out.println("List: " + names); // [Alice, Bob, Charlie, Alice]

        // Set (HashSet)
        Set<Integer> numbers = new HashSet<>();
        numbers.add(3);
        numbers.add(1);
        numbers.add(2);
        numbers.add(3); // 중복 무시

        System.out.println("Set: " + numbers); // [1, 2, 3] (순서 보장 X)

        // Map (HashMap)
        Map<String, Integer> ages = new HashMap<>();
        ages.put("Alice", 30);
        ages.put("Bob", 25);
        ages.put("Charlie", 35);
        ages.put("Alice", 32); // 키 중복 시 값 업데이트

        System.out.println("Map: " + ages); // {Alice=32, Bob=25, Charlie=35} (순서 보장 X)
        
        // Queue (LinkedList)
        Queue<String> queue = new LinkedList<>();
        queue.offer("Task 1");
        queue.offer("Task 2");
        queue.offer("Task 3");

        System.out.println("Queue: " + queue); // [Task 1, Task 2, Task 3]
        System.out.println("Dequeue: " + queue.poll()); // Dequeue: Task 1
        System.out.println("Queue after dequeue: " + queue); // [Task 2, Task 3]

        // Collections 클래스 사용
        Collections.sort(names); // names 리스트 정렬
        System.out.println("Sorted List: " + names); // [Alice, Alice, Bob, Charlie]

        int index = Collections.binarySearch(names, "Bob"); // 이진 검색
        System.out.println("Index of Bob: " + index); // 2
    }
}
```


```java
import java.util.*;

public class CollectionsUtilityExample {

    public static void main(String[] args) {

        // 예제에 사용할 List 생성 (String)
        List<String> stringList = new ArrayList<>(Arrays.asList("banana", "apple", "orange", "grape", "kiwi"));

        // 1. sort(List): 리스트 정렬 (오름차순)
        Collections.sort(stringList);
        System.out.println("Sorted String List (Ascending): " + stringList);
        // 결과: [apple, banana, grape, kiwi, orange]

        // 1-2. sort + Comparator (내림차순)
        // Comparator를 사용해 내림차순 정렬
        Collections.sort(stringList, Comparator.reverseOrder());
        System.out.println("Sorted String List (Descending): " + stringList);
        // 결과: [orange, kiwi, grape, banana, apple]

        // 예제에 사용할 List 생성 (Integer) - binarySearch를 위해
        List<Integer> numberList = new ArrayList<>(Arrays.asList(1, 3, 5, 7, 9, 11, 13));

        // 2. binarySearch(List, key): 정렬된 리스트에서 이진 검색
        // (주의: binarySearch는 반드시 정렬된 리스트에서 사용해야 합니다!)
        int index = Collections.binarySearch(numberList, 7);
        System.out.println("Index of 7 in numberList: " + index); // 3
        int notFoundIndex = Collections.binarySearch(numberList, 8);
        System.out.println("Index of 8 (not found): " + notFoundIndex); // -5 (삽입될 위치 - 1)

        // 3. reverse(List): 리스트 요소 순서 뒤집기
        Collections.reverse(stringList);
        System.out.println("Reversed String List: " + stringList);
        // 결과: [apple, banana, grape, kiwi, orange] (원래 리스트가 변경됨)

        // 4. shuffle(List): 리스트 요소 무작위로 섞기
        Collections.shuffle(stringList);
        System.out.println("Shuffled String List: " + stringList);
        // 결과: 매번 실행 시 다른 순서로 섞임 (예: [kiwi, apple, orange, grape, banana])

        // 5. max(Collection), min(Collection): 최대/최소값 찾기
        String maxString = Collections.max(stringList);
        String minString = Collections.min(stringList);
        System.out.println("Max String: " + maxString);  // 사전순으로 가장 뒤에 오는 문자열
        System.out.println("Min String: " + minString); // 사전순으로 가장 앞에 오는 문자열

        // 5-2 max, min with Comparator
        String maxStringLength = Collections.max(stringList, Comparator.comparingInt(String::length)); //길이
        String minStringLength = Collections.min(stringList, Comparator.comparingInt(String::length));
        System.out.println("Max String (by length): " + maxStringLength);
        System.out.println("Min String (by length): " + minStringLength);

        Integer maxNumber = Collections.max(numberList);
        Integer minNumber = Collections.min(numberList);
        System.out.println("Max Number: " + maxNumber); // 13
        System.out.println("Min Number: " + minNumber); // 1


        // 6. synchronizedXXX() 메서드: 동기화된 컬렉션 생성
        // (멀티스레드 환경에서 안전하게 컬렉션을 사용하기 위함)
        List<String> synchronizedList = Collections.synchronizedList(new ArrayList<>());
        Set<Integer> synchronizedSet = Collections.synchronizedSet(new HashSet<>());
        Map<String, Integer> synchronizedMap = Collections.synchronizedMap(new HashMap<>());

        // synchronizedList에 스레드 안전하게 데이터 추가 (예시)
        // (실제 멀티스레드 환경에서 테스트해야 의미가 있습니다.)
        synchronizedList.add("Thread-safe String");
        System.out.println("Synchronized List: " + synchronizedList); // [Thread-safe String]

         // nCopies(n, object):  n개의 object를 가지는 List 생성(변경 불가).
        List<String> repeatedList = Collections.nCopies(3, "hello");
        System.out.println("Repeated List: " + repeatedList);  // [hello, hello, hello]
        // repeatedList.add("world"); // UnsupportedOperationException (변경 불가)

        // disjoint(c1, c2) : 두 Collection에 공통 원소가 없으면 true
        List<Integer> list1 = Arrays.asList(1,2,3);
        List<Integer> list2 = Arrays.asList(4,5,6);
        List<Integer> list3 = Arrays.asList(3,7,8);

        boolean noCommon1 = Collections.disjoint(list1, list2); // true
        boolean noCommon2 = Collections.disjoint(list1, list3); // false
        System.out.println("list1 and list2 have no common elements: " + noCommon1);
        System.out.println("list1 and list3 have no common elements: " + noCommon2);

        // frequency(c, o) : Collection 내에 object의 빈도수
        List<String> list4 = Arrays.asList("a", "b", "a", "c", "a");
        int countA = Collections.frequency(list4, "a"); // 3
        System.out.println("Frequency of 'a' in list4: " + countA);

        // replaceAll(list, oldVal, newVal) : 리스트 내의 oldVal을 newVal로 바꿈
        List<String> list5 = Arrays.asList("apple", "banana", "apple", "orange");
        Collections.replaceAll(list5, "apple", "grape");
        System.out.println("List after replacing 'apple' with 'grape': " + list5);
        // [grape, banana, grape, orange]

        // swap(list, i, j) : 리스트 내 i 위치와 j 위치를 바꿈
        Collections.swap(list5, 0, 3); // 첫 번째와 마지막 요소 교환
        System.out.println("List after swapping first and last elements: " + list5);
        // [orange, banana, grape, grape]

        // fill(list, obj): 리스트 내의 모든 원소를 obj로 채움
        List<Integer> list6 = new ArrayList<>(Arrays.asList(1,2,3));
        Collections.fill(list6, 0);
        System.out.println("List after filling with 0: " + list6); // [0, 0, 0]
    }
}
```

**주요 포인트:**

- `Collections.sort()`는 기본적으로 오름차순 정렬을 수행합니다. 내림차순 정렬이나 사용자 정의 정렬을 위해서는 `Comparator`를 사용해야 합니다.
- `Collections.binarySearch()`는 _반드시 정렬된_ 리스트에서만 올바른 결과를 반환합니다. 정렬되지 않은 리스트에서 사용하면 예측할 수 없는 결과가 나올 수 있습니다.
- `Collections.max()`, `Collections.min()`은 컬렉션의 요소들이 `Comparable` 인터페이스를 구현하고 있어야 합니다. 그렇지 않은 경우(또는 다른 기준으로 최대/최소를 구하고 싶은 경우) `Comparator`를 함께 제공해야 합니다.
- `synchronizedXXX()` 메서드들은 멀티스레드 환경에서 여러 스레드가 동시에 컬렉션을 수정할 때 발생할 수 있는 문제를 방지하기 위해 사용됩니다. 일반적인 단일 스레드 환경에서는 굳이 사용할 필요가 없습니다. (오히려 성능 저하를 유발할 수 있습니다.)
- `nCopies`, `disjoint`, `frequency`, `replaceAll`, `swap`, `fill` 등의 메서드들도 상황에 따라 유용하게 활용할 수 있습니다.
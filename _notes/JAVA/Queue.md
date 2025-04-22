---
title: Queue
category: JAVA
layout: note
---

**특징:**

- FIFO (First-In, First-Out) 순서를 따르는 자료구조.
- 데이터를 한쪽 끝(rear)에서 추가하고, 다른 쪽 끝(front)에서 제거.

**기본 사용법 (LinkedList 사용):**

```java
Queue<String> queue = new LinkedList<>();
queue.offer("apple"); // enqueue (추가)
queue.offer("banana");
String fruit = queue.poll(); // dequeue (제거 및 반환)
String peeked = queue.peek(); // (제거하지 않고) front 요소 확인
boolean isEmpty = queue.isEmpty();
int size = queue.size();
```

**고급 기술:**

- **`PriorityQueue`:** 우선순위 큐. 요소들이 `Comparable` 또는 `Comparator`에 의해 정렬된 순서대로 꺼내짐.
    
    ```java
    // 숫자가 작은 순서대로 우선순위가 높은 큐 (오름차순)
    Queue<Integer> priorityQueue = new PriorityQueue<>();
    priorityQueue.offer(5);
    priorityQueue.offer(1);
    priorityQueue.offer(3);
    
    System.out.println(priorityQueue.poll()); // 1
    System.out.println(priorityQueue.poll()); // 3
    System.out.println(priorityQueue.poll()); // 5
    
    // 사용자 정의 정렬 (Comparator 사용 - 내림차순)
    Queue<Integer> pqDesc = new PriorityQueue<>(Comparator.reverseOrder());
    pqDesc.addAll(Arrays.asList(5,1,3));
    System.out.println(pqDesc.poll()); //5
    System.out.println(pqDesc.poll()); //3
    System.out.println(pqDesc.poll()); //1
    
    // 문자열 길이 기준 정렬
    Queue<String> pqString = new PriorityQueue<>(Comparator.comparingInt(String::length));
    pqString.offer("apple");
    pqString.offer("kiwi");
    pqString.offer("banana");
    
    System.out.println(pqString.poll()); // kiwi
    System.out.println(pqString.poll()); // apple
    System.out.println(pqString.poll()); // banana
    ```
    
- **BlockingQueue:** 멀티스레드 환경에서 안전하게 사용할 수 있는 큐. 스레드 간의 데이터 교환에 유용합니다. (`ArrayBlockingQueue`, `LinkedBlockingQueue`, `PriorityBlockingQueue` 등)
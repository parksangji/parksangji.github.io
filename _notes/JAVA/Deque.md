---
title: Deque
category: JAVA
---
**특징:**

- 양쪽 끝에서 삽입과 삭제가 모두 가능한 자료구조.
- 스택(Stack)과 큐(Queue)의 기능을 모두 수행할 수 있습니다.

**기본 사용법:**

```java
Deque<String> deque = new ArrayDeque<>();  // 또는 LinkedList 사용 가능
deque.addFirst("apple"); // 앞쪽에 추가
deque.addLast("banana");  // 뒤쪽에 추가
deque.offerFirst("orange"); // 앞쪽에 추가 (용량 제한이 있을 경우 addFirst 대신 사용)
deque.offerLast("grape");  // 뒤쪽에 추가 (용량 제한이 있을 경우 addLast 대신 사용)

String first = deque.removeFirst(); // 앞쪽에서 제거 및 반환
String last = deque.removeLast();   // 뒤쪽에서 제거 및 반환
String peekFirst = deque.peekFirst(); // 앞쪽 요소 확인 (제거 X)
String peekLast = deque.peekLast(); // 뒤쪽 요소 확인 (제거 X)

```

**고급 기술:**

- **`ArrayDeque` vs. `LinkedList`:**
    
    - `ArrayDeque`: 배열 기반 구현. 일반적으로 `LinkedList`보다 빠릅니다 (특히 중간 삽입/삭제가 없는 경우). 캐시 지역성(cache locality)이 더 좋기 때문입니다. 용량 제한이 있을 수 있습니다 (하지만 자동으로 확장됩니다).
    - `LinkedList`: 연결 리스트 기반 구현. 양쪽 끝에서의 삽입/삭제는 O(1)이지만, 인덱스를 이용한 접근은 O(n)입니다. 용량 제한이 없습니다.
- **Stack 또는 Queue로 활용**:
    
    - **스택(LIFO):** `push()` (addFirst()), `pop()` (removeFirst()), `peek()` (peekFirst()) 메서드 사용
    - **큐(FIFO):** `offer()` (offerLast()), `poll()` (pollFirst()), `peek()` (peekFirst()) 메서드 사용
- **회문(Palindrome) 검사:** Deque를 사용하여 문자열이 회문인지 효율적으로 검사할 수 있습니다.
    
    ```java
    public static boolean isPalindrome(String str) {
        Deque<Character> deque = new ArrayDeque<>();
        for (char c : str.toCharArray()) {
            deque.addLast(Character.toLowerCase(c)); // 소문자로 변환하여 추가
        }
    
        while (deque.size() > 1) {
            if (deque.removeFirst() != deque.removeLast()) {
                return false; // 앞뒤에서 꺼낸 문자가 다르면 회문이 아님
            }
        }
        return true;
    }
    ```
    
- **슬라이딩 윈도우(Sliding Window) 문제:** Deque는 슬라이딩 윈도우 문제를 해결하는 데 유용합니다. 예를 들어, 배열에서 크기가 k인 연속된 부분 배열의 최댓값들을 찾을 때 Deque를 사용할 수 있습니다.
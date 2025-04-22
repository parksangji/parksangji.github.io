**특징:**

- 우선순위 큐. 요소를 꺼낼 때 우선순위가 가장 높은(또는 낮은) 요소부터 꺼냅니다.
- 내부적으로 힙(heap) 자료구조를 사용하여 구현됨.
- 요소들은 `Comparable` 인터페이스를 구현하거나, `PriorityQueue` 생성 시 `Comparator`를 제공하여 정렬 기준을 지정해야 합니다.

**기본 사용법:**

```java
// Integer는 Comparable을 구현하므로, 숫자가 작을수록 우선순위가 높음 (오름차순)
PriorityQueue<Integer> priorityQueue = new PriorityQueue<>();
priorityQueue.offer(5);
priorityQueue.offer(1);
priorityQueue.offer(3);
int highestPriority = priorityQueue.poll(); // 1
```

**고급 기술:**

- **`Comparator`를 사용한 사용자 정의 정렬:**
    
    ```java
    // 문자열 길이에 따라 우선순위를 부여 (길이가 짧을수록 우선순위 높음)
    PriorityQueue<String> stringQueue = new PriorityQueue<>(Comparator.comparingInt(String::length));
    stringQueue.offer("apple");
    stringQueue.offer("kiwi");
    stringQueue.offer("banana");
    String shortest = stringQueue.poll(); // "kiwi"
    ```
    
- **객체의 우선순위 지정:** `Comparable`을 구현한 객체 또는 `Comparator`
    
    ```java
    class Task implements Comparable<Task> {
        int priority;
        String name;
    
        public Task(int priority, String name) {
            this.priority = priority;
            this.name = name;
        }
    
        @Override
        public int compareTo(Task other) {
            return Integer.compare(this.priority, other.priority); // 우선순위(낮을수록 높음)
        }
    
        @Override
        public String toString() {
            return "Task{" + "priority=" + priority + ", name='" + name + '\'' + '}';
        }
    }
    
    PriorityQueue<Task> taskQueue = new PriorityQueue<>();
    taskQueue.offer(new Task(3, "Write code"));
    taskQueue.offer(new Task(1, "Fix bug"));
    taskQueue.offer(new Task(2, "Refactor code"));
    
    System.out.println(taskQueue.poll()); // Task{priority=1, name='Fix bug'}
    ```
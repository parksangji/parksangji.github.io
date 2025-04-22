---
title: 힙 (Heap)
category: Data Structure
layout: note
---

힙은 힙 속성을 만족하는 완전 이진 트리 기반의 자료구조이다. 최댓값이나 최솟값을 빠르게 찾아내기 위해 고안되어 있다. 

완전 이진 트리의 특성 덕분에, 이진 힙은 1차원 배열로 효율적으로 구현할 수 있다. 
	루트 노드는 배열의 첫 번째 인덱스(0 또는 1, 보통 0-based 사용)에 저장된다. 
	배열 인덱스 i에 있는 노드의 자식 및 부모 노드 인덱스는 다음과 같이 계산된다. 
	- 왼쪽 자식: 2 * i + 1
	- 오른 쪽 자식: 2 * i + 2
	- 부모: (i - 1) /  2 (정수 나눗셈)

힙의 주요 연산
1. 삽입
	- 새로운 요소를 힙의 마지막 위치에 추가한다.
	- 새로운 요소와 그 부모 노드를 비교하여 힙 속성을 만족하는지 확인한다. 
	- 만약 새로운 요소가 부모보다 작으면, 부모와 자리를 바꾼다. 
	- 힙 속성이 만족되거나 루트 노드에 도달할 때까지 이 과정을 반복한다. (이를 heapify-up 이라고 한다.)
2. 최소값 삭제 (Delete-min):
	- 루트노드(최소값)를 제거(또는 반환)한다. 
	- 힙의 마지막 요소를 루트 위치로 가져온다. 
	- 새로운 루트 노드와 그 자식 노드들을 비교하여 힙 속성을 만족하는지 확인한다. 
	- 만약 루트 노드가 자식 노드보다 크면, 두 자식 중 더 작은 값을 가진 자식과 자리를 바꾼다. 
	- 힙 속성이 만족되거나 리프 노드에 도달할 때까지 이 과정을 반복한다. (Heapify-down)
	- 시간 복잡도: O(log n) - 트리의 높이 만큼 비교/교환 발생 가능.
3. 최소값 확인(Peek /Get-Min):
	- 루트 노드의 값을 반환한다. 
	- 시간 복잡도: O(1)

힙 만들기 (Build Heap):

임의의 배열을 힙 구조로 만드는 과정이다. 가장 효율적인 방법은 배열의 뒤쪽부터 시작하여 루트노드까지 각 노드에 대해 Heapify-down 연산을 수행하는 것이다. 이 방법은 O(n)의 시간 복잡도를 가진다. 

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.NoSuchElementException;

public class MinHeap {
    private ArrayList<Integer> heap;

    public MinHeap() {
        heap = new ArrayList<>();
    }

    // 부모 인덱스
    private int parent(int i) {
        return (i - 1) / 2;
    }

    // 왼쪽 자식 인덱스
    private int leftChild(int i) {
        return 2 * i + 1;
    }

    // 오른쪽 자식 인덱스
    private int rightChild(int i) {
        return 2 * i + 2;
    }

    // 삽입 연산
    public void insert(int value) {
        heap.add(value); // 마지막 위치에 추가
        heapifyUp(heap.size() - 1); // Heapify-up 수행
    }

    // Heapify-up (Bubble-up)
    private void heapifyUp(int index) {
        // 루트가 아니고, 현재 노드가 부모보다 작으면 교환
        while (index > 0 && heap.get(index) < heap.get(parent(index))) {
            Collections.swap(heap, index, parent(index));
            index = parent(index); // 위로 이동
        }
    }

    // 최소값 삭제 연산
    public int extractMin() {
        if (heap.isEmpty()) {
            throw new NoSuchElementException("Heap is empty");
        }

        int minValue = heap.get(0); // 루트 노드 (최소값)
        int lastValue = heap.remove(heap.size() - 1); // 마지막 노드 제거

        if (!heap.isEmpty()) {
            heap.set(0, lastValue); // 마지막 노드를 루트로 이동
            heapifyDown(0); // Heapify-down 수행
        }

        return minValue;
    }

    // Heapify-down (Bubble-down)
    private void heapifyDown(int index) {
        int left = leftChild(index);
        int right = rightChild(index);
        int smallest = index; // 현재 노드를 가장 작다고 가정

        // 왼쪽 자식이 존재하고, 현재 노드보다 작으면 smallest 갱신
        if (left < heap.size() && heap.get(left) < heap.get(smallest)) {
            smallest = left;
        }
        // 오른쪽 자식이 존재하고, 현재(또는 왼쪽 자식)보다 작으면 smallest 갱신
        if (right < heap.size() && heap.get(right) < heap.get(smallest)) {
            smallest = right;
        }

        // 만약 현재 노드가 가장 작은 값이 아니면 교환하고 재귀 호출
        if (smallest != index) {
            Collections.swap(heap, index, smallest);
            heapifyDown(smallest); // 아래로 이동하여 계속 진행
        }
    }

    // 최소값 확인
    public int peek() {
        if (heap.isEmpty()) {
            throw new NoSuchElementException("Heap is empty");
        }
        return heap.get(0);
    }

    public boolean isEmpty() {
        return heap.isEmpty();
    }

    public int size() {
        return heap.size();
    }

    public static void main(String[] args) {
        MinHeap minHeap = new MinHeap();
        minHeap.insert(3);
        minHeap.insert(1);
        minHeap.insert(6);
        minHeap.insert(5);
        minHeap.insert(2);
        minHeap.insert(4);

        System.out.println("Min Heap elements extracted:");
        while (!minHeap.isEmpty()) {
            System.out.print(minHeap.extractMin() + " "); // 결과: 1 2 3 4 5 6
        }
        System.out.println();

        // Java 표준 라이브러리 PriorityQueue (Min-Heap 기본)
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        pq.offer(3); // insert
        pq.offer(1);
        pq.offer(6);
        System.out.println("PriorityQueue peek: " + pq.peek()); // 1
        System.out.println("PriorityQueue poll: " + pq.poll()); // 1 (extractMin)
        System.out.println("PriorityQueue peek after poll: " + pq.peek()); // 3
    }
}
```


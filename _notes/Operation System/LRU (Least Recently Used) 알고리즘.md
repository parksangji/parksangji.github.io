---
title: LRU (Least Recently Used) 알고리즘
category: Operation System
layout: note
---

페이지 교체 알고리즘: 

운영체제는 메모리 관리의 효율성을 위해 가상 메모리 기법을 사용한다. 가상 메모리는 실제 물리 메모리 (RAM)보다 더 큰 주소 공간을 제공하여 프로그램이 메모리 부족 걱정 없이 실행될 수 있도록 한다. 하지만 모든 데이터를 물리 메모리에 한꺼번에 올릴 수 없기 때문에, 현재 사용되지 않는 데이터는 디스크의 스왑 영역(Swap Area)으로 내보내고(Page-Out), 필요한 데이터를 다시 물리 메모리로 가져오는(Page-In) 과정이 필요하다. 이때 어떤 페이지를 교체할지 결정하는 것이 페이지 교체 알고리즘이다. 

----

LRU 알고리즘은 가장 오랫동안 사용되지 않은 페이지를 교체하는 알고리즘이다. "가장 최근에 사용된 페이지는 가까운 미래에 다시 사용될 가능성이 높다"는 시간 지역성(Temporal Locality)의 원리를 기반으로 한다. 

1. 페이지 참조 기록: 각 페이지가 참조될 때마다 해당 페이지의 참조 시간을 기록한다. (또는 참조 순서를 유지하는 자료구조를 사용한다.)
2. 페이지 폴트(Page Fault) 발생: 필요한 페이지가 물리 메모리에 없을 때 페이지 폴트가 발생한다.
3. 교체 대상 페이지 선택: 물리 메모리가 가득 차 있으면, LRU 알고리즘은 참조시간이 가장 오래된 페이지(가장 오랫동안 사용되지 않은 페이지)를 교체 대상으로 선택한다. 
4. 페이지 교체: 선택된 페이지를 디스크의 스왑 영역으로 내보내고(Page-Out), 필요한 페이지를 물리 메모리로 가져온다(Page-In).

![[Pasted image 20250324173532.png]]

```java 
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedList;
import java.util.Map;

public class LRUCache {

    private final int capacity;
    private final Deque<Integer> pageQueue; // 페이지 번호를 저장하는 큐 (이중 연결 리스트)
    private final Map<Integer, Integer> pageMap;   // 페이지 번호와 값을 저장하는 해시맵

    public LRUCache(int capacity) {
        this.capacity = capacity;
        this.pageQueue = new LinkedList<>();
        this.pageMap = new HashMap<>();
    }

    public int get(int key) {
        if (!pageMap.containsKey(key)) {
            return -1; // 페이지가 캐시에 없음
        }

        // 페이지를 큐의 맨 앞으로 이동 (최근 사용 표시)
        pageQueue.remove(key);
        pageQueue.addFirst(key);

        return pageMap.get(key);
    }

    public void put(int key, int value) {
        if (pageMap.containsKey(key)) {
            // 이미 존재하는 페이지면 큐에서 제거하고 맨 앞으로 이동
            pageQueue.remove(key);
        } else {
            // 새로운 페이지 삽입
            if (pageQueue.size() == capacity) {
                // 캐시가 가득 차면 가장 오래된 페이지 제거 (LRU)
                int removedKey = pageQueue.removeLast();
                pageMap.remove(removedKey);
            }
        }

        // 페이지를 큐의 맨 앞에 추가하고, 해시맵에 저장
        pageQueue.addFirst(key);
        pageMap.put(key, value);
    }
    public static void main(String[] args) {
        LRUCache lruCache = new LRUCache(3); // 캐시 용량 3

        lruCache.put(1, 1);
        lruCache.put(2, 2);
        lruCache.put(3, 3);
        System.out.println(lruCache.get(1));    // 1 (1번 페이지를 참조하면서 맨 앞으로 이동)
        lruCache.put(4, 4);    // 2번 페이지가 제거됨 (가장 오랫동안 사용되지 않음)
        System.out.println(lruCache.get(2));    // -1 (2번 페이지는 캐시에 없음)
        System.out.println(lruCache.get(3));    // 3
        System.out.println(lruCache.get(4));    // 4

    }
}
```
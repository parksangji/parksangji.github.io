---
title: 너비 우선 탐색 (Breadth-First Search, BFS)
category: Algorithm
---

너비 우선 탐색은 그래프 탐색의 한 방법으로, 시작 정점에서 가까운 정점들을 먼저 방문하고, 멀리 있는 정점들을 나중에 방문하는 방식이다. 즉, 시작 정점을 기준으로 같은 레벨에 있는 정점들을 우선적으로 탐색한다. 마치 물에 돌을 던졌을 때 동심원으로 파문이 퍼져나가는 모습과 유사하다. 

----------------------------------------------------------------------
동작방식:
1. 시작 정점 선택 및 큐 삽입: 탐색을 시작할 정점을 선택하고 큐(Queue)에 삽입한다. 또한 해당 정점을 방문했음을 표시한다. 
2. 큐에서 정점 추출: 큐가 비어있지 않은 동안 다음 단계를 반복한다.
	- 큐의 맨앞에 있는 정점을 꺼낸다. (Dequeue)
3. 인접 정점 확인 및 큐 삽입: 꺼낸 정점과 연결된 모든 인접 정점들을 확인한다. 
	- 각 인접 정점에 대해, 아직 방문하지 않았다면 방문했음을 표시하고 큐에 삽입한다. (Enqueue)
4. 종료: 큐가 빌 때까지 2-3단계를 반복한다. 큐가 비면 탐색이 종료된다. 

```java
import java.util.*;

// 이전 DFS 예제의 Graph 클래스 재사용 가능
class Graph_BFS { // 클래스 이름 변경 (중복 방지)
    private int V;
    private LinkedList<Integer>[] adj;

    Graph_BFS(int v) {
        V = v;
        adj = new LinkedList[v];
        for (int i = 0; i < v; ++i) {
            adj[i] = new LinkedList<>();
        }
    }

    void addEdge(int v, int w) {
        adj[v].add(w);
    }

    // BFS
    void BFS(int startVertex) {
        boolean[] visited = new boolean[V]; // 방문 여부 배열
        Queue<Integer> queue = new LinkedList<>(); // BFS를 위한 큐

        visited[startVertex] = true; // 시작 노드 방문 처리 및 큐에 삽입
        queue.offer(startVertex);

        System.out.print("BFS starting from vertex " + startVertex + ": ");

        while (!queue.isEmpty()) {
            int v = queue.poll(); // 큐에서 노드 하나를 꺼냄
            System.out.print(v + " ");

            // 꺼낸 노드와 연결된 모든 인접 노드 확인
            Iterator<Integer> i = adj[v].listIterator();
            while (i.hasNext()) {
                int n = i.next();
                if (!visited[n]) { // 방문하지 않은 노드라면
                    visited[n] = true; // 방문 처리
                    queue.offer(n); // 큐에 삽입
                }
            }
        }
        System.out.println();
    }
}

public class BfsExample {
    public static void main(String[] args) {
        Graph_BFS g = new Graph_BFS(6); // 0부터 5까지의 정점

        g.addEdge(0, 1);
        g.addEdge(0, 2);
        g.addEdge(1, 3);
        g.addEdge(1, 4);
        g.addEdge(2, 4);
        g.addEdge(3, 5);
        g.addEdge(4, 5);

        g.BFS(0); // 결과 예: 0 1 2 3 4 5
    }
}
```
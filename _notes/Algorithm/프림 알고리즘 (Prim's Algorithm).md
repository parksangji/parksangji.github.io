---
title: 프림 알고리즘 (Prim's Algorithm)
category: Algorithm
layout: note
---

주어진 연결된, 가중치가 있는 무방향 그래프(Connected, Weighted Undirected Graph)에서 다음 조건을 만족하는 부분 그래프(Subgraph)를 말한다. 
1. 신장 트리 (Spanning Tree): 그래프의 모든 정점(Vertex)을 포함하면서 사이클(Cycle)이 없는 트리 구조.
2. 최소 비용 (Minimum Cost): 신장 트리를 구성하는 간선(Edge)들의 가중치 합이 가능한 모든 신장 트리 중에서 가장 작은 트리.

즉, 그래프의 모든 정점을 최소한의 비용(간선 가중치 합)으로 연결하는 방법을 찾는 문제이다. 

프림 알고리즘(Prim`s Algirhtm)
프림 알고리즘은 최소 신장 트리를 찾는 탐욕적 알고리즘(Greedy Algorithm)이다. 임의의 정점에서 시작하여, 현재까지 만들어진 트리(MST 집합) 에 연결된 간선 중에서 가장 가중치가 작은 간선을 선택하여 트리를 점진적으로 확장해 나가는 방식이다. 

![[Pasted image 20250421150632.png]]

1. 초기화:
	- 임의의 정점을 시작 정점으로 선택하고, 이 정점만 포함하는 트리(MST 집합)을 만든다. 
	- 다른 모든 정점들에 대해, 시작 정점으로부터의 거리(간선 가중치)를 기록한다. 시작 정점과 직접 연결되지 않은 정점의 거리를 무한대(Infinity)로 설정한다. 
	- 우선순위 큐(Min-Heap)에 (거리, 정점) 쌍을 넣습니다. 시작 정점은 거리 0으로 넣고, 나머지는 계산된 거리(또는 무한대)로 넣는다. 
	- 각 정점이 MST에 포함되었는지 여부를 기록할 배열(또는 집합)을 준비한다. (초기에는 시작 정점만 포함).
2. 반복: 우선순위 큐가 비거나 모든 정점이 MST에 포함될 때까지 다음을 반복한다. 
	- 최소 가중치 간선 선택: 우선순위 큐에서 현재 MST 집합과 연결된 간선 중 가중치가 작은 정점(u)을 추출한다. (즉, 큐에서 거리가 가장 작은 정점을 꺼낸다.)
	- 방문(MST 포함) 확인: 만약 정점 u가 이미 MST 집합에 포함되어 있다면 건너뛴다. 
	- MST에 추가 : 정점 u를 MST집합에 추가한다. 
	- 인접 정점 거리 갱신: 새로 추가된 정점 u와 연결된 모든 인접 정점(v) 중에서 아직 MST 집합에 포함되지 않은 정점들에 대해 다음을 수행한다. 
		- 정점 u와 v를 연결하는 간선의 가중치 (weight(u,v)) 가 현재 알려진 v까지의 최소 연결 가중치보다 작다면, v의 최소 연결 가중치를 weight(u,v)로 갱신하고, 우선순위 큐에 갱신된 가중치(v)를 추가한다.
3. 종료: 모든 정점이 MST 집합에 포함되면 알고리즘이 종료된다. 선택괸 간선들이 최소 신장 트리를 구성한다. 

**시간 복잡도:**

- 우선순위 큐(힙)와 인접 리스트를 사용하는 경우: **O(E log V)** (V: 정점 수, E: 간선 수)
    - 큐에서 V번 노드를 추출(log V), 각 간선 E에 대해 큐 갱신(log V) 가능.
- 인접 행렬과 배열 스캔을 사용하는 경우: O(V^2)

```java
import java.util.*;

// 우선순위 큐에 저장될 노드 (정점 번호, 현재까지의 최소 연결 가중치)
class PrimNode implements Comparable<PrimNode> {
    int vertex;
    int weight;

    public PrimNode(int vertex, int weight) {
        this.vertex = vertex;
        this.weight = weight;
    }

    @Override
    public int compareTo(PrimNode other) {
        return Integer.compare(this.weight, other.weight);
    }
}

public class PrimAlgorithm {
    private List<List<PrimNode>> adj; // 인접 리스트 (목적지 정점, 가중치)
    private int V; // 정점의 개수

    public PrimAlgorithm(int v) {
        this.V = v;
        adj = new ArrayList<>();
        for (int i = 0; i < v; i++) {
            adj.add(new ArrayList<>());
        }
    }

    // 무방향 그래프 간선 추가
    public void addEdge(int u, int v, int weight) {
        adj.get(u).add(new PrimNode(v, weight));
        adj.get(v).add(new PrimNode(u, weight));
    }

    public void findMST(int startNode) {
        PriorityQueue<PrimNode> pq = new PriorityQueue<>();
        int[] key = new int[V]; // 각 정점과 현재 MST를 잇는 최소 간선 가중치
        int[] parent = new int[V]; // MST에서 각 정점의 부모
        boolean[] inMST = new boolean[V]; // 정점이 MST에 포함되었는지 여부

        // 초기화
        Arrays.fill(key, Integer.MAX_VALUE);
        Arrays.fill(parent, -1); // 부모 없음 표시

        // 시작 노드 설정
        key[startNode] = 0;
        pq.offer(new PrimNode(startNode, 0));

        int mstWeight = 0; // MST 전체 가중치 합
        List<String> mstEdges = new ArrayList<>(); // MST 간선 저장

        while (!pq.isEmpty()) {
            PrimNode node = pq.poll(); // 최소 가중치를 가진 정점 추출
            int u = node.vertex;

            // 이미 MST에 포함된 정점이면 건너<0x<1C><0x8A><0x8C>기
            if (inMST[u]) {
                continue;
            }

            // MST에 포함
            inMST[u] = true;
            mstWeight += node.weight; // 가중치 누적
            if (parent[u] != -1) { // 시작 노드가 아니면 간선 정보 추가
                mstEdges.add("(" + parent[u] + " - " + u + " : " + node.weight + ")");
            }


            // 인접 정점들의 key 값 갱신
            for (PrimNode neighbor : adj.get(u)) {
                int v = neighbor.vertex;
                int weight = neighbor.weight;

                // 아직 MST에 포함되지 않았고, 현재 간선이 더 짧으면 갱신
                if (!inMST[v] && weight < key[v]) {
                    key[v] = weight;
                    parent[v] = u; // 부모 설정
                    pq.offer(new PrimNode(v, key[v])); // 갱신된 정보 큐에 추가
                }
            }
        }

        System.out.println("Minimum Spanning Tree Weight: " + mstWeight);
        System.out.println("Edges in MST:");
        for(String edge : mstEdges) {
            System.out.println(edge);
        }
    }

    public static void main(String[] args) {
        int numNodes = 5;
        PrimAlgorithm pa = new PrimAlgorithm(numNodes);

        pa.addEdge(0, 1, 2);
        pa.addEdge(0, 3, 6);
        pa.addEdge(1, 2, 3);
        pa.addEdge(1, 3, 8);
        pa.addEdge(1, 4, 5);
        pa.addEdge(2, 4, 7);
        pa.addEdge(3, 4, 9);

        pa.findMST(0); // 0번 노드에서 시작
    }
}
```


**크루스칼 알고리즘과의 비교 (Briefly):**

- **크루스칼(Kruskal) 알고리즘:** 모든 간선을 가중치 순으로 정렬한 뒤, 사이클을 형성하지 않는 가장 작은 가중치의 간선부터 차례로 선택하여 MST를 만듭니다 (Union-Find 자료구조 사용).
- **선택 기준:** 프림은 **정점**을 기준으로 확장, 크루스칼은 **간선**을 기준으로 선택.
- **그래프 밀도:** 프림은 밀집 그래프(Dense Graph, E ≈ V^2)에서 상대적으로 유리할 수 있고, 크루스칼은 희소 그래프(Sparse Graph, E ≈ V)에서 유리할 수 있습니다.
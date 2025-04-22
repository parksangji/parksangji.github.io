
다익스트라 알고리즘은 하나의 시작 정점에서 그래프 내의 다른 모든 정점까지의 최단 경로를 찾는 알고리즘이다. 이 알고리즘은 음수 가중치를 가진 간선이 없는 그래프에서만 정확하게 동작한다. 

-----------

동작 방식
1. 초기화:
	1. 시작 정점에서 다른 모든 정점까지의 거리를 저장할 배열을 준비하고, 시작 정점의 거리는 0으로, 나머지는 모두 무한대로 초기화한다. 
	2. 방문한 정점을 기록할 집합(배열)을 준비한다. (초기화)
	3. 우선순위 큐를 사용하여 쌍을 관리한다. 시작 정점을 큐에 넣는다. 
2. 반복: 우선순위 큐가 빌 때까지 다음을 반복한다. 
	1. 우선순위 큐에서 현재까지 계산된 거리가 가장 짧은 정점을 꺼낸다. 
	2. 만약 현재 노드가 이미 방문한 정점이라면 건너뛴다. 
	3. 현재 노드를 방문했음을 표시한다. 
	4. 현재노드와 연결된 모든 인접 정점에 다음을 수행한다. 
		1. 시작 정점에서 현재 노드를 거쳐 이웃까지 가는 거리를 계산한다. 
		2. 계산된 거리가 현재까지 알려진 시작 정점에서 이웃까지의 최단 거리보다 짧다면, 거리 값을 새로운 계산된 거리로 갱신하고, 우선순위 큐를 추가한다. 
3. 종료: 우선순위 큐가 비면 알고리즘이 종료된다. 거리 배열에는 시장 정점에서 각 정점까지의 최단 거리가 저장된다. 

시간 복잡도:
- 우선순위 큐를 사용하는 경우: O(E log V) (V 정점 수, E 간선 수)
	- 모든 간선에 대해 한 번씩 우선수위 큐에 삽입/갱신 작업이 발생할 수 있다.
- 우선순위 큐를 사용하지 않고 매번 모든 정점을 스캔하여 최소 거리를 찾는 경우 O(v^2)

음수 가중치 간선: 그래프에 음수 가중치 간선이 포함되어 있으면 다익스트라 알고리즘은 최단 경로를 정확히 찾지 못할 수 있다. 

```java
import java.util.*;

class Node implements Comparable<Node> {
    int index;
    int distance;

    public Node(int index, int distance) {
        this.index = index;
        this.distance = distance;
    }

    // 거리가 짧은 것이 높은 우선순위를 갖도록 설정
    @Override
    public int compareTo(Node other) {
        return Integer.compare(this.distance, other.distance);
    }
}

public class DijkstraAlgorithm {
    private static final int INF = Integer.MAX_VALUE;
    private List<List<Node>> graph;
    private int[] dist;
    private int V; // 정점의 개수

    public DijkstraAlgorithm(int v) {
        this.V = v;
        graph = new ArrayList<>();
        for (int i = 0; i < v; i++) {
            graph.add(new ArrayList<>());
        }
        dist = new int[v];
    }

    public void addEdge(int start, int end, int weight) {
        // start에서 end로 가는 가중치 weight의 간선
        graph.get(start).add(new Node(end, weight));
        // 만약 무방향 그래프라면 아래 라인 추가
        // graph.get(end).add(new Node(start, weight));
    }

    public void dijkstra(int startNode) {
        Arrays.fill(dist, INF); // 거리 배열 무한대로 초기화
        dist[startNode] = 0;    // 시작 노드 거리는 0

        PriorityQueue<Node> pq = new PriorityQueue<>();
        pq.offer(new Node(startNode, 0)); // 우선순위 큐에 시작 노드 추가

        while (!pq.isEmpty()) {
            Node currentNode = pq.poll(); // 현재 가장 거리가 짧은 노드
            int currentIndex = currentNode.index;
            int currentDistance = currentNode.distance;

            // 현재 꺼낸 노드의 거리가 이미 알려진 최단 거리보다 길다면 무시
            if (currentDistance > dist[currentIndex]) {
                continue;
            }

            // 현재 노드와 연결된 인접 노드 확인
            for (Node neighbor : graph.get(currentIndex)) {
                int newDist = dist[currentIndex] + neighbor.distance;

                // 새로운 경로가 기존 경로보다 짧다면 갱신
                if (newDist < dist[neighbor.index]) {
                    dist[neighbor.index] = newDist;
                    pq.offer(new Node(neighbor.index, newDist)); // 갱신된 정보를 큐에 추가
                }
            }
        }
    }

    public void printDistances(int startNode) {
        System.out.println("Shortest distances from node " + startNode + ":");
        for (int i = 0; i < V; i++) {
            if (dist[i] == INF) {
                System.out.println("Node " + i + ": Infinity");
            } else {
                System.out.println("Node " + i + ": " + dist[i]);
            }
        }
    }

    public static void main(String[] args) {
        int numNodes = 6;
        DijkstraAlgorithm da = new DijkstraAlgorithm(numNodes);

        // 그래프 구성 (예시)
        da.addEdge(0, 1, 7);
        da.addEdge(0, 2, 9);
        da.addEdge(0, 5, 14);
        da.addEdge(1, 2, 10);
        da.addEdge(1, 3, 15);
        da.addEdge(2, 3, 11);
        da.addEdge(2, 5, 2);
        da.addEdge(3, 4, 6);
        da.addEdge(4, 5, 9);

        int startNode = 0;
        da.dijkstra(startNode);
        da.printDistances(startNode);
    }
}
```
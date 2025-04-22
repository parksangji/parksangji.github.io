---
title: "깊이 우선 탐색(Depth-First Search, DFS)"
category: "Algorithm" # 필요하다면
---


깊이 우선 탐색은 그래프 탐색의 한 방법으로, 시작 정점에서 출발하여 가능한 한 깊이 들어간 후, 더 이상 갈 곳이 없으면 마지막 갈림길로 돌아와서 다른 방향으로 탐색을 계속하는 방식이다. 즉 한 경로를 끝까지 탐색하고 나서야 다음 경로를 탐색한다. 

동작 방식:
1. 시작 정점 선택: 탐색을 시작할 정점을 선택한다. 
2. 정점 방문 및 표시: 현재 정점을 방문하고, 방문했음을 표시한다. 
3. 인접 정점 확인: 현재 정점과 연결된 인접 정점들을 확인한다.
4. 깊이 탐색: 방문하지 않은 인접 정점이 있다면, 그 중 하나를 선택하여 해당 정점으로 이동하고 2단계부터 다시 시작한다.(재귀 호출 또는 스택 사용)
5. 백트래킹 (Backtracking): 현재 정점에서 더 이상 방문할 인접 정점이 없다면, 이전 정점(탐색을 시작했던 정점)으로 돌아가서 다른 방문하지 않은 인접 정점을 찾는다. 
6. 종료: 시작 정점에서 더 이상 방문할 정점이 없을 때까지 이 과정을 반복한다. 

![[Pasted image 20250409165932.png]]

구현 방법:
	재귀 (Recursion): 함수의 호출 스택을 이용하여 자연스럽게 DFS를 구현
	스택 (Stack): 명시적인 스택 자료구조를 사용하여 방문할 정점을 관리한다. 

재귀
```java
void DFSRecursiveUtil(int v, boolean[] visited) { 
	visited[v] = true; // 현재 노드 방문 처리 
	System.out.print(v + " "); // 현재 노드와 연결된 모든 노드 방문 
	Iterator<Integer> i = adj[v].listIterator(); 
	while (i.hasNext()) { 
		int n = i.next(); 
		if (!visited[n]) { // 방문하지 않은 노드면 재귀 호출 
		DFSRecursiveUtil(n, visited); 
		} 
	} 
}
```

스택
```java
void DFSIterative(int startVertex) { 
	boolean[] visited = new boolean[V]; 
	Stack<Integer> stack = new Stack<>(); stack.push(startVertex); // 시작 노드를 스택에 넣음 
	System.out.print("DFS (Iterative) starting from vertex " + startVertex + ": "); 
	while (!stack.isEmpty()) { 
		int v = stack.pop(); // 스택에서 노드 하나를 꺼냄 
		if (!visited[v]) { 
			visited[v] = true; // 방문 처리 
			System.out.print(v + " "); 
			// 현재 노드의 인접 노드들을 스택에 넣음 (방문하지 않은 노드만) 
			// 스택은 LIFO 이므로, 낮은 번호부터 방문하려면 역순으로 넣거나, 꺼낸 후 방문 처리 
			Iterator<Integer> i = adj[v].descendingIterator(); // 역순으로 넣어야 낮은 번호부터 탐색 가능 
			while (i.hasNext()) { 
				int n = i.next(); 
				if (!visited[n]) { 
					stack.push(n); 
				} 
			} 
		} 
	} 
	System.out.println(); 
}
```

**시간 및 공간 복잡도:**
- **시간 복잡도: O(V + E)**
    - V: 정점의 수, E: 간선의 수
    - 모든 정점과 간선을 한 번씩 방문합니다.
- **공간 복잡도: O(V)**
    - 재귀 호출 스택 또는 명시적 스택의 최대 깊이가 V에 비례합니다. (방문 배열 포함)

장점: 
- 현재 경로상의 노드들만 기억하면 되므로 상대적으로 간단
- 경로를 찾는 문제에 유용하다.
- 사이클 감지, 연결 요소 찾기, 위상 정렬 등에 활용된다. 

단점:
- 최단 경로를 찾는 데는 적합하지 않다.
- 찾고자 하는 해가 깊은 곳에 있지 않고 시작점 근처에 있다면 비효율적이다.
- 재귀 호출이 깊어지면 스택 오버플로우가 발생한다. 

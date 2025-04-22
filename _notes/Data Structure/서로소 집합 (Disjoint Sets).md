---
title: 서로소 집합 (Disjoint Sets)
category: Data Structure
---
서로소 집합이란 공통 원소가 없는, 즉 서로 겹치지 않는 집합들을 말한다. 예를 들어, {1, 2}, {3, 4} , {5}는 세 개의 서로소 집합이다. 

Union-Find 자료구조
	Union-Find 자료구조는 이러한 서로소 집합들을 관리하고 다음 두 가지 주요 연산을 효율적으로 지원하는 자료구조이다. 
	1. find(element): 특정 원소가 어떤 집합에 속해 있는지 알아내는 연산이다. 보통 각 집합을 대표하는 고유한 대표 원소를 찾아 반환한다. 
	2. union(element1, element2): 두 원소가 속한 집합을 하나의 집합으로 합치는 연산이다. 

배열 사용:
	Union-Find는 주로 1차원 배열(ex: parent 배열)을 사용하여 구현한다. 
	- parent[i]: 원소 i의 부모 원소를 저장한다. 
	- 루트 노드: 집합의 대표 원소(루트)는 자기 자신을 부모로 가리킨다. (즉, parent[i] == i).

주요 연산 및 최적화:
1. find 연산:
	- 기본 방식: 원소 i에서 시작하여 parent[i]를 따라 계속 이동하면서 루트 노드를 찾는다. 
	- 경로 압축 최적화: 배열을 갱신한다. 이는 트리으 ㅣ높이를 효과적으로 낮추어 이후의 find 연산 속도를 크게 향상시킨다. 
2. union 연산:
	- 기본 방식: 합치려는 두 원소 a와 b에 대해 각각 find(a)와 find(b)를 호출하여 각 집합의 루트 노드 rootA와 rootB를 찾는다. 만약 rootA와 rootB가 다르면 (즉, 서로 다른 집합에 속해 있으면), 하나의 루트가 다른 루트를 가리키도록 parent 배열을 수정하여 두 집합을 합친다. (parent[rootA] = rootB)
	- Union by Rank / Union by Size 최적화 : 두 집합을 합칠 때, 무작위로 합치는 대신 특정 규칙을 따른다. 
		- union by rank: 트리의 높이를 기준으로, 높이가 낮은 트리를 높이가 높은 트리 밑에 붙인다. 
		- union by size: 집합으 ㅣ크기를 기준으로, 크기가 작은 집합을 크기가 큰 집합 밑에 붙인다. 
		- 이 최적화는 트리의 높이를 낮게 유지하여 find 연산의 효율을 높인다. 

![[Pasted image 20250422154903.png]]

시간 복잡도:
- **최적화 없을 시:** 최악의 경우 트리가 한쪽으로 길게 늘어져 `find`, `union` 모두 O(N)
- **경로 압축 또는 Union by Rank/Size 중 하나만 사용 시:** O(log N)
- 정확히는 O(α(N))인데, 여기서 α(N)은 아커만 함수의 역함수(Inverse Ackermann function)로, 모든 현실적인 N 값에 대해 5 미만의 매우 작은 값을 가진다.

```java
import java.util.Arrays;

public class UnionFind {
    private int[] parent; // 각 원소의 부모 저장
    private int[] rank;   // 각 루트 노드를 기준으로 한 트리의 랭크(높이 추정치)

    // 생성자: 초기에는 각 원소가 자기 자신만을 포함하는 집합
    public UnionFind(int size) {
        parent = new int[size];
        rank = new int[size];
        for (int i = 0; i < size; i++) {
            parent[i] = i; // 자기 자신을 부모로 초기화
            rank[i] = 0;   // 초기 랭크는 0
        }
    }

    // find 연산 (경로 압축 적용)
    public int find(int i) {
        // 루트 노드가 아니면, 재귀적으로 루트를 찾고 경로상의 노드들의 부모를 루트로 갱신
        if (parent[i] != i) {
            parent[i] = find(parent[i]); // 경로 압축
        }
        return parent[i]; // 루트 노드 반환
    }

    // union 연산 (Union by Rank 적용)
    public boolean union(int i, int j) {
        int rootI = find(i); // i의 루트 찾기
        int rootJ = find(j); // j의 루트 찾기

        if (rootI != rootJ) { // 두 원소가 다른 집합에 속해 있다면
            // 랭크를 기준으로 합치기
            if (rank[rootI] < rank[rootJ]) {
                parent[rootI] = rootJ; // 랭크가 낮은 트리를 높은 트리에 붙임
            } else if (rank[rootI] > rank[rootJ]) {
                parent[rootJ] = rootI;
            } else {
                // 랭크가 같으면 한쪽을 붙이고, 붙여진 쪽의 랭크 증가
                parent[rootJ] = rootI;
                rank[rootI]++;
            }
            return true; // 합치기 성공
        }
        return false; // 이미 같은 집합
    }

    public static void main(String[] args) {
        int n = 7; // 원소 개수 (0부터 6까지)
        UnionFind uf = new UnionFind(n);

        System.out.println("Initial parents: " + Arrays.toString(uf.parent));

        uf.union(0, 1);
        uf.union(1, 2);
        uf.union(3, 4);
        uf.union(5, 6);
        uf.union(4, 5);

        System.out.println("Parents after unions: " + Arrays.toString(uf.parent));

        System.out.println("Are 0 and 2 connected? " + (uf.find(0) == uf.find(2))); // true
        System.out.println("Are 0 and 4 connected? " + (uf.find(0) == uf.find(4))); // false
        System.out.println("Are 3 and 6 connected? " + (uf.find(3) == uf.find(6))); // true

        // 경로 압축 확인 예시
        System.out.println("Find(6): " + uf.find(6));
        System.out.println("Find(5): " + uf.find(5));
        System.out.println("Find(4): " + uf.find(4));
        System.out.println("Parents after find operations: " + Arrays.toString(uf.parent));
    }
}
```
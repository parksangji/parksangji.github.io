---
title: 이진 탐색 트리 (Binary Search Tree, BST)
category: Algorithm
layout: note
---
이진 탐색 트리는 이진 트리의 일종으로, 특정 규치에 따라 노드들이 정렬되어 있어 효율적인 탐색이 가능하도록 만든 자료구조이다. 

BST 속성 (BST Property):
- 각 노드의 왼쪽 서브트리에 있는 모든 노드의 키는 해당 노드의 키보다 작다.
- 각 노드의 오른쪽 서브트리에 있는 모든 노드의 키는 해당 노드의 키보다 크다. 
- 왼쪽 서브트리와 오른쪽 서브트리 역시 각각 이진 탐색트리이다. 
- 중복된 키는 허용하지 않는 것이 일반적이다. 

주요연산
1. 탐색
	- 루트 노드에서 시작
	- 찾고자 하는 값과 현재 노드의 값을 비교
	- 찾고자 하는 값이 현재 노드 값보다 작으면 왼쪽 자식으로 이동
	- 찾고자 하는 값이 현재 노드 값보다 크면 오른쪽 자식으로 이동
	- 찾고자 하는 값을 찾거나, 더 이상 이동할 노드가 없을 때까지 반복
	- 시간복잡도: 평균 O(log N), 최악 O(n) - 트리가 한쪽으로 치우친 경우 
2. 삽입
	- 탐색 연산과 유사하게 삽입할 위치를 찾는다. (탐색에 실패하여 null 링크에 도달한 위치)
	- 새로운 값을 가진 노드를 해당 위치에 삽입한다. 
	- 시간 복잡도: 평균 O(log N), 최악 O(n)
3. 삭제: 
	- case1: 삭제할 노드가 리프 노드인 경우: 해당 노드를 단순히 삭제한다.
	- case2: 삭제할 노드가 하나의 자식만 가지는 경우: 해당 노드를 삭제하고, 그 자리에 자식 노드를 위치 시킨다. 
	- case3: 삭제할 노드가 두 개의 자식을 모두 가지는 경우:
		- 방법 1: 삭제할 노드의 오른쪽 서브트리에서 가장 작은 값(Successor)을 찾아서 삭제할 노드의 위치로 가져온다.
		- 방법 2: 삭제할 노드의 왼쪽 서브트리에서 가장 큰 값(Predecessor)을 찾아서 삭제할 노드의 위치로 가져온다.
		- 원래 Successor 또는 Predecessor가 있던 자리에서 해당 노드를 삭제한다. 
	- 시간 복잡도: 평균 O(log N), 최악 O(n)

```java
class Node {
    int key;
    Node left, right;

    public Node(int item) {
        key = item;
        left = right = null;
    }
}

public class BinarySearchTree {
    Node root; // BST의 루트 노드

    BinarySearchTree() {
        root = null;
    }

    // 삽입 (재귀 방식)
    Node insertRec(Node root, int key) {
        // 트리가 비어있으면 새로운 노드 반환
        if (root == null) {
            root = new Node(key);
            return root;
        }

        // 키 비교 후 재귀 호출
        if (key < root.key) {
            root.left = insertRec(root.left, key);
        } else if (key > root.key) {
            root.right = insertRec(root.right, key);
        }
        // (key == root.key 인 경우, 중복 허용 안 하면 아무것도 안 함)

        return root;
    }

    void insert(int key) {
        root = insertRec(root, key);
    }

    // 탐색 (재귀 방식)
    Node searchRec(Node root, int key) {
        // 루트가 null이거나 키를 찾으면 루트 반환
        if (root == null || root.key == key) {
            return root;
        }

        // 키가 루트보다 작으면 왼쪽 서브트리 탐색
        if (key < root.key) {
            return searchRec(root.left, key);
        }

        // 키가 루트보다 크면 오른쪽 서브트리 탐색
        return searchRec(root.right, key);
    }

     boolean search(int key) {
        return searchRec(root, key) != null;
    }

    // 중위 순회 (Inorder Traversal - 정렬된 순서로 출력)
    void inorderRec(Node root) {
        if (root != null) {
            inorderRec(root.left);
            System.out.print(root.key + " ");
            inorderRec(root.right);
        }
    }

    void inorder() {
        System.out.print("Inorder traversal: ");
        inorderRec(root);
        System.out.println();
    }

    // (삭제 연산은 더 복잡하여 생략)

    public static void main(String[] args) {
        BinarySearchTree bst = new BinarySearchTree();

        bst.insert(50);
        bst.insert(30);
        bst.insert(20);
        bst.insert(40);
        bst.insert(70);
        bst.insert(60);
        bst.insert(80);

        bst.inorder(); // 결과: 20 30 40 50 60 70 80

        System.out.println("Search 40: " + bst.search(40)); // true
        System.out.println("Search 90: " + bst.search(90)); // false
    }
}
```
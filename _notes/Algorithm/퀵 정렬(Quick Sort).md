---
title: 퀵 정렬(Quick Sort)
category: Algorithm
layout: note
---
퀵 정렬은 분할 정복(Divide And Conquer) 알고리즘의 일종으로, 평균적으로 매우 빠른 정렬 속도를 가지는 알고리즘이다. 다음 단계를 통해 정렬을 수행한다.

1. 피벗(Pivot) 선택: 배열에서 하나의 원소를 선택하여 피벗으로 지정한다.(일반적으로 배열의 첫 번째 원소, 마지막 원소, 또는 중간 원소를 사용하거나, 랜덤하게 선택하기도 한다.)
2. 분할(Partition): 피벗을 기준으로 배열을 두 부분으로 나눈다. 피벗보다 작은 원소들은 피벗의 왼쪽으로 피벗보다 큰 원소들은 피벗의 오른쪽으로 이동 시킨다. 
3. 재귀(Recursion): 피벗을 제외한 왼쪽 부분 배열과 오른쪽 부분 배열에 대한 퀵 정렬을 재귀적으로 수행한다. 
4. 결합(Combine): 분할된 부분 배열들이 모두 정렬되면, 전체 배열이 정렬된다.

평균 시간 복잡도: O(n log n)
최악 시간 복잡도: O(n ^ 2) (이미 정렬된 배열이나 거의 정렬된 배열에서 피벗이 항상 최솟 값 또는 최댓 값으로 선택되는 경우 )
불안정 정렬(Unstable Sort): 동일한 값을 가진 원소들의 상대적인 순서가 정렬 후에도 유지되지 않을 수 있다. 
제자리 정렬(In-place Sort): 추가적인 메모리 공간을 거의 사용하지 않고 배열 내에서 정렬을 수행한다. 

```java
public class QuickSort {

    public static void quickSort(int[] arr, int low, int high) {
        if (low < high) {
            int pivotIndex = partition(arr, low, high); // 피벗을 기준으로 분할

            quickSort(arr, low, pivotIndex - 1); // 피벗 왼쪽 부분 배열 정렬
            quickSort(arr, pivotIndex + 1, high); // 피벗 오른쪽 부분 배열 정렬
        }
    }

    private static int partition(int[] arr, int low, int high) {
        int pivot = arr[high]; // 피벗을 배열의 마지막 원소로 선택
        int i = (low - 1); // 피벗보다 작은 원소들의 마지막 인덱스

        for (int j = low; j < high; j++) {
            if (arr[j] <= pivot) {
                i++;

                // arr[i]와 arr[j] 교환
                int temp = arr[i];
                arr[i] = arr[j];
                arr[j] = temp;
            }
        }

        // 피벗과 arr[i + 1] 교환
        int temp = arr[i + 1];
        arr[i + 1] = arr[high];
        arr[high] = temp;

        return i + 1; // 피벗의 인덱스 반환
    }

    public static void main(String[] args) {
        int[] arr = {5, 3, 8, 9, 2, 4, 7};
        int n = arr.length;

        quickSort(arr, 0, n - 1);

        System.out.println("Sorted array:");
        for (int num : arr) {
            System.out.print(num + " ");
        }
    }
}
```


![[Pasted image 20250324165047.png]]

![[Pasted image 20250324165134.png]]

![[Pasted image 20250324165153.png]]
---
title: 동적계획법 (Dynamic Programming, DP)
category: Algorithm
layout: note
---
동적 계획법은 복잡한 문제를 작은 하위 문제로 나누어 해결하는 알고리즘 설계 기법이다. 
각 하위 문제의 해결책을 저장해 두었다가, 동일한 하위 문제가 다시 발생하면 저장된 해결책을 재사용하여 중복 계산을 피하는 방식으로 효율성을 높인다. 

1. 메모이제이션(Memoization - Top - down):
	- 재귀 호출을 사용하여 문제를 해결하되, 하위 문제의 결과를 배열이나 해시 테이블 등에 저장한다.
	- 다음에 동일한 하위 문제를 만나면 저장된 결과를 즉시 반환하여 계산 시간을 줄인다. 
	- 위에서부터 아래로 문제를 분해하며 해결한다. 

2. 타뷸레이션 (Tabulation - Bottom - up):
	- 가장 작은 하위 문제부터 시작하여 점진적으로 해결책을 구축해 나간다.
	- 반복문을 사용하여 하위 문제의 결과를 테이블(배열)에 순차적으로 저장한다.
	- 아래에서부터 위로 문제를 해결하며 최종 결과를 도출한다. 

메모제이션 방식: 
```java
import java.util.HashMap;
import java.util.Map;

public class FibonacciMemoization {

    private Map<Integer, Long> memo = new HashMap<>(); // 계산 결과를 저장할 맵

    public long fibonacci(int n) {
        if (n <= 1) {
            return n;
        }
        // 이미 계산된 값이면 메모에서 가져옴
        if (memo.containsKey(n)) {
            return memo.get(n);
        }

        // 계산되지 않았으면 재귀 호출로 계산하고 결과를 메모에 저장
        long result = fibonacci(n - 1) + fibonacci(n - 2);
        memo.put(n, result);
        return result;
    }

    public static void main(String[] args) {
        FibonacciMemoization fm = new FibonacciMemoization();
        int n = 40; // 큰 값으로 테스트 가능
        System.out.println("Fibonacci(" + n + ") = " + fm.fibonacci(n));
    }
}
```


타뷸레이션 방식:
```java
public class FibonacciTabulation {

    public long fibonacci(int n) {
        if (n <= 1) {
            return n;
        }

        long[] dp = new long[n + 1]; // 결과를 저장할 배열 (테이블)
        dp[0] = 0;
        dp[1] = 1;

        // 가장 작은 문제부터 순차적으로 계산하여 테이블 채우기
        for (int i = 2; i <= n; i++) {
            dp[i] = dp[i - 1] + dp[i - 2];
        }

        return dp[n]; // 최종 결과 반환
    }
     // 공간 최적화 버전 (배열 대신 변수 사용)
    public long fibonacciOptimized(int n) {
        if (n <= 1) {
            return n;
        }
        long prev1 = 1; // F(n-1) 역할
        long prev2 = 0; // F(n-2) 역할
        long current = 0;

        for (int i = 2; i <= n; i++) {
            current = prev1 + prev2;
            prev2 = prev1;
            prev1 = current;
        }
        return current;
    }


    public static void main(String[] args) {
        FibonacciTabulation ft = new FibonacciTabulation();
        int n = 40;
        System.out.println("Fibonacci(" + n + ") = " + ft.fibonacci(n));
        System.out.println("Fibonacci Optimized(" + n + ") = " + ft.fibonacciOptimized(n));

    }
}
```

- 동적 계획법은 피보나치 수열 외에도 최적화 문제(Optimal Substructure)와 중복 하위 문제(Overlapping Subproblems) 특성을 가지는 다양한 문제에 적용될 수 있습니다.
- **최장 공통 부분 수열 (LCS):** 두 문자열에서 공통으로 나타나는 가장 긴 부분 수열을 찾는 문제 (예: Git의 diff 기능).
- **배낭 문제 (Knapsack Problem):** 제한된 용량의 배낭에 가치가 최대가 되도록 물건을 담는 문제 (자원 할당, 예산 분배 등).
- **최단 경로 문제:** 그래프에서 두 노드 간의 최단 경로를 찾는 문제 (예: 네비게이션).
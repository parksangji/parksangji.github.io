---
title: "KMP 알고리즘 (Knuth-Morris-Pratt Algorithm)"
category: "Algorithm"
description: "텍스트 내에서 특정 패턴 문자열을 효율적으로 검색하는 문자열 매칭 알고리즘"
image: "/assets/images/example.png" # 이미지 경로
---

# KMP 알고리즘 (Knuth-Morris-Pratt Algorithm)

## 문자열 검색이란?

문자열 검색(String Searching) 또는 문자열 매칭(String Matching)은 하나의 긴 텍스트 문자열(Text) 내에서 특정 패턴 문자열(Pattern)이 나타나는 모든 위치를 찾는 문제입니다. 예를 들어, "This is a simple example."라는 텍스트에서 "simple"이라는 패턴을 찾는 것입니다.

## 단순(Naive) 문자열 검색 방식의 한계

가장 간단한 방법은 텍스트의 각 위치에서부터 패턴과 일치하는지 문자 하나하나 비교하는 것입니다.

* 텍스트: `A B A B C A B A B D`
* 패턴: `A B A B D`

1.  텍스트의 0번째부터 패턴 비교: `A B A B C` vs `A B A B D` -> 불일치 (C vs D)
2.  텍스트의 1번째부터 패턴 비교: `B A B C A` vs `A B A B D` -> 불일치 (B vs A)
    ...

이 방식은 최악의 경우 텍스트 길이(N)와 패턴 길이(M)의 곱에 비례하는 시간 복잡도 (O(N*M))를 가질 수 있어 비효율적입니다. 특히 불일치가 발생했을 때, 패턴을 한 칸만 이동하고 이전에 비교했던 부분까지 다시 비교하는 중복이 발생합니다.

## KMP 알고리즘 소개

KMP 알고리즘(Knuth, Morris, Pratt가 고안)은 문자열 검색 시 발생하는 **불필요한 비교를 건너뛰도록** 설계되어 매우 효율적인 성능을 내는 알고리즘입니다. 핵심 아이디어는 불일치가 발생했을 때, 이미 일치했던 부분 문자열의 정보를 활용하여 패턴을 얼마나 건너뛸지(shift) 결정하는 것입니다.

KMP 알고리즘은 **LPS(Longest Proper Prefix which is also Suffix) 배열** (또는 실패 함수, `pi` 배열이라고도 함)이라는 전처리 단계를 통해 이 정보를 미리 계산합니다.

* **시간 복잡도:** O(N + M) (텍스트 길이 N, 패턴 길이 M) - 선형 시간

## LPS 배열 (Longest Proper Prefix which is also Suffix)

LPS 배열 `lps[i]`는 패턴의 `0`번 인덱스부터 `i`번 인덱스까지의 부분 문자열(`pattern[0...i]`)에서, **자기 자신을 제외한 접두사(proper prefix)이면서 동시에 접미사(suffix)가 되는 가장 긴 문자열의 길이**를 저장합니다.

* **Proper Prefix:** 문자열의 처음부터 시작하되, 문자열 전체는 아닌 부분 문자열. (예: "ABC"의 proper prefix는 "A", "AB")
* **Suffix:** 문자열의 끝에서 끝나는 부분 문자열. (예: "ABC"의 suffix는 "C", "BC", "ABC")

**예시:** 패턴 "ABABCABAB"

| 인덱스(i) | 부분 문자열 (`pattern[0...i]`) | 가장 긴 일치하는 접두사/접미사 | LPS 값 (`lps[i]`) |
| :-------- | :-------------------------- | :-------------------------- | :--------------- |
| 0         | A                           | (없음)                      | 0                |
| 1         | AB                          | (없음)                      | 0                |
| 2         | ABA                         | A                           | 1                |
| 3         | ABAB                        | AB                          | 2                |
| 4         | ABABC                       | (없음)                      | 0                |
| 5         | ABABCAB                     | AB                          | 2                |
| 6         | ABABCABA                    | ABA                         | 3                |
| 7         | ABABCABAB                   | ABAB                        | 4                |
*(이 표에서 '가장 긴 일치하는 접두사/접미사'는 예시이며 실제 배열엔 길이만 저장됩니다. 또한, 일부 구현에서는 `lps[0]`는 항상 0으로 두거나 -1로 두기도 하며, `lps[j-1]`을 다음 비교 시작 위치로 활용하기도 합니다. 여기서는 일반적인 '길이' 개념으로 설명합니다.)*

**LPS 배열의 역할:**
텍스트와 패턴을 비교하다가 `텍스트[i]`와 `패턴[j]`에서 불일치가 발생했다고 가정합시다. 이는 `패턴[0...j-1]` 부분은 `텍스트[i-j...i-1]` 부분과 일치했다는 의미입니다. 이때 `lps[j-1]` 값은 `패턴[0...j-1]`의 접두사이면서 동시에 접미사인 가장 긴 부분의 길이입니다. 이 길이를 `k = lps[j-1]`라고 하면, `패턴[0...k-1]`은 `텍스트[i-k...i-1]`과 여전히 일치함을 보장합니다. 따라서 패턴을 이동시킬 때, `패턴[0...k-1]` 부분이 텍스트의 해당 부분과 겹치도록 이동시키고, 다음 비교는 `패턴[k]`와 `텍스트[i]`부터 시작하면 됩니다. 즉, 패턴 포인터 `j`를 `k` (즉, `lps[j-1]`)로 옮깁니다.

## KMP 알고리즘 동작 단계

1.  **LPS 배열 계산:** 주어진 패턴 문자열에 대해 LPS 배열을 미리 계산합니다. (시간 복잡도: O(M))
2.  **문자열 매칭:**
    * 텍스트 인덱스 `i`와 패턴 인덱스 `j`를 0으로 초기화합니다.
    * `i`가 텍스트 길이보다 작을 동안 반복:
        * 만약 `텍스트[i]`와 `패턴[j]`가 일치하면:
            * `i`와 `j`를 1씩 증가시킵니다.
            * 만약 `j`가 패턴 길이와 같아지면 (패턴 전체 일치):
                * 패턴을 찾았으므로, 해당 시작 위치(`i-j`)를 기록합니다.
                * 다음 발생을 찾기 위해 `j`를 `lps[j-1]`로 업데이트합니다. (부분 일치 정보를 활용하여 다음 검색 위치로 이동)
        * 만약 `텍스트[i]`와 `패턴[j]`가 불일치하면:
            * 만약 `j`가 0이 아니면 (즉, 이전에 일치했던 부분이 있다면):
                * `j`를 `lps[j-1]`로 업데이트합니다. (패턴을 건너뛰어 이전 부분 일치 지점에서 다시 시작. `i`는 변경하지 않음)
            * 만약 `j`가 0이면 (패턴의 첫 글자부터 불일치):
                * `i`를 1 증가시킵니다. (텍스트의 다음 글자부터 다시 비교 시작)

## Java 코드 예제

```java
import java.util.ArrayList;
import java.util.List;

public class KMPAlgorithm {

    // LPS 배열 계산 함수
    // pattern: 패턴 문자열
    // lps: 계산된 LPS 값을 저장할 배열
    private static void computeLPSArray(String pattern, int[] lps) {
        int m = pattern.length();
        int length = 0; // 이전 LPS 값 (일치하는 접두사-접미사의 길이)
        int i = 1;
        lps[0] = 0; // lps[0]은 항상 0

        // i는 1부터 m-1까지 순회
        while (i < m) {
            if (pattern.charAt(i) == pattern.charAt(length)) {
                length++;
                lps[i] = length;
                i++;
            } else { // 불일치 발생
                if (length != 0) {
                    // 이전의 lps 값을 참조하여 length를 줄임
                    length = lps[length - 1];
                    // i는 그대로 두고 다시 비교
                } else {
                    lps[i] = 0; // 일치하는 접두사-접미사 없음
                    i++;
                }
            }
        }
    }

    // KMP 문자열 검색 함수
    // text: 전체 텍스트 문자열
    // pattern: 찾을 패턴 문자열
    // 반환: 패턴이 발견된 모든 시작 인덱스 리스트
    public static List<Integer> KMPSearch(String text, String pattern) {
        List<Integer> foundIndexes = new ArrayList<>();
        int n = text.length();
        int m = pattern.length();

        if (m == 0) return foundIndexes; // 빈 패턴
        if (m > n) return foundIndexes; // 패턴이 텍스트보다 김

        int[] lps = new int[m];
        computeLPSArray(pattern, lps); // LPS 배열 계산

        int i = 0; // text 인덱스
        int j = 0; // pattern 인덱스

        while (i < n) {
            if (pattern.charAt(j) == text.charAt(i)) {
                i++;
                j++;
            }

            if (j == m) { // 패턴 전체 일치
                foundIndexes.add(i - j); // 시작 인덱스 추가
                j = lps[j - 1]; // 다음 발생을 찾기 위해 j를 업데이트
            } else if (i < n && pattern.charAt(j) != text.charAt(i)) { // 불일치
                if (j != 0) {
                    j = lps[j - 1]; // lps 값을 이용해 j를 건너<0x<1C><0x8A><0x8C>기 (i는 그대로)
                } else {
                    i++; // 패턴의 첫 글자부터 불일치, text의 다음 글자로 이동
                }
            }
        }
        return foundIndexes;
    }

    public static void main(String[] args) {
        String text = "ABABDABACDABABCABAB";
        String pattern = "ABABCABAB";
        List<Integer> result = KMPSearch(text, pattern);

        if (result.isEmpty()) {
            System.out.println("Pattern not found in the text.");
        } else {
            System.out.println("Pattern found at indexes: " + result); // 예: [10]
        }

        String text2 = "AAAAABAAABA";
        String pattern2 = "AAAA";
        List<Integer> result2 = KMPSearch(text2, pattern2);
        System.out.println("Pattern found at indexes: " + result2); // 예: [0, 1]

        String text3 = "THIS IS A TEST TEXT";
        String pattern3 = "TEST";
        List<Integer> result3 = KMPSearch(text3, pattern3);
        System.out.println("Pattern found at indexes: " + result3); // 예: [10]
    }
}
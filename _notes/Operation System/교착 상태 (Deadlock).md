---
title: 교착 상태 (Deadlock)
category: Operation System
---
교착 상태란 두 개 이상의 프로세스(또는 스레드)가 서로 상대방이 가진 자원을 기다리며 무한정 대기하는 상태를 말한다. 이 상태에 빠진 프로세스들은 외부의 개입 없이는 스스로 빠져나올 수 없어 시스템 전체의 성능 저하나 멈춤을 유발할 수 있다. 

-------------------------------

교착 상태 발생의 4가지 필요 조건

교착 상태가 발생하기 위해서는 다음 네 가지 조건이 모두 충족되어야 한다.
1. 상호 배제(Mutual Exclusion): 한번에 하나의 프로세스만 자원을 사용할 수 있어야한다. 즉 자원이 공유 불가능해야한다.
2. 점유 및 대기 (Hold and Wait): 최소한 하나의 자원을 점유하고 있으면서, 다른 프로세스에 할당된 자원을 추가로 요청하며 대기하는 프로세스가 존재해야한다. 
3. 비선점(No Preemption): 다른 프로세스에 할당된 자원을 강제로 빼앗을 수 없어야 한다. 자원은 점유하고 있는 프로세스에 의해 자발적으로 반납되어야 한다. 
4. 순환 대기(Circular Wait): 대기하고 있는 프로세스들이 원형을 이루며 자원을 기다려야 한다. 

![[Pasted image 20250415090542.png]]

------------------------------

교착 상태 처리 방법
1. 교착 상태 예방 (Deadlock Prevention): 교착 상태 발생의 4가지 필요 조건 중 하나 이상을 제거하여 교착상태가 아예 발생하지 않도록 하는 방법이다. 
	- 자원을 공유 가능하게 만든다.
	- 프로세스가 실행 전에 필요한 모든 자원을 하꺼번에 요청하고 할당받거나, 자원을 전혀 가지지 않을 때마 요청한다. 
	- 다른 프로세스가 요청하는 자원을 가진 프로세스부터 해당 자원을 강제로 빼앗을 수 있게 한다. 
	- 모든 자원 유형에 고유한 번호를 부여하고, 각 프로세스는 번호 순서대로만 자원을 요청하도록 강제한다. 
2. 교착 상태 회피 (Deadlock Avoidance): 프로세스가 자원을 요청할 때, 해당 요청을 승인하면 미래에 교착 상태가 발생할 가능성이 있는지 동적으로 검사하여 안전한 상태를 유지하는 방법.
	- 안전 상태: 시스템이 교착 상태를 일으키지 않고 프로세스가 요구하는 최대 자원까지 할당해 줄 수 있는 순서가 존재하는 상태
	- 은행원 알고리즘: 프로세스가 시작 시 필요한 자원의 최대량을 미리 선언
		- 미리 최대 자원 요구량을 알아야하고, 계산 오버헤드가 크며, 프로세스 수가 변동적이면 적용하기 어렵다. 
3. 교착 상태 탐지 및 회복 (Deadlock Detection and Recovery): 교착 상태 발생을 허용하되, 주기적으로 시스템을 검사하여 교착 상태가 발생했는지 탐지하고, 발생했다면 회복시키는 방법. 
	- 탐지: 그래프나 대기 그래프를 사용하여 사이클 존재 여부를 확인한다. 
	- 회복:
		- 프로세스 종료: 교착 상태에 빠진 모든 프로세스를 종료하거나, 하나씩 종료해보며 교착 상태를 해결한다. 
		- 자원 선점: 교착 상태 프로세스로부터 자원을 강제로 빼앗아 다른 프로세스에 할당한다. 어떤 프로세스와 자원을 선택할지, 희생된 프로세스를 어떻게 복구할지가 문제이다. 
	- 데이터베이스 시스템 등에서 자주 사용됌. 
4. 교착 상태 무시 (Deadlock Ignorance):  교착 상태는 매우 드물게 발생한다고 가정하고, 이를 처리하는 비용이 더 크다고 판단하여 별다른 조치를 취하지 않는 방법 .

----------------------------------------

```java
public class DeadlockExample {

    private static final Object lock1 = new Object();
    private static final Object lock2 = new Object();

    public static void main(String[] args) {

        // Thread 1: lock1 -> lock2 순서로 획득 시도
        Thread thread1 = new Thread(() -> {
            synchronized (lock1) {
                System.out.println("Thread 1: Acquired lock1");
                try { Thread.sleep(100); } catch (InterruptedException e) {} // 다른 스레드가 lock2를 잡도록 유도

                System.out.println("Thread 1: Waiting for lock2...");
                synchronized (lock2) {
                    System.out.println("Thread 1: Acquired lock2");
                    // 작업 수행
                }
            }
        }, "Thread-1");

        // Thread 2: lock2 -> lock1 순서로 획득 시도
        Thread thread2 = new Thread(() -> {
            synchronized (lock2) {
                System.out.println("Thread 2: Acquired lock2");
                try { Thread.sleep(100); } catch (InterruptedException e) {} // 다른 스레드가 lock1을 잡도록 유도

                System.out.println("Thread 2: Waiting for lock1...");
                synchronized (lock1) {
                    System.out.println("Thread 2: Acquired lock1");
                    // 작업 수행
                }
            }
        }, "Thread-2");

        thread1.start();
        thread2.start();

        // 교착 상태가 발생하면 두 스레드 모두 여기서 더 이상 진행하지 못함
    }
}
```
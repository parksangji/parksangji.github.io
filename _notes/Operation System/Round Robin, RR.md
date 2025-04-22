
라운드 로빈 스케줄링은 시분할 시스템(Time-Sharing System)을 위해 설계된 대표적인 선점형(Preemptive) 스케줄링 알고리즘이다. 각 프로세스는 타임 퀀텀(Time Quantum) 또는 `타임 슬라이스(Time Slice)`라고 불리는 고정된 시간 동안만 CPU를 사용할 수 있다. 

- 동작 방식: 
	1. 준비 큐 (Ready Queeu): 실행 준비가 된 프로세스들은 준비 큐에 도착한 순서대로 들어간다.
	2. CPU 할당: 스케줄러는 준비 큐의 맨 앞에 있는 프로세스에게 CPU를 할당한다.
	3. 타임 퀀텀 실행: 프로세스는 할당된 타임 퀀텀 동안 CPU를 사용한다. 
	4. 실행 완료 또는 타임아웃:
		- 실행 완료: 만약 프로세스가 타임 퀀텀 내에 실행을 완료하면, 해당 프로세스는 CPU를 자발적으로 반납하고 종료된다. 스케줄러는 다음 프로세스(준비 큐의 맨 앞)에게 CPU를 할당한다. 
		-  타임아웃: 만약 프로세스가 타임 퀀텀을 모두 사용했지만 아직 실행이 끝나지 않았다면, 운영체제는 해당 프로세스를 중단시키고(선점), 준비 큐의 맨 뒤로 보낸다. 그리고 스케줄러는 다음 프로세스에게 CPU를 할당한다. 
	5. 문맥 교환 (Context Switching): CPU를 할당받는 프로세스가 변경될 때마다, 현재 실행 중이던 프로세스의 상태(레지스터 값, 프로그램 카운터 등)를 저장하고, 새로 실행될 프로세스의 상태를 로드하는 문맥 교환 작업이 발생한다. 

- 장점:
	- 공정성: 모든 프로세스가 적어도 (프로세스 수 * 타임 퀀텀) 시간 내에는 한 번씩 CPU를 할당받을 기회를 얻으므로 공평하다.
	- 응답 시간: 대화형 작업이나 짧은 작업에 대해 비교적 빠른 응답 시간을 제공한다. (오래 기다리지 않고 CPU를 조금씩 사용할 수 있음)
- 단점:
	- 문맥 교환 오버헤드: 타임 퀀텀이 너무 작으면 문맥 교환이 너무 자주 발생하여 실제 작업 시간보다 오버헤드가 커질 수 있음.
	- 타임 퀀텀 크기 의존성
		- 타임 퀀텀이 너무 크면 FCFS 스케줄링과 비슷하게 동작하여 긴 작업이 짧은 작업의 응답 시간을 늦출 수 있음.
		- 타임 퀀텀이 너무 작으면 문맥 교환 오버헤드가 증가한다. 적절한 타임 퀀텀 크기를 설정하는 것이 중요.


```java
import java.util.LinkedList;
import java.util.Queue;

class Process {
    String id;
    int burstTime; // 필요한 총 CPU 시간

    public Process(String id, int burstTime) {
        this.id = id;
        this.burstTime = burstTime;
    }
}

public class RoundRobinSimulation {

    public static void simulate(Queue<Process> readyQueue, int timeQuantum) {
        int currentTime = 0;

        System.out.println("Starting Round Robin Simulation (Time Quantum: " + timeQuantum + ")");

        while (!readyQueue.isEmpty()) {
            Process currentProcess = readyQueue.poll(); // 큐에서 프로세스 가져오기

            System.out.println("\nTime " + currentTime + ": Running Process " + currentProcess.id +
                               " (Remaining Burst: " + currentProcess.burstTime + ")");

            int executionTime = Math.min(currentProcess.burstTime, timeQuantum);
            currentProcess.burstTime -= executionTime;
            currentTime += executionTime;

            System.out.println("  - Executed for " + executionTime + " units.");

            if (currentProcess.burstTime > 0) {
                // 아직 실행이 남았으면 큐의 뒤로 보냄
                readyQueue.offer(currentProcess);
                System.out.println("  - Process " + currentProcess.id + " not finished. Remaining: " +
                                   currentProcess.burstTime + ". Added back to queue.");
            } else {
                // 실행 완료
                System.out.println("  - Process " + currentProcess.id + " finished at time " + currentTime);
            }

             // 간단한 문맥 교환 시간 표현 (실제 오버헤드는 아님)
             if (!readyQueue.isEmpty()) {
                 System.out.println("  (Context Switch)");
             }
        }
        System.out.println("\nSimulation Finished at time " + currentTime);
    }

    public static void main(String[] args) {
        Queue<Process> processes = new LinkedList<>();
        processes.offer(new Process("P1", 10));
        processes.offer(new Process("P2", 5));
        processes.offer(new Process("P3", 8));

        simulate(processes, 4); // 타임 퀀텀 4로 시뮬레이션
    }
}
```
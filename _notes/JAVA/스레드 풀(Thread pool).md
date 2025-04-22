---
title: 스레드 풀(Thread pool)
category: JAVA
---
스레드 풀은 미리 일정 개수의 작업자 스레드(Worker Thread)를 생성해 놓고, 작업 요청이 들어올 때마다 풀에 있는 유휴 스레드를 할당하여 작업을 처리하는 방식이다. 작업이 완료되면 해당 스레드는 다시 풀로 반환되어 다음 작업을 기다린다. 

![[Pasted image 20250414160413.png]]


------------------------------------------

성능 향상 :
- 스레드 생성/소멸 오버헤드 감소: 작업 요청마다 스레드를 생성하고 소멸시키는 비용은 상당히 크다. 스레드 풀은 스레드를 재사용하므로 이 오버헤드를 줄여 성능을 향상시킨다.
- 응답 시간 단축: 스레드가 미리 생성되어 있으므로 작업 요청 시 즉시 처리를 시작할 수 있어 응답 시간이 단축된다. 
자원 관리 및 제한:
- 시스템 자원 고갈 방지: 무분별하게 스레드를 생성하면 시스템 메모리 및 CPU자원을 과도하게 소모하여 시스템 전체 성능이 저하되거나 다운될 수 있다. 스레드 풀은 동시에 활성화될 수 있는 스레드 수를 제한하여 자원 사용을 효율적으로 관리한다. 
관리 용이성:
- 스레드 풀은 스레드의 생성, 관리, 스케줄링 등을 추상화하여 개발자가 동시성 로직에 더 집중할 수 있게 해준다. 

-----------------------------------------------------------------

주요 스레드 풀 종류(Executors 팩토리 메서드):
1. newFixedThreadPool(int nThreads): 
	-  고정된 개수(`nThreads`)의 스레드를 가지는 풀을 생성한다.
    - 모든 스레드가 작업 중이면, 작업 큐(`LinkedBlockingQueue` - 무한대 크기)에 대기한다.
    - **주의:** 작업 큐가 무한대이므로 작업이 처리 속도보다 빨리 쌓이면 `OutOfMemoryError`가 발생할 수 있다. 서버 환경에서는 사용을 지양하는 것이 좋다.
2. newCachedThreadPool:
	-  필요에 따라 스레드 수가 동적으로 조절되는 풀을 생성한다.
	- 유휴 스레드가 있으면 재사용하고, 없으면 새 스레드를 생성한다. (기본 60초 동안 유휴 상태면 스레드 제거)
	- 작업 큐로 `SynchronousQueue`를 사용하여 작업을 스레드에 직접 전달한다. (큐에 저장하지 않음).
	- **주의:** 작업 요청이 폭주하면 스레드 수가 무한정 늘어나 시스템 자원을 고갈시킬 수 있다. 최대 스레드 수 제한이 필요하다.
3. newSingleThreadExecutor: 
	- 단 하나의 스레드만 사용하는 풀을 생성한다. 
	- 작업은 제출된 순서대로 순차적으로 실행된다.
	- `LinkedBlockingQueue`를 사용한다.
	- **주의:** `newFixedThreadPool(1)`과 유사하며, 무한대 큐로 인한 OOM 위험이 있다.
4. newScheduledThreadPool
	- 작업을 특정 시간 후에 실행하거나 주기적으로 실행할 수 있는 풀을 생성한다. 
5. newVirtualThreadPerTaskExecutor
	- **경량 스레드:** 가상 스레드는 JVM에 의해 관리되는 매우 가벼운 스레드이다. OS의 네이티브(플랫폼) 스레드와 1:1로 매핑되지 않다.
	- **고성능 동시성:** 특히 I/O 작업 등에서 스레드가 차단(block)되는 시간이 많은 애플리케이션의 처리량(throughput)을 극대화하기 위해 설계되었다.
	- **저렴한 비용:** 생성 및 차단 비용이 플랫폼 스레드에 비해 훨씬 저렴하다. 수백만 개의 가상 스레드를 생성하는 것도 가능하다.
	- **동작 방식 (간략히):** 가상 스레드는 실제 작업을 수행하기 위해 플랫폼 스레드(이를 **캐리어 스레드(Carrier Thread)**라고 하며, 보통 공유 `ForkJoinPool` 사용)에 탑재(mount)된다. 만약 가상 스레드가 I/O 등으로 차단되면, JVM은 해당 가상 스레드를 캐리어 스레드에서 분리(unmount)시키고, 캐리어 스레드는 다른 작업을 수행할 수 있게 됩니다. I/O 작업이 완료되면 가상 스레드는 다시 사용 가능한 캐리어 스레드에 탑재되어 실행을 재개한다.

```java
import java.util.concurrent.*;

public class ThreadPoolExecutorExample {

    public static void main(String[] args) {
        int corePoolSize = 2;      // 핵심 스레드 수 (기본적으로 유지되는 스레드)
        int maximumPoolSize = 4;   // 최대 스레드 수
        long keepAliveTime = 60L; // 유휴 스레드 생존 시간
        TimeUnit unit = TimeUnit.SECONDS; // 생존 시간 단위
        BlockingQueue<Runnable> workQueue = new ArrayBlockingQueue<>(10); // 작업 큐 (크기 제한!)
        ThreadFactory threadFactory = Executors.defaultThreadFactory(); // 스레드 생성 팩토리 (이름 지정 등 커스텀 가능)
        RejectedExecutionHandler handler = new ThreadPoolExecutor.CallerRunsPolicy(); // 거부 정책

        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                corePoolSize,
                maximumPoolSize,
                keepAliveTime,
                unit,
                workQueue,
                threadFactory,
                handler
        );

        // 작업 제출 (Runnable)
        for (int i = 0; i < 15; i++) {
            final int taskId = i;
            executor.execute(() -> {
                System.out.println(Thread.currentThread().getName() + " is executing task " + taskId);
                try {
                    Thread.sleep(1000); // 작업 시뮬레이션
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
             System.out.println("Submitted task " + taskId + ", Pool Size: " + executor.getPoolSize() + ", Queue Size: " + workQueue.size());
        }


        // 작업 제출 (Callable)
        Future<String> futureResult = executor.submit(() -> {
            System.out.println(Thread.currentThread().getName() + " is executing a callable task.");
            Thread.sleep(2000);
            return "Callable Result";
        });

        try {
            System.out.println("Waiting for callable result...");
            String result = futureResult.get(); // 결과가 나올 때까지 블로킹
            System.out.println("Callable Result: " + result);
        } catch (InterruptedException | ExecutionException e) {
            e.printStackTrace();
        }


        // 스레드 풀 종료
        System.out.println("Shutting down executor...");
        executor.shutdown(); // 새로운 작업은 받지 않고, 진행 중인 작업 및 큐의 작업은 완료
        // executor.shutdownNow(); // 즉시 종료 시도 (진행 중인 스레드 인터럽트)

        try {
            // 지정된 시간 동안 종료를 기다림
            if (!executor.awaitTermination(60, TimeUnit.SECONDS)) {
                 System.err.println("Executor did not terminate in the specified time.");
                 executor.shutdownNow(); // 강제 종료 시도
            } else {
                System.out.println("Executor terminated successfully.");
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
```

트랜잭션 격리 수준은 동시에 여러 트랜잭션이 실행될 때, ***각 트랜잭션이 다른 트랜잭션의 작업으로부터 얼마나 격리되어야 하는지를 정의하는 수준***이다. 격리 수준이 높을수록 트랜잭션 간의 간섭은 줄어들지만, 동시성(Concurrency)은 낮아진다. 반대로 격리 수준이 낮을수록 동시성은 높아지지만, 데이터 일관성에 문제가 발생할 수 있다. 


격리 수준의 종류
1. READ UNCOMMITTED(커밋되지 않은 읽기):
	- 트랜잭션이 아직 커밋되지 않은 데이터를 다른 트랜잭션이 읽을 수 있다. 
	- Dirty Read, Non-Repeatable Read, Phantom Read 현상이 발생할 수 있다. 
	- 동시성은 가장 높지만, 데이터 일관성이 가장 낮다. 
2. READ COMMITTED(커밋된 읽기):
	- 트랜잭션이 커밋된 데이터만 다른 트랜잭션이 읽을 수 있다. 
	- Dirty Read는 방지되지만, Non-Repeatable Read, Phantom Read 현장은 발생할 수 있다.
	- 대부분의 RDBMS에서 기본 격리 수준으로 사용된다. (PostgreSQL)
3. REPREATABLE READ(반복 가능한 읽기):
	- 트랜잭션이 시작된 후, 동일한 SELECT 쿼리는 항상 동일한 결과를 반환한다. 
	- Dirty Read, Non-Repeatable Read, Phantom Read 현상을 모두 방지한다. 
4. SERIALIZABLE(직렬화 기능):
	- 가장 엄격한 격리 수준으로, 트랜잭션이 순차적으로 실행되는 것처럼 동작한다. 
	- Dirty Read, Non-Repeatable Read, Phantom Read 현상을 모두 방지한다. 
	- 동시성이 가장 낮고, 성능 저하가 발생할 수 있다. 


발생 가능한 문제 현상
- Dirty Read: 한 트랜잭션이 아직 커밋되지 않은 데이터를 다른 트랜잭션이 읽는 현상
![[Pasted image 20250324150011.png]]

- Non-Repeatable Read: 한 트랜잭션 내에서 같은 쿼리를 두 번 실행했을 때, 첫 번째 쿼리의 결과와 두번째 쿼리의 결과가 다른 현상 (다른 트랜잭션이 중간에 데이터를 수정하거나 삭제한 경우 )

![[Pasted image 20250324152427.png]]

- Phantom Read: 한 트랜잭션 내에서 같은 쿼리를 두 번 실행했을 때, 첫번째 쿼리에서는 없었던 레코드가 두번 째 쿼리에서 나타나는 현상. (다른 트랜잭션이 중간에 새로운 레코드를 삽입한 경우)

![[Pasted image 20250324152946.png]]
Hash Join은 PostgreSQL에서 두 개 이상의 테이블을 조인하는 데 사용되는 효율적인 알고리즘 중 하나이다. [[중첩 루프 조인(Nested Loop)]] Join와 비교했을 때, 특히 큰 테이블을 조인할 때 성능상의 이점을 제공한다. 

1. 빌드 단계(Build Phase)
	- 작은 테이블을 선택: 조인에 참여하는 테이블 중 더 작은 테이블(일반적으로 외부 테이블)을 선택한다. 
	- 해시 테이블 생성: 선택된 테이블의 조인 키에 적용하여 해시 테이블을 메모리에 생성한다. 해시 테이블은 키 값 쌍으로 구성되며, 키는 해시 함수의 결과값이고, 값은 해당 행 정보이다.
	![[Pasted image 20250319173308.png]]
2. 프로브 단계(Probe Phase)
	- 큰 테이블 스캔: 다른 테이블(일반적으로 내부 테이블)을 순차적으로 스캔한다. 
	- 해시 테이블 조회: 스캔하는 각 행의 조인 키를 동일한 해시 함수에 적용하여 해시 값을 계산한다. 
	- 매칭 확인: 계산된 해시값을 사용하여 메모리에 있는 해시 테이블을 조회한다. 
	- 해시 충돌(Hash Collision): 서로 다른 키가 같은 해시 값을 갖는 경우를 해시 충돌이라고 한다. 해시 충돌이 발생하면, 해시 테이블 내에서 실제 조인 조건을 만족하는 행을 찾기 위한 추가적인 비교가 필요하다. 
	- 매칭 성공: 해시 테이블에서 일치하는 항목을 찾으면, 해당 행들을 결합하여 결과 집합에 추가한다. 
	- 매칭 실패: 해시 테이블에서 일치하는 항목을 찾지 못하면, 해당 행은 조인 결과에서 제외된다. 
	 ![[Pasted image 20250319173741.png]]

최적화
- 빌드 입력(해시 테이블을 만드는 데 사용되는 테이블)은 가능한 한 작은 테이블을 선택하는 것이 좋다. 이렇게 하면 해시 테이블의 크기를 줄여 메모리 사용량을 줄이고, 해시 충돌 가능성도 낮출 수 있기 때문이다. 

``` sql
EXPLAIN 
SELECT o.*, c.name 
FROM orders o JOIN customers c ON o.customer_id = c.id;
---

Hash Join (cost=1.25..101.50 rows=1000 width=64) Hash Cond: (o.customer_id = c.id) -> Seq Scan on orders o (cost=0.00..60.00 rows=1000 width=32) -> Hash (cost=1.00..1.00 rows=100 width=32) -> Seq Scan on customers c (cost=0.00..1.00 rows=100 width=32)
```

- **Hash Join:** Hash Join이 사용되었음을 나타냄.
- **Hash Cond:** 조인 조건(`o.customer_id = c.id`)을 보여줌.
- `-> Seq Scan on orders o`: `orders` 테이블이 순차 스캔됌 (Probe Input).
- `-> Hash`: `customers` 테이블에 대한 해시 테이블이 생성 (Build Input).
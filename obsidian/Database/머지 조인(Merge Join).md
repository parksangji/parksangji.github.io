Merge Join은 PostgreSQL에서 두 개 이상의 테이블을 조인하는 데 사용되는 또 다른 효율적인 알고리즘이다. [[해시 조인(Hash Join)]]과 마찬가지로 [[중첩 루프 조인(Nested Loop)]] Join보다 큰 테이블 조인에 유리하지만, 작동 방식과 최적 조건이 다르다. 

Merge Join은 두 테이블이 모두 조인 키를 기준으로 정렬 되어 있다는 전제하에 작동된다. 

1. 정렬(Sort, 이미 정렬된 경우는 생략):
	 조인에 참여하는 두 테이블이 아직 조인 키를 기준으로 정렬되어 있지 않다면, 먼저 각 테이블을 정렬한다. 
	 만약 조인 키에 인덱스가 있고, 이 인덱스를 통해 정렬된 순서대로 데이터를 읽을 수 있다면 명시적인 정렬 단계는 생략될 수 있다. (Index Scan을 통한 정렬)
2. 병합 (Merge):
	 두 테이블의 현재 행을 가리키는 포인터를 각각 초기화한다. 
	 두 포인터를 이동시키면서 조인 키를 비교한다. 
	 같으면: 두 행을 결합하여 결과 집합에 추가하고, 두 포인터를 모두 다음 행으로 이동시킨다. 
	 한쪽이 작으면: 작은 쪽의 포인터를 다음 행으로 이동
	 한쪽이 크면: 큰 쪽의 포인터를 다음 행으로 이동
	두 테이블 중 하나의 끝에 도달할 때까지 이 과정을 반복한다. 

![[스크린샷 2025-03-19 오후 5.56.10.png]]

```sql

EXPLAIN 
SELECT o.*, c.name 
FROM orders o JOIN customers c ON o.customer_id = c.id 
WHERE 
o.order_date >= '2023-01-01' 
AND o.order_date < '2024-01-01';
------------------------------------------
Merge Join (cost=10.25..110.75 rows=1000 width=64) Merge Cond: (o.customer_id = c.id) -> Index Scan using orders_customer_id_idx on orders o (cost=0.15..50.25 rows=1000 width=32) Filter: (order_date >= '2023-01-01'::date AND order_date < '2024-01-01'::date) -> Sort (cost=10.10..10.35 rows=100 width=32) Sort Key: c.id -> Seq Scan on customers c (cost=0.00..1.00 rows=100 width=32)
```

- **Merge Join:** Merge Join이 사용되었음을 나타냄.
- **Merge Cond:** 조인 조건(`o.customer_id = c.id`)을 보여줌.
- `-> Index Scan using orders_customer_id_idx on orders o`: `orders` 테이블의 `orders_customer_id_idx` 인덱스를 사용하여 정렬된 순서로 데이터를 읽어옴.(명시적인 정렬 불필요).
- `-> Sort`: customers는 인덱스를 사용하지 않아, 정렬을 수행.
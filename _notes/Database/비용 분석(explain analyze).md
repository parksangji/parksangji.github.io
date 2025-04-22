
PostgreSQL의 EXPLAIN는 쿼리를 실제로 실행하기 때문에 결과가 더 정확하고, 성능 병목 현상을 파악하는데 매우 유용하다. 

```sql
select 
	*  
from  
    site_master sm;
```
```
Seq Scan on site_master sm  (cost=0.00..232838.13 rows=2034513 width=1141) (actual time=0.010..1952.980 rows=2034081 loops=1)
Planning Time: 0.137 ms
Execution Time: 2041.806 ms
```

cost : 0.010 (첫번째 행을 가져오는데 걸린 시간) ~ 232838.13(마지막 행을 가져오는데 걸린 시간)
rows: 반환된 행의 개수(2034513)
loops=1: Seq Scan이 한번 실행되었음을 의미 
width=1141: 각 행의 평균 크기(바이트 단위)
Planning Time: 쿼리 계획 수립 시간 (이거는 기계(옵티마이저)가 이 쿼리를 어떻게 실행할지 결정하는데 소유한 시간)
Execution Time: 쿼리 실행 시간 (쿼리를 실제로 실행하는 데 걸린 시간)

```sql
select *  
from  
    site_master sm  
WHERE  
    sm.site_lat = 0;  
  
Gather  (cost=1000.00..224089.72 rows=3 width=1141) (actual time=222.823..864.844 rows=60 loops=1)  
  Workers Planned: 2  
  Workers Launched: 2  
  ->  Parallel Seq Scan on site_master sm  (cost=0.00..223089.42 rows=1 width=1141) (actual time=258.277..856.937 rows=20 loops=3)  
        Filter: (site_lat = '0'::numeric)  
        Rows Removed by Filter: 678007  
Planning Time: 0.176 ms  
Execution Time: 864.884 ms  
```

Gather: 여러 워커(Worker) 프로세스에서 생성된 결과를 모아서 하나의 결과로 만드는 역할

Workers Planned=2: 쿼리 실행 계획 수립 시 2개의 워커 프로세스를 사용할 계획
Workers Launched=2: 실제로 2개의 워커 프로세스가 실행됌.

 * Parallel Seq Scan on site_master sm : 
	 * actual time=258.277..856.937:
	 * rows=20: 각 워커가 평균 20개씩 찾음 
	 * loops=3: 각 워커 프로세스가 Seq Scan을 평균 3회 수행함.
* Rows Removed by Filter: 678007 :
		조건에 충족되지 않는 데이터 삭제 개수

![](https://www.percona.com/blog/wp-content/uploads/2019/07/Process-Worker-Seq-Scan-4.png)


```sql
create index site_master_site_lat_idx on site_master (site_lat);
  
Index Scan using site_master_site_lat_idx on site_master sm  (cost=0.43..16.17 rows=3 width=1141) (actual time=0.026..0.133 rows=60 loops=1)  
  Index Cond: (site_lat = '0'::numeric)  
Planning Time: 0.210 ms  
Execution Time: 0.163 ms
```

```python
# 책 뒤쪽의 색인(index)에서 "site_lat = 0"에 해당하는 페이지 번호 목록을 찾음 
page_numbers = index.lookup("site_lat = 0") 
result = [] 

for page_number in page_numbers: # 해당 페이지로 바로 이동하여 데이터(row)를 읽음 
	row = read_data_from_page(page_number) 
	result.append(row)
```


site_master_site_lat_idx : 인덱스 명칭

```sql
-- 

SELECT *  
FROM  
    site_interest_group sig  
JOIN site_interest_group_map sigm ON sig.site_interest_group_id = sigm.site_interest_group_id


Hash Join  (cost=19.91..4590.43 rows=16333 width=317) (actual time=0.158..9.688 rows=13746 loops=1)
  Hash Cond: (sigm.site_interest_group_id = sig.site_interest_group_id)
  ->  Seq Scan on site_interest_group_map sigm  (cost=0.00..4527.33 rows=16333 width=269) (actual time=0.011..5.487 rows=14347 loops=1)
  ->  Hash  (cost=12.74..12.74 rows=574 width=48) (actual time=0.140..0.141 rows=611 loops=1)
        Buckets: 1024  Batches: 1  Memory Usage: 58kB
        ->  Seq Scan on site_interest_group sig  (cost=0.00..12.74 rows=574 width=48) (actual time=0.005..0.062 rows=611 loops=1)
Planning Time: 0.226 ms
Execution Time: 10.322 ms

```
 
[[해시 조인(Hash Join)]]은 두 테이블을 조인하는 방법 중 하나이다. 일반적으로 한 테이블을 기반으로 해시 테이블을 만들고, 다른 테이블을 스캔하면서 해시 테이블에서 일치하는 행을 찾아 조인한다. 

```python
# sig 테이블을 기반으로 해시 테이블 생성 (딕셔너리 형태)
hash_table = {}
for row in sig_table:
    key = row['site_interest_group_id']
    hash_table[key] = row
```

sig 테이블의 각 행에 대해 site_interest_group_id를 키(key)로 하고, 행 전체를 값으로 하는 해시 테이블을 만든다. 
```python
result = []

# sigm 테이블을 스캔하면서 해시 테이블에서 매칭되는 행을 찾음
for row in sigm_table:
    key = row['site_interest_group_id']
    if key in hash_table:
        joined_row = {**hash_table[key], **row}  # 두 딕셔너리를 합침
        result.append(joined_row)
```

sigm 테이블의 각 행에 대해 site_interest_group_id를 키로 사용하여 해시 테이블에서 해당 키를 찾는다. 
해시 테이블에서 키를 찾으면 sig테이블의 해당 행과 sigm 테이블의 현재 행을 결합하여 결과에 추가한다. 

```sql
SELECT *  
FROM  
    site_interest_group sig  
        JOIN site_interest_group_map sigm ON sig.site_interest_group_id = sigm.site_interest_group_id  
where  
    sig.site_interest_group_id = 1;

Nested Loop  (cost=0.28..4561.58 rows=983 width=317) (actual time=0.051..3.217 rows=983 loops=1)
  ->  Index Scan using site_interest_group_pkey on site_interest_group sig  (cost=0.28..8.29 rows=1 width=48) (actual time=0.034..0.035 rows=1 loops=1)
        Index Cond: (site_interest_group_id = 1)
  ->  Seq Scan on site_interest_group_map sigm  (cost=0.00..4543.46 rows=983 width=269) (actual time=0.015..3.020 rows=983 loops=1)
        Filter: (site_interest_group_id = 1)
        Rows Removed by Filter: 13374
        
Planning Time: 0.122 ms
Execution Time: 3.302 ms
```

[[중첩 루프 조인(Nested Loop)]]
한 테이블의 각 행에 대해 다른 테이블을 반복적으로 스캔하면서 조인 조건을 만족하는 행을 찾는 방식 

```python
result = []

# Index Scan을 사용하여 site_interest_group_id가 1인 행의 위치(rowid 또는 primary key)를 빠르게 찾음
row_locations = index_lookup(sig_table, 'site_interest_group_id', 1)  # 가상의 index_lookup 함수

# 찾은 위치를 기반으로 실제 행 데이터를 가져옴
for row_location in row_locations:
    sig_row = get_row_from_location(sig_table, row_location) # 가상의 get_row_from_location 함수

    # Nested Loop의 내부 루프: site_interest_group_map 테이블 순회
    for sigm_row in sigm_table:
        # 조인 조건 확인 (여기서는 sig_row에 이미 site_interest_group_id = 1 조건이 반영됨)
        if sig_row['site_interest_group_id'] == sigm_row['site_interest_group_id']:
            # 조인된 행을 결과에 추가
            joined_row = {**sig_row, **sigm_row}
            result.append(joined_row)
```

sig_table의 site_interest_group_id 컬럼에 대한 인덱스를 사용하여 값이 1인 행들의 위치를 빠르게 찾는다.

site_interest_group_map테이블을 순회하면서 sig_row와의 조인 조건을 확인하고, 조건을 만족하는 행들을 결합하여 결과에 추가한다. 

```sql
CREATE INDEX site_interest_group_map_site_interest_group_id_index  
    ON site_interest_group_map (site_interest_group_id);
    
SELECT *  
FROM  
    site_interest_group sig  
        JOIN site_interest_group_map sigm ON sig.site_interest_group_id = sigm.site_interest_group_id  
where  
    sig.site_interest_group_id = 1;

Nested Loop  (cost=4.67..66.62 rows=14 width=317) (actual time=0.038..0.060 rows=20 loops=1)
  ->  Index Scan using site_interest_group_pkey on site_interest_group sig  (cost=0.28..8.29 rows=1 width=48) (actual time=0.010..0.010 rows=1 loops=1)
        Index Cond: (site_interest_group_id = 3)
  ->  Bitmap Heap Scan on site_interest_group_map sigm  (cost=4.39..58.19 rows=14 width=269) (actual time=0.025..0.043 rows=20 loops=1)
        Recheck Cond: (site_interest_group_id = 3)
        Heap Blocks: exact=6
        ->  Bitmap Index Scan on site_interest_group_map_site_interest_group_id_index  (cost=0.00..4.39 rows=14 width=0) (actual time=0.017..0.017 rows=20 loops=1)
              Index Cond: (site_interest_group_id = 3)
Planning Time: 0.594 ms
Execution Time: 0.129 ms

```

Bitmap Index Scan: 각 페이지(Heap Blocks)에 조건을 만족하는 행이 있는지 여부를 나타내는 비트맵을 생성한다. 예를 들어, 조건을 만족하는 행이 1, 3, 5번 페이지에 있다면, 비트맵은 1010100... 과 같이 표현될 수 있다. 

![[Pasted image 20250321155516.png]]


Bitmap Heap Scan:
실제 테이블(site_interest_group_map)에서 데이터를 읽는다. 비트맵은 페이지 단위로 데이터를 가리키므로, 페이지 내에서 정확한 행을 찾기 위해 다시 한번 조건을 검사한다. 

Heap Blocks: 비트맵이 가리키는 페이지의 수를 나타내며, 이 경우 6개의 페이지에 접근해야 함을 의미한다. 즉 조건에 만족하는 20개의 행이 6개의 페이지에 분산되어 있다는 뜻이다. 
```python
result = []

# 1. Index Scan을 사용하여 site_interest_group_id가 3인 행의 위치를 빠르게 찾음 (외부 테이블)
sig_row_locations = index_lookup(sig_table, 'site_interest_group_id', 3)

for sig_row_location in sig_row_locations:
    sig_row = get_row_from_location(sig_table, sig_row_location)

    # 2. Bitmap Index Scan을 사용하여 site_interest_group_map에서 site_interest_group_id가 3인 행들의 비트맵을 생성 (내부 테이블)
    bitmap = bitmap_index_scan(sigm_table, 'site_interest_group_map_site_interest_group_id_index', 'site_interest_group_id', 3)

    # 3. Bitmap Heap Scan을 사용하여 비트맵에 해당하는 행들을 테이블에서 가져옴
    sigm_rows = bitmap_heap_scan(sigm_table, bitmap)

    # 4. Nested Loop (여기서는 이미 필요한 행들만 가져왔기 때문에 간단하게 처리)
    for sigm_row in sigm_rows:
        # 조인 (이미 조건에 맞는 행들만 있으므로, sig_row와 sigm_row를 바로 결합)
        joined_row = {**sig_row, **sigm_row}
        result.append(joined_row)
```


```sql
select *  
from  
    site_interest_group sig  
        JOIN (
	        SELECT *  
              FROM  
                  site_interest_group_map sigm  
              ) sigm ON sig.site_interest_group_id = sigm.site_interest_group_id  
ORDER BY  
    sig.site_interest_group_id

Gather Merge  (cost=5834.84..7230.73 rows=11964 width=317) (actual time=13.718..19.071 rows=13756 loops=1)
  Workers Planned: 2
  Workers Launched: 2
  ->  Sort  (cost=4834.81..4849.77 rows=5982 width=317) (actual time=6.118..6.693 rows=4585 loops=3)
        Sort Key: sig.site_interest_group_id
        Sort Method: quicksort  Memory: 1694kB
        Worker 0:  Sort Method: quicksort  Memory: 25kB
        Worker 1:  Sort Method: quicksort  Memory: 1286kB
        ->  Hash Join  (cost=19.91..4459.55 rows=5982 width=317) (actual time=0.128..4.150 rows=4585 loops=3)
              Hash Cond: (sigm.site_interest_group_id = sig.site_interest_group_id)
              ->  Parallel Seq Scan on site_interest_group_map sigm  (cost=0.00..4423.82 rows=5982 width=269) (actual time=0.005..2.648 rows=4786 loops=3)
              ->  Hash  (cost=12.74..12.74 rows=574 width=48) (actual time=0.154..0.154 rows=611 loops=2)
                    Buckets: 1024  Batches: 1  Memory Usage: 58kB
                    ->  Seq Scan on site_interest_group sig  (cost=0.00..12.74 rows=574 width=48) (actual time=0.008..0.064 rows=611 loops=2)
Planning Time: 0.262 ms
Execution Time: 19.784 ms
```


```sql
select *  
from  
    site_interest_group sig  
        JOIN (  
            SELECT *  
              FROM  
                  site_interest_group_map sigm  
              order by  
                  site_interest_group_id  
              ) sigm ON sig.site_interest_group_id = sigm.site_interest_group_id  
ORDER BY  
    sig.site_interest_group_id;

Merge Join  (cost=5838.15..7457.93 rows=11964 width=317) (actual time=10.256..17.435 rows=13756 loops=1)
  Merge Cond: (sigm.site_interest_group_id = sig.site_interest_group_id)
  ->  Gather Merge  (cost=5799.11..7195.01 rows=11964 width=269) (actual time=10.086..13.070 rows=14357 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        ->  Sort  (cost=4799.08..4814.04 rows=5982 width=269) (actual time=3.732..4.170 rows=4786 loops=3)
              Sort Key: sigm.site_interest_group_id
              Sort Method: quicksort  Memory: 1798kB
              Worker 0:  Sort Method: quicksort  Memory: 25kB
              Worker 1:  Sort Method: quicksort  Memory: 764kB
              ->  Parallel Seq Scan on site_interest_group_map sigm  (cost=0.00..4423.82 rows=5982 width=269) (actual time=0.005..2.060 rows=4786 loops=3)
  ->  Sort  (cost=39.04..40.48 rows=574 width=48) (actual time=0.164..0.207 rows=611 loops=1)
        Sort Key: sig.site_interest_group_id
        Sort Method: quicksort  Memory: 81kB
        ->  Seq Scan on site_interest_group sig  (cost=0.00..12.74 rows=574 width=48) (actual time=0.007..0.067 rows=611 loops=1)
Planning Time: 0.252 ms
Execution Time: 18.273 ms
```
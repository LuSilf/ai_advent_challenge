# Day 26 — Local LLM smoke-benchmark report

Generated at: 2026-04-21T06:05:53.760Z

## Hardware
- CPU: Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz
- RAM: 62.44 GB
- Backend: CUDA
- GPU: NVIDIA GeForce GTX 1650 with Max-Q Design
- VRAM: 4 GB

## Configuration
- temperature=0, seed=42
- Ollama base URL: http://localhost:11434/v1
- Cloud base URL: https://openrouter.ai/api/v1
- Targets:
  - qwen2.5-coder:7b (local) — model `qwen2.5-coder:7b`
  - llama3.2:3b (local) — model `llama3.2:3b`
  - openai/gpt-5-nano (cloud) — model `openai/gpt-5-nano`

## Summary
| Target | q01_factual latency / tps / cost | q02_reasoning latency / tps / cost | q03_code latency / tps / cost |
| --- | --- | --- | --- |
| qwen2.5-coder:7b (local) | 2631 ms / 0.76 tps / $0.000000 | 41159 ms / 9.52 tps / $0.000000 | 18430 ms / 9.33 tps / $0.000000 |
| llama3.2:3b (local) | 2325 ms / 0.86 tps / $0.000000 | 14080 ms / 38.42 tps / $0.000000 | 5185 ms / 36.64 tps / $0.000000 |
| openai/gpt-5-nano (cloud) | 2746 ms / 44.43 tps / $0.000050 | 26113 ms / 93.21 tps / $0.000975 | 12259 ms / 62.32 tps / $0.000309 |

## q01_factual — factual

**Prompt:** What is the capital of France? Answer with the city name only, no extra words.

### qwen2.5-coder:7b (local)
- Latency: 2631 ms
- Prompt tokens: 47, Completion tokens: 2, tokens/sec: 0.76
- finish_reason: `stop`
- Cost: $0.000000

**Answer:**

```
Paris
```

### llama3.2:3b (local)
- Latency: 2325 ms
- Prompt tokens: 43, Completion tokens: 2, tokens/sec: 0.86
- finish_reason: `stop`
- Cost: $0.000000

**Answer:**

```
Paris
```

### openai/gpt-5-nano (cloud)
- Latency: 2746 ms
- Prompt tokens: 24, Completion tokens: 122, tokens/sec: 44.43
- finish_reason: `stop`
- Cost: $0.000050

**Answer:**

```
Paris
```

## q02_reasoning — reasoning

**Prompt:** Explain the difference between cache-aside and write-through caching strategies. Include at least one trade-off for each approach.

### qwen2.5-coder:7b (local)
- Latency: 41159 ms
- Prompt tokens: 53, Completion tokens: 392, tokens/sec: 9.52
- finish_reason: `stop`
- Cost: $0.000000

**Answer:**

```
Cache-Aside and Write-Through are two common caching strategies used in distributed systems to improve data access performance.

1. Cache-Aside Caching Strategy:
   - In this strategy, the application first checks if the requested data is available in the cache. If it's not found (cache miss), the application fetches the data from the primary storage (like a database) and then stores it in the cache for future requests.
   - Conversely, when writing data back to the system, the application writes the data directly to both the cache and the primary storage. After successful write, the cache is updated with the new data.

2. Write-Through Caching Strategy:
   - In this strategy, every write operation is immediately written to both the cache and the primary storage. This ensures that the cache always contains the most up-to-date data.
   - When reading data, the application first checks if it's available in the cache. If not (cache miss), it fetches the data from the primary storage.

Trade-offs for Cache-Aside:
1. Performance: Cache-Aside can be faster because it avoids writing to both the cache and the primary storage when reading data.
2. Consistency: Cache-Aside may lead to inconsistency if the application fails to update the cache after a successful write to the primary storage, leading to stale data in the cache.

Trade-offs for Write-Through:
1. Performance: Write-Through can be slower because it writes to both the cache and the primary storage every time data is written.
2. Consistency: Write-Through ensures that the cache always contains the most up-to-date data, reducing the risk of stale data in the cache.

In summary, Cache-Aside provides better performance but may lead to inconsistency if not handled properly, while Write-Through ensures consistency but can be slower due to the additional write operation. The choice between these strategies depends on the specific requirements and constraints of your application.
```

### llama3.2:3b (local)
- Latency: 14080 ms
- Prompt tokens: 49, Completion tokens: 541, tokens/sec: 38.42
- finish_reason: `stop`
- Cost: $0.000000

**Answer:**

```
Cache-Aside and Write-Through are two popular caching strategies used in distributed systems to improve performance by reducing the number of requests made to the underlying storage.

**Cache-Aside Caching Strategy:**

In a Cache-Aside strategy, data is first stored in a cache layer before being written to the underlying storage. If the data is not found in the cache, it is retrieved from the storage and then cached for future use.

Here's how it works:

1. A request is made for a piece of data.
2. The cache layer checks if the data is already present in the cache.
3. If the data is found in the cache, it is returned directly to the requester.
4. If the data is not found in the cache, it is retrieved from the underlying storage.
5. Once the data is retrieved from storage, it is cached for future use.

**Trade-off:** One trade-off of Cache-Aside caching is that it can lead to stale data in the cache if the underlying storage is updated concurrently with the request. This means that even though the data has been written to the storage, it may still be returned from the cache, which could lead to inconsistencies.

**Write-Through Caching Strategy:**

In a Write-Through caching strategy, every write operation to the cache layer also updates the underlying storage immediately. The cache layer acts as a proxy for the storage, and any changes made to the data in the cache are reflected in the storage.

Here's how it works:

1. A request is made for a piece of data.
2. The cache layer checks if the data is already present in the cache.
3. If the data is found in the cache, it is returned directly to the requester.
4. If the data is not found in the cache, it is retrieved from the underlying storage and then cached for future use.
5. When a write operation is made to the cache layer (e.g., updating or inserting new data), the cache layer immediately updates the underlying storage.

**Trade-off:** One trade-off of Write-Through caching is that it can lead to increased latency due to the additional round trip to the storage for every write operation. This means that if a large number of writes are made concurrently, the system may experience slower performance due to the overhead of updating the storage.

In summary:

* Cache-Aside caching prioritizes read performance and reduces the load on the underlying storage, but can lead to stale data in the cache.
* Write-Through caching prioritizes consistency and ensures that data is up-to-date across all layers, but can lead to increased latency due to the additional round trip to the storage for every write operation.
```

### openai/gpt-5-nano (cloud)
- Latency: 26113 ms
- Prompt tokens: 29, Completion tokens: 2434, tokens/sec: 93.21
- finish_reason: `stop`
- Cost: $0.000975

**Answer:**

```
Here’s a concise comparison of cache-aside (lazy loading) and write-through caching, with typical trade-offs for each.

Cache-aside (lazy loading)
- How it works
  - Reads: The application first checks the cache. If the data is missing (cache miss), it fetches from the backing store (e.g., a database), then stores that value in the cache for next time.
  - Writes: The application writes to the backing store and then either invalidates the cache entry or leaves it as-is (often the cache is invalidated so the next read fetches fresh data from the store).
  - The cache is “outside” the write path and is populated on demand.
- Trade-offs
  - Pros:
    - Simple to implement and decoupled from the data store. No write-path coupling means less risk of a cache becoming a bottleneck for writes.
    - Excellent when you have a large dataset and only a subset is hot; you pay the cache cost only for hot items.
  - Cons:
    - Potential read latency on cold caches or after a write if you invalidate (the first read after a miss or after invalidation must re-fetch from the store).
    - Requires careful invalidation logic and can lead to eventual rather than immediate consistency if there are multiple writers or apps.
    - If data is highly write-intensive, frequent invalidations can reduce cache effectiveness.

Write-through (write-behind variants are separate)
- How it works
  - Every write goes to the cache and to the backing store as part of the same operation. The cache and the store stay in sync by design.
  - Reads are typically served from the cache (which is kept up-to-date by writes).
- Trade-offs
  - Pros:
    - Stronger and more predictable consistency between cache and store; reads don’t risk stale data due to separate invalidation timing.
    - Simpler write logic from the caller’s perspective; the cache acts as the single write path.
  - Cons:
    - Higher latency for writes (you pay the cost of writing to both cache and store).
    - Higher resource usage and tighter coupling between cache and store; cache availability becomes more critical (cache failure can impact writes).
    - Can become a bottleneck if the cache layer can’t keep up with write load or if cache durability/availability is not guaranteed.

When to use which
- Cache-aside is a good default for read-heavy workloads with large datasets, where occasional stale data is acceptable or can be mitigated with invalidation strategies and TTLs.
- Write-through is appealing when you need strong, immediate consistency between cache and store and are willing to pay the extra write latency and coupling cost.

If you want, I can tailor these to a specific tech stack (e.g., Redis + PostgreSQL, Memcached, or a cloud cache) and show concrete read/write steps or a simple code example.
```

## q03_code — code

**Prompt:** Write a TypeScript function `binarySearch(arr: number[], target: number): number` that returns the index of `target` in a sorted numeric array, or -1 if not found. Include JSDoc with @param and @returns. Output only the code, no explanation.

### qwen2.5-coder:7b (local)
- Latency: 18430 ms
- Prompt tokens: 86, Completion tokens: 172, tokens/sec: 9.33
- finish_reason: `stop`
- Cost: $0.000000

**Answer:**

```
```typescript
/**
 * Performs binary search on a sorted array to find the target value.
 * 
 * @param arr - The sorted array of numbers.
 * @param target - The number to search for in the array.
 * @returns The index of the target if found, otherwise -1.
 */
function binarySearch(arr: number[], target: number): number {
    let left = 0;
    let right = arr.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (arr[mid] === target) {
            return mid;
        } else if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return -1;
}
```
```

### llama3.2:3b (local)
- Latency: 5185 ms
- Prompt tokens: 82, Completion tokens: 190, tokens/sec: 36.64
- finish_reason: `stop`
- Cost: $0.000000

**Answer:**

```
```typescript
/**
 * Performs a binary search on a sorted array to find the index of a target value.
 *
 * @param {number[]} arr A sorted numeric array.
 * @param {number} target The target value to search for.
 * @returns {number} The index of the target value in the array, or -1 if not found.
 */
function binarySearch(arr: number[], target: number): number {
    let left = 0;
    let right = arr.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const midValue = arr[mid];

        if (midValue === target) {
            return mid;
        } else if (midValue < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return -1;
}
```
```

### openai/gpt-5-nano (cloud)
- Latency: 12259 ms
- Prompt tokens: 64, Completion tokens: 764, tokens/sec: 62.32
- finish_reason: `stop`
- Cost: $0.000309

**Answer:**

```
/**
 * Performs binary search on a sorted numeric array to find the index of a target value.
 * @param arr - A sorted array of numbers.
 * @param target - The value to search for.
 * @returns The index of target if found; otherwise -1.
 */
export function binarySearch(arr: number[], target: number): number {
  let left = 0;
  let right = arr.length - 1;

  while (left <= right) {
    const mid = left + Math.floor((right - left) / 2);
    const value = arr[mid];

    if (value === target) {
      return mid;
    }
    if (value < target) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return -1;
}
```

# Day 26 — Local LLM smoke-benchmark report

Generated at: 2026-04-21T06:01:00.618Z

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
| qwen2.5-coder:7b (local) | 2657 ms / 0.75 tps / $0.000000 | 41196 ms / 9.52 tps / $0.000000 | 18559 ms / 9.27 tps / $0.000000 |
| llama3.2:3b (local) | 2274 ms / 0.88 tps / $0.000000 | 14135 ms / 38.27 tps / $0.000000 | 5179 ms / 36.69 tps / $0.000000 |
| openai/gpt-5-nano (cloud) | 3180 ms / 30.19 tps / $0.000040 | 25728 ms / 108.01 tps / $0.001113 | 14167 ms / 64.09 tps / $0.000366 |

## q01_factual — factual

**Prompt:** What is the capital of France? Answer with the city name only, no extra words.

### qwen2.5-coder:7b (local)
- Latency: 2657 ms
- Prompt tokens: 47, Completion tokens: 2, tokens/sec: 0.75
- finish_reason: `stop`
- Cost: $0.000000

**Answer:**

```
Paris
```

### llama3.2:3b (local)
- Latency: 2274 ms
- Prompt tokens: 43, Completion tokens: 2, tokens/sec: 0.88
- finish_reason: `stop`
- Cost: $0.000000

**Answer:**

```
Paris
```

### openai/gpt-5-nano (cloud)
- Latency: 3180 ms
- Prompt tokens: 24, Completion tokens: 96, tokens/sec: 30.19
- finish_reason: `stop`
- Cost: $0.000040

**Answer:**

```
Paris
```

## q02_reasoning — reasoning

**Prompt:** Explain the difference between cache-aside and write-through caching strategies. Include at least one trade-off for each approach.

### qwen2.5-coder:7b (local)
- Latency: 41196 ms
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
- Latency: 14135 ms
- Prompt tokens: 49, Completion tokens: 541, tokens/sec: 38.27
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
- Latency: 25728 ms
- Prompt tokens: 29, Completion tokens: 2779, tokens/sec: 108.01
- finish_reason: `stop`
- Cost: $0.001113

**Answer:**

```
Here’s a concise comparison of cache-aside (lazy loading) and write-through caching, plus key trade-offs for each.

What they are

- Cache-aside (lazy loading)
  - How it works:
    - Reads: The application checks the cache first. On a miss, it loads from the backing store (e.g., database), then stores that value in the cache.
    - Writes: The application writes to the backing store. The cache is then invalidated or updated (often invalidated) to avoid serving stale data until the next read.
  - Typical behavior: The cache sits “aside” and is populated on demand. The cache and store can drift until the next access.

- Write-through caching
  - How it works:
    - Writes: The system writes to both the cache and the backing store in a single operation (often atomically in a transaction or via coordinated steps).
    - Reads: Reads typically come from the cache; if the entry is missing, it may be loaded from the store and then cached.
  - Typical behavior: The cache and store stay in sync, and users see consistent results for recent writes.

Key trade-offs

- Cache-aside
  - Pros:
    - Lower cache write traffic: Writes go directly to the backing store, not the cache, which can be cheaper and faster for write-heavy workloads.
    - Greater control and flexibility: You can implement custom invalidation or selective caching.
  - Cons:
    - Potential for stale reads: After a write, the cache may serve stale data until the next read triggers a reload.
    - More complexity to maintain coherence: The app must handle invalidation or refresh logic, which can be error-prone in distributed systems.

- Write-through
  - Pros:
    - Stronger consistency between cache and store: Writes are applied to both in a coordinated way, reducing the chance of reading stale data.
    - Simpler read path: Reads can reliably hit the cache without worrying about drift, assuming cache is kept up-to-date.
  - Cons:
    - Higher write latency: Each write must propagate to the cache and the backing store, which can slow write-heavy workloads.
    - More complex transactional/availability considerations: Ensuring atomicity across cache and store can be challenging, especially in distributed environments.

When to use which

- Cache-aside is often preferred when:
  - You have a large, mostly-read dataset with infrequent updates, and you want fine-grained control over what gets cached.
  - You want to minimize cache writes and tolerate occasional cache misses on reads.
- Write-through is often preferred when:
  - You need stronger consistency between cache and backing store and want simpler reasoning about read results after writes.
  - You can tolerate a bit more latency on writes or have a cache and store that can atomically coordinate updates.

In short: cache-aside gives you lazy, on-demand caching with explicit invalidation (more control, potentially more complexity), while write-through keeps cache and store in sync at write time (simpler consistency, but higher write latency).
```

## q03_code — code

**Prompt:** Write a TypeScript function `binarySearch(arr: number[], target: number): number` that returns the index of `target` in a sorted numeric array, or -1 if not found. Include JSDoc with @param and @returns. Output only the code, no explanation.

### qwen2.5-coder:7b (local)
- Latency: 18559 ms
- Prompt tokens: 86, Completion tokens: 172, tokens/sec: 9.27
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
- Latency: 5179 ms
- Prompt tokens: 82, Completion tokens: 190, tokens/sec: 36.69
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
- Latency: 14167 ms
- Prompt tokens: 64, Completion tokens: 908, tokens/sec: 64.09
- finish_reason: `stop`
- Cost: $0.000366

**Answer:**

```
/**
 * Binary search for a target value in a sorted numeric array.
 * @param arr - A sorted array of numbers.
 * @param target - The value to search for.
 * @returns The index of the target if found, otherwise -1.
 */
function binarySearch(arr: number[], target: number): number {
  let left = 0;
  let right = arr.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const value = arr[mid];

    if (value === target) {
      return mid;
    } else if (value < target) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return -1;
}
```

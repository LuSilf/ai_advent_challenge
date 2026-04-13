# Day 21 — Indexing comparison report

Embedder: **ollama/nomic-embed-text** (dim=768)

## Summary

| Strategy | Chunks | Avg size | Min size | Max size | Recall@3 | MRR |
|----------|-------:|---------:|---------:|---------:|---------:|----:|
| fixed | 85 | 1488 | 482 | 1500 | 90.0% | 0.717 |
| structural | 118 | 930 | 84 | 2000 | 80.0% | 0.683 |

## Per-query results

| # | Query | fixed rank | structural rank |
|---|-------|-----------:|----------------:|
| q01 | What is the difference between cache-aside and write-through caching strategies? | 1 | 1 |
| q02 | When should I use a NoSQL database instead of a SQL database? | 1 | 1 |
| q03 | How does master-slave database replication handle reads and writes? | 1 | 1 |
| q04 | What is the CAP theorem and what are its three properties? | 3 | 1 |
| q05 | How can I prevent cross-site scripting and cross-site request forgery attacks? | 2 | 3 |
| q06 | What is the difference between REST and RPC APIs? | — | — |
| q07 | What does eventual consistency mean in distributed systems? | 1 | 1 |
| q08 | How can I horizontally scale a relational database using sharding and federation? | 1 | 2 |
| q09 | How does a Content Delivery Network reduce latency for static assets? | 1 | 1 |
| q10 | What is the latency of reading 1 MB sequentially from SSD versus memory? | 3 | — |

## Qualitative examples

### q01: What is the difference between cache-aside and write-through caching strategies?

**fixed:**

1. `(no section)` — "UPDATE Users WHERE id = {0}", user_id, values) cache.set(user_id, user) ``` Write-through is a slow overall operation due to the write operation, but subsequen…
2. `(no section)` — s result to return, in order to save the actual execution. Databases often benefit from a uniform distribution of reads and writes across its partitions. Popula…
3. `(no section)` — ructure(s): * Remove the object from cache if its underlying data has changed * Allows for asynchronous processing: workers assemble objects by consuming the la…

**structural:**

1. `Cache > When to update the cache` — the cache is responsible for reading and writing to the database: * Application adds/updates entry in cache * Cache synchronously writes entry to data store * R…
2. `Cache > CDN caching` — ### CDN caching [CDNs](#content-delivery-network) are considered a type of cache.
3. `Cache > When to update the cache` — ### When to update the cache Since you can only store a limited amount of data in cache, you'll need to determine which cache update strategy works best for you…

### q02: When should I use a NoSQL database instead of a SQL database?

**fixed:**

1. `(no section)` — to understand which type of NoSQL database best fits your use case(s). We'll review **key-value stores**, **document stores**, **wide column stores**, and **gra…
2. `(no section)` — en-used in the Hadoop ecosystem, and [Cassandra](http://docs.datastax.com/en/cassandra/3.0/cassandra/architecture/archIntro.html) from Facebook. Stores such as …
3. `(no section)` — ont-suck/) * [Is there a good reason i see VARCHAR(255) used so often?](http://stackoverflow.com/questions/1217466/is-there-a-good-reason-i-see-varchar255-used-…

**structural:**

1. `Database > NoSQL` — ### NoSQL NoSQL is a collection of data items represented in a **key-value store**, **document store**, **wide column store**, or a **graph database**. Data is …
2. `Database > NoSQL` — y foreign keys or many-to-many relationships. Graphs databases offer high performance for data models with complex relationships, such as a social network. They…
3. `Cache > Database caching` — ### Database caching Your database usually includes some level of caching in a default configuration, optimized for a generic use case. Tweaking these settings …

### q03: How does master-slave database replication handle reads and writes?

**fixed:**

1. `(no section)` — tion**, **master-master replication**, **federation**, **sharding**, **denormalization**, and **SQL tuning**. #### Master-slave replication The master serves re…
2. `(no section)` — y, availability, stability, patterns</a></i> </p> ##### Disadvantage(s): master-master replication * You'll need a load balancer or you'll need to make changes …
3. `(no section)` — il-over adds more hardware and additional complexity. * There is a potential for loss of data if the active system fails before any newly written data can be re…

**structural:**

1. `Availability patterns > Replication` — ### Replication #### Master-slave and master-master This topic is further discussed in the [Database](#database) section: * [Master-slave replication](#master-s…
2. `Database > Relational database management system (RDBMS)` — ability, patterns</a></i> </p> ##### Disadvantage(s): master-master replication * You'll need a load balancer or you'll need to make changes to your application…
3. `Database > Relational database management system (RDBMS)` — ### Relational database management system (RDBMS) A relational database like SQL is a collection of data items organized in tables. **ACID** is a set of propert…

## Notes

### Embedder choice

The grill-me design decision originally picked `bge-m3` (1024 dim, multilingual,
8192 context) under the assumption it would be stable in Ollama. In practice it
was not: `bge-m3` in Ollama 0.x returns `NaN` values for sufficiently long
English inputs (observed at ~1500 characters of plain English), and the Ollama
server fails to serialize the response with `json: unsupported value: NaN`,
surfacing as HTTP 500. `mxbai-embed-large` (1024 dim) worked numerically but has
a 512-token context, which is too tight for 1500-character chunks. The final
choice is `nomic-embed-text` (768 dim, 2048 context) — stable, sufficient
context, strong on English corpora. The schema `chunk_vectors` was adjusted to
`float[768]` accordingly.

### Observations on the comparison

- **Fixed wins on this corpus** — 90% Recall@3 / 0.717 MRR vs 80% / 0.683 for
  structural. The 200-character overlap appears to catch concept boundaries
  that the structural splitter can miss when a concept sits exactly at an `##`
  boundary.
- **Fixed has no `section` metadata** (by design — the fixed-size chunker is
  section-agnostic). The qualitative examples in this report show `(no section)`
  for every fixed hit, while structural hits show meaningful breadcrumbs like
  `Cache > When to update the cache`. Structural metadata is strictly better
  for explainability of retrieval, even when the metric is slightly worse.
- **q06 "REST vs RPC" missed on both strategies.** Neither top-3 (fixed or
  structural) brought back the Communication > REST or Communication > RPC
  sections. This looks like an embedder weakness — `nomic-embed-text` does not
  reliably map the query "difference between REST and RPC APIs" onto the
  short, terse sections that define these terms in system-design-primer. A
  stronger embedder or a query-rewriting step would likely fix this.
- **q10 "latency of 1 MB from SSD" missed on structural, passed on fixed at
  rank 3.** The latency numbers in system-design-primer live in
  `Appendix > Latency numbers every programmer should know`, which is a
  table-heavy chunk with very little natural-language prose. Retrieval on a
  conversational query struggles to surface table-shaped chunks; the fixed
  strategy caught it only because its overlap pulled in a neighbouring prose
  fragment referencing latency numbers. Again, the problem is semantic, not
  structural — it would benefit from per-chunk summaries or a hybrid BM25
  pass.

### Takeaway

For this particular English-language engineering handbook with very rich
heading hierarchy, a simple fixed-size sliding window with overlap slightly
outperforms the structural chunker on pure retrieval metrics. The structural
strategy remains valuable for its breadcrumbs and its principled chunk
boundaries, and the gap is small (10 pp Recall, 0.03 MRR). A production
pipeline would likely combine both: structural metadata for display and
filtering, overlapping character windows underneath for retrieval recall.

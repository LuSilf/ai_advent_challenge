# Day 23 — RAG reranking & filtering comparison report

Generated at: 2026-04-16T06:39:35.313Z
Strategy: **structural**

## Mode comparison summary

| Mode | Avg judge | Avg cost | Wins vs baseline |
|------|-----------|----------|------------------|
| baseline | 2.90/3 | $0.000149 | — |
| rag-plain | 2.50/3 | $0.000215 | 0/10 |
| rag-threshold | 2.60/3 | $0.000207 | 0/10 |
| rag-reranker | 2.40/3 | $0.000200 | 0/10 |
| rag-full | 2.50/3 | $0.000221 | 0/10 |

## Per-question summary

| # | Question | baseline judge | rag-plain judge | rag-threshold judge | rag-reranker judge | rag-full judge |
|---|----------|---|---|---|---|---|
| q01 | What is the difference between cache-aside and write-through caching strategies? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| q02 | When should I use a NoSQL database instead of a SQL database? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| q03 | How does master-slave database replication handle reads and writes? | 3/3 | 2/3 | 3/3 | 1/3 | 2/3 |
| q04 | What is the CAP theorem and what are its three properties? | 3/3 | 3/3 | 2/3 | 2/3 | 3/3 |
| q05 | How can I prevent cross-site scripting and cross-site request forgery attacks? | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 |
| q06 | What is the difference between REST and RPC APIs? | 3/3 | 2/3 | 3/3 | 3/3 | 3/3 |
| q07 | What does eventual consistency mean in distributed systems? | 3/3 | 2/3 | 3/3 | 2/3 | 2/3 |
| q08 | How can I horizontally scale a relational database using sharding and federation? | 3/3 | 3/3 | 2/3 | 3/3 | 3/3 |
| q09 | How does a Content Delivery Network reduce latency for static assets? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| q10 | What is the latency of reading 1 MB sequentially from SSD versus memory? | 2/3 | 1/3 | 1/3 | 1/3 | 1/3 |

## q01: What is the difference between cache-aside and write-through caching strategies?

**Expectation:** Answer should explain that cache-aside loads data lazily on cache miss, while write-through updates cache and backing store synchronously on write. A good answer should mention trade-offs such as stale reads, simplicity, or write latency.

**Expected sections:** Cache > When to update the cache

### Baseline

Cost: $0.000155 (50/381)
Rules: 7/7 (strong)
Judge: 3/3 — Полное и корректное сравнение: объясняет ленивую подгрузку (cache-aside) и синхронное обновление кэша и БД (write-through), освещает задержку, консистентность и обновление/инвалидацию кэша. Соответствует ожидаемой секции и терминам.

### rag-plain

Cost: $0.000263 (2322/366)
Rules: 8/8 (strong)
Judge: 3/3 — Полное и корректное объяснение различий между cache-aside и write-through: lazy loading для cache-aside, синхронное обновление кэша и БД для write-through, освещены trade-offs (устарелость, задержки, простота). Соответствует секции Cache > When to update the cache и использованы ожидаемые смыслы/термины.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Cache > When to update the cache; distance=0.7314
  2. section=Cache > CDN caching; distance=0.7539
  3. section=Cache > When to update the cache; distance=0.7564

### rag-threshold

Cost: $0.000239 (2322/306)
Rules: 8/8 (strong)
Judge: 3/3 — Полное и корректное объяснение различий: cache-aside загружает данные по требованию (ленивое заполнение), без автоматического обновления кэша при записи; write-through обновляет кэш и backing store синхронно при записи. Учтены trade-offs (устаревшие данные без TTL/write-through, простота и задержка при промахе, задержка записи). Также упомянуты контекстуальные стратегии (write-behind, refresh-ahead).

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 2 rejected
  - section=Content delivery network > Pull CDNs; distance=0.8661
  - section=Cache > Web server caching; distance=0.8716

Final chunks:
  1. section=Cache > When to update the cache; distance=0.7314
  2. section=Cache > CDN caching; distance=0.7539
  3. section=Cache > When to update the cache; distance=0.7564

### rag-reranker

Cost: $0.000273 (2706/344)
Rules: 8/8 (strong)
Judge: 3/3 — Полностью корректный и содержательный ответ. Четко объясняет cache-aside как ленивую загрузку при miss и write-through как синхронное обновление в кэш и БД на запись, пишет о преимуществах и trade-offs (задержки, устаревшие данные, простота/сложность). Соответствует ожидаемой секции «Cache > When to update the cache» и использует нужные термины.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 2 rejected
  - section=Content delivery network > Pull CDNs; distance=0.8661
  - section=Cache > Web server caching; distance=0.8716

Reranker scores:
  - section=Cache > When to update the cache; distance=0.7314; relevance=0.50
  - section=Cache > When to update the cache; distance=0.7564; relevance=0.50
  - section=Cache > Application caching; distance=0.7838; relevance=0.50
  - section=Cache > When to update the cache; distance=0.8067; relevance=0.50

Final chunks:
  1. section=Cache > When to update the cache; distance=0.7314
  2. section=Cache > When to update the cache; distance=0.7564
  3. section=Cache > Application caching; distance=0.7838

### rag-full

Cost: $0.000258 (2704/306)
Rules: 7/8 (strong)
Judge: 3/3 — Полный и корректный ответ: объясняет lazy-loading для cache-aside и синхронное обновление backing store через кеш в write-through; упоминаются trade-offs (устаревшие данные, простота реализации, задержка записи) и связь с секцией Cache > When to update the cache.

**Rewritten query:** Explain the differences between cache-aside and write-through caching strategies in system design.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 0 rejected

Reranker scores:
  - section=Cache > When to update the cache; distance=0.7334; relevance=0.50
  - section=Cache > Application caching; distance=0.7517; relevance=0.50
  - section=Cache > When to update the cache; distance=0.7546; relevance=0.50
  - section=Cache > When to update the cache; distance=0.8227; relevance=0.50

Final chunks:
  1. section=Cache > When to update the cache; distance=0.7334
  2. section=Cache > Application caching; distance=0.7517
  3. section=Cache > When to update the cache; distance=0.7546


## q02: When should I use a NoSQL database instead of a SQL database?

**Expectation:** Answer should contrast SQL and NoSQL at a high level and mention that NoSQL can be a better fit for non-tabular data, large scale, flexible schema, or specific data models such as key-value/document/wide-column/graph.

**Expected sections:** Database > NoSQL, Database > SQL or NoSQL

### Baseline

Cost: $0.000157 (50/387)
Rules: 8/8 (strong)
Judge: 3/3 — Полностью корректный и понятный ответ: в целом сравнивает SQL и NoSQL на высоком уровне, охватывает случаи, когда уместен NoSQL (гибкая схема, горизонтальное масштабирование, не-relational данные, конкретные модели), перечисляет примеры хранилищ и моделей (ключ-знач, документ, wide column, граф), а также объясняет, когда SQL лучше (ACID, сложные запросы и т. п.).

### rag-plain

Cost: $0.000272 (1874/446)
Rules: 9/9 (strong)
Judge: 3/3 — Полностью соответствует ожиданиям: даёт высокоуровневое сравнение SQL vs NoSQL, подчеркивает преимущества NoSQL для гибкой схемы, масштабируемости и специфических моделей данных (key-value, документ, wide-column, graph). Упоминаются модели хранения, BASE против ACID, денормализация, случаи использования (быстрые изменения, отсутствие жестких связей), а также подберите конкретный тип под кейс. Соответствует разделам Database > NoSQL / SQL or NoSQL и терминам.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Database > NoSQL; distance=0.7990
  2. section=Database > NoSQL; distance=0.8024
  3. section=Cache > Database caching; distance=0.8102

### rag-threshold

Cost: $0.000249 (1874/387)
Rules: 9/9 (strong)
Judge: 3/3 — Полный и корректный ответ. Чётко сравнивает SQL и NoSQL на высоком уровне, указывает ключевые сценарии выбора NoSQL (нетабличные данные, масштабируемость, гибкая схема, модели key-value/document/wide-column/graph) и ограничения (ACID vs BASE, транзакции). Соответствует ожиданиям и секциям.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 4 rejected
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.8527
  - section=Database > Relational database management system (RDBMS); distance=0.8665
  - section=Index of system design topics; distance=0.8685
  - section=Communication > Remote procedure call (RPC); distance=0.8745

Final chunks:
  1. section=Database > NoSQL; distance=0.7990
  2. section=Database > NoSQL; distance=0.8024
  3. section=Cache > Database caching; distance=0.8102

### rag-reranker

Cost: $0.000309 (2398/472)
Rules: 9/9 (strong)
Judge: 3/3 — Полностью корректный и качественный ответ: хорошо контрастирует SQL и NoSQL на высоком уровне, охватывает гибкость схем, масштабирование, типы NoSQL (ключ-значение, документ, wide-column, граф) и примеры применения. Соответствует ожидаемым секциям и имеет grounding через указанные источники.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 4 rejected
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.8527
  - section=Database > Relational database management system (RDBMS); distance=0.8665
  - section=Index of system design topics; distance=0.8685
  - section=Communication > Remote procedure call (RPC); distance=0.8745

Reranker scores:
  - section=Database > NoSQL; distance=0.7990; relevance=0.50
  - section=Database > SQL or NoSQL; distance=0.8272; relevance=0.50
  - section=Database > NoSQL; distance=0.8024; relevance=0.30

Final chunks:
  1. section=Database > NoSQL; distance=0.7990
  2. section=Database > SQL or NoSQL; distance=0.8272
  3. section=Database > NoSQL; distance=0.8024

### rag-full

Cost: $0.000297 (2216/466)
Rules: 9/9 (strong)
Judge: 3/3 — Полный и корректный ответ: чётко контрастирует SQL и NoSQL, перечисляет сценарии для NoSQL (масштабируемость, гибкая/динамическая схема, разные data models: key-value/document/wide-column/graph, кэширование) и ограничения (ACID против BASE), а также приводит контекст использования SQL для структурированных данных и сложных связей. Соответствует ожидаемым секциям и retrieval-данным.

**Rewritten query:** What are the key differences between SQL and NoSQL databases, and when is it appropriate to use each?

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 4 rejected
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.8538
  - section=Domain name system > Disadvantage(s): DNS; distance=0.8588
  - section=Communication > RPC and REST calls comparison; distance=0.8589
  - section=Database > NoSQL; distance=0.8625

Reranker scores:
  - section=Database > NoSQL; distance=0.7533; relevance=0.50
  - section=Cache > Application caching; distance=0.7875; relevance=0.50
  - section=Database > SQL or NoSQL; distance=0.8039; relevance=0.50
  - section=Database > NoSQL; distance=0.7866; relevance=0.30

Final chunks:
  1. section=Database > NoSQL; distance=0.7533
  2. section=Cache > Application caching; distance=0.7875
  3. section=Database > SQL or NoSQL; distance=0.8039


## q03: How does master-slave database replication handle reads and writes?

**Expectation:** Answer should say that the master handles writes and replicas/slaves can serve reads, with replication lag or failover trade-offs mentioned if possible.

**Expected sections:** Availability patterns > Replication, Database > Relational database management system (RDBMS)

### Baseline

Cost: $0.000088 (46/214)
Rules: 9/10 (strong)
Judge: 3/3 — Полный и корректный ответ: описаны записи в мастер, чтения — между мастером и репликами/слейвами, упомянут лаг репликации, асинхронность и возможность полуручного подтверждения, рассмотрен failover и промоушен, а также влияние на консистентность чтения.

### rag-plain

Cost: $0.000198 (2266/211)
Rules: 9/11 (strong)
Judge: 2/3 — Частично верно: верно, что записи пишутся на мастере, реплики читают и возможна задержка репликации (lag) и переход/повышение слея (promote) при отказе. Но есть противоречие: в начале указано, что мастер обслуживает чтение, тогда как краткое резюме говорит, что чтения ведутся со слейвов. Также ответу не хватает явной структурированности по ожидаемым секциям и строгих формулировок.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Availability patterns > Replication; distance=0.6379
  2. section=Database > Relational database management system (RDBMS); distance=0.6390
  3. section=Database > Relational database management system (RDBMS); distance=0.6544

### rag-threshold

Cost: $0.000248 (2266/336)
Rules: 10/11 (strong)
Judge: 3/3 — Полный и корректный ответ: ясно объясняет, что мастер принимает записи, слейвы обслуживают чтение, упоминаются задержка репликации (lag) и проблемы переключения/промоутинга при сбое мастера, а также обоснованно обсуждаются trade-offs между читаемыми слейвами и латентностью.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 3 rejected
  - section=Availability patterns; distance=0.8615
  - section=Cache; distance=0.8737
  - section=Load balancer > Horizontal scaling; distance=0.8779

Final chunks:
  1. section=Availability patterns > Replication; distance=0.6379
  2. section=Database > Relational database management system (RDBMS); distance=0.6390
  3. section=Database > Relational database management system (RDBMS); distance=0.6544

### rag-reranker

Cost: $0.000222 (2432/252)
Rules: 10/11 (strong)
Judge: 1/3 — Частично верно, но с существенным недочетом: утверждается, что мастер обрабатывает чтения и записи, тогда как в типичной master-slave репликации мастер отвечает за записи, а чтение может выполняться и на репликах. Остальная часть ответа упоминает lag и failover, но из-за неправильной формулировки основа спорна.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 3 rejected
  - section=Availability patterns; distance=0.8615
  - section=Cache; distance=0.8737
  - section=Load balancer > Horizontal scaling; distance=0.8779

Reranker scores:
  - section=Availability patterns > Replication; distance=0.6379; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.6544; relevance=0.50
  - section=Index of system design topics; distance=0.7474; relevance=0.50
  - section=Cache > When to update the cache; distance=0.8151; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.8419; relevance=0.50

Final chunks:
  1. section=Availability patterns > Replication; distance=0.6379
  2. section=Database > Relational database management system (RDBMS); distance=0.6544
  3. section=Index of system design topics; distance=0.7474

### rag-full

Cost: $0.000198 (2432/190)
Rules: 9/11 (strong)
Judge: 2/3 — В целом верно: мастер принимает записи, слейвы обслуживают чтение, уместно упомянут failover через промоушен слейва. Но утверждение, что мастер обрабатывает чтения, неверно в стандартной мастер–слейв архитектуре и следует упомянуть задержку репликации (replication lag) как торговую оффсетную характеристику.

**Rewritten query:** What is the role of master-slave database replication in handling read and write operations?

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 3 rejected
  - section=Cache > Disadvantage(s): cache; distance=0.8564
  - section=Cache; distance=0.8601
  - section=Load balancer > Horizontal scaling; distance=0.8659

Reranker scores:
  - section=Availability patterns > Replication; distance=0.6260; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.6382; relevance=0.50
  - section=Index of system design topics; distance=0.7488; relevance=0.50
  - section=Cache > When to update the cache; distance=0.7981; relevance=0.50

Final chunks:
  1. section=Availability patterns > Replication; distance=0.6260
  2. section=Database > Relational database management system (RDBMS); distance=0.6382
  3. section=Index of system design topics; distance=0.7488


## q04: What is the CAP theorem and what are its three properties?

**Expectation:** Answer should define CAP theorem and name consistency, availability, and partition tolerance.

**Expected sections:** Principles > CAP theorem

### Baseline

Cost: $0.000068 (46/164)
Rules: 7/7 (strong)
Judge: 3/3 — Полное и корректное объяснение CAP-теоремы; приведены три свойства и их определения, текст соответствует ожиданию и секции Principles > CAP theorem.

### rag-plain

Cost: $0.000202 (2358/211)
Rules: 7/8 (good)
Judge: 3/3 — Полностью верно: дано определение CAP теоремы и перечислены три свойства с корректными объяснениями; упомянуты связь CAP/BASE и соответствующие термины; ответ соответствует ожидаемым секциям и терминам.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Database > NoSQL; distance=0.8701
  2. section=Asynchronism > Source(s) and further reading; distance=0.8748
  3. section=Availability patterns > Availability in numbers; distance=0.9070

### rag-threshold

Cost: $0.000100 (46/244)
Rules: 7/8 (good)
Judge: 2/3 — Ответ в целом верен: перечислены три свойства CAP и торговля двумя из трёх (CP, AP, CA) с корректными формулировками. Мелкие неточности в формулировке причин невозможности всех трёх свойств и отсутствие явной привязки к retrieval-данным (groundedness) снижают оценку.

**Retrieval:** no_hits (10 candidates → 0 final)

Threshold filtered: 10 rejected
  - section=Database > NoSQL; distance=0.8701
  - section=Asynchronism > Source(s) and further reading; distance=0.8748
  - section=Availability patterns > Availability in numbers; distance=0.9070
  - section=Reverse proxy (web server) > Disadvantage(s): reverse proxy; distance=0.9109
  - section=Reverse proxy (web server) > Source(s) and further reading; distance=0.9112
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.9186
  - section=Security; distance=0.9251
  - section=Cache > Disadvantage(s): cache; distance=0.9262
  - section=Index of system design topics; distance=0.9270
  - section=Communication > Hypertext transfer protocol (HTTP); distance=0.9272

### rag-reranker

Cost: $0.000097 (46/237)
Rules: 7/8 (good)
Judge: 2/3 — Ответ верно определяет CAP и его три свойства; однако неверно трактует CA как допустимую пару свойств в CAP-теореме. Обычно рассматривают CP и AP в условиях разрыва сети, а CA требует отсутствии разрыва, что делает её неактуальной в распределённых системах. Также есть мелкие стилистические неточности.

**Retrieval:** no_hits (10 candidates → 0 final)

Threshold filtered: 10 rejected
  - section=Database > NoSQL; distance=0.8701
  - section=Asynchronism > Source(s) and further reading; distance=0.8748
  - section=Availability patterns > Availability in numbers; distance=0.9070
  - section=Reverse proxy (web server) > Disadvantage(s): reverse proxy; distance=0.9109
  - section=Reverse proxy (web server) > Source(s) and further reading; distance=0.9112
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.9186
  - section=Security; distance=0.9251
  - section=Cache > Disadvantage(s): cache; distance=0.9262
  - section=Index of system design topics; distance=0.9270
  - section=Communication > Hypertext transfer protocol (HTTP); distance=0.9272

### rag-full

Cost: $0.000171 (2066/169)
Rules: 7/8 (good)
Judge: 3/3 — Полное и корректное объяснение CAP-теоремы и трёх свойств (consistency, availability, partition tolerance). Соответствует ожиданиям и retrieval-контексту.

**Rewritten query:** The CAP theorem states that in a distributed system, it's impossible to simultaneously provide all three of the following guarantees: Consistency, Availability, and Partition tolerance. It outlines the trade-offs between these properties.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 0 rejected

Reranker scores:
  - section=Availability vs consistency; distance=0.6755; relevance=0.50
  - section=Availability patterns; distance=0.8321; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.8326; relevance=0.50

Final chunks:
  1. section=Availability vs consistency; distance=0.6755
  2. section=Availability patterns; distance=0.8321
  3. section=Database > Relational database management system (RDBMS); distance=0.8326


## q05: How can I prevent cross-site scripting and cross-site request forgery attacks?

**Expectation:** Answer should distinguish XSS and CSRF and mention core mitigations such as sanitization/escaping for XSS and tokens/same-site protections for CSRF.

**Expected sections:** Security > Cross-site scripting (XSS), Security > Cross-site request forgery (CSRF)

### Baseline

Cost: $0.000274 (52/679)
Rules: 7/8 (strong)
Judge: 3/3 — Полностью корректный и полный ответ. Чётко разделены XSS и CSRF, приведены базовые и продвинутые mitigations: для XSS — санитизация/экранирование, контекстуальные энкодеры, CSP, заголовки безопасности, рекомендации по фреймворкам и JS‑коду; для CSRF — CSRF‑токены, SameSite cookies, двойной-submit, повторная аутентификация и/API‑соображения. Упомянуты сопутствующие практики (TLS, тестирование, обновления). Соответствует ожиданию и секциям.

### rag-plain

Cost: $0.000178 (1160/300)
Rules: 8/9 (good)
Judge: 3/3 — Полно и корректно: ясно разделены XSS и CSRF; перечислены основные mitigations: для XSS — санитизация/экранирование, валидация ввода, CSP; для CSRF — токены CSRF, SameSite куки, проверка Origin/Referer; упомянуты дополнительные меры (минимальные привилегии, параметризованные запросы) и предложение примеров под стек.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Domain name system > Disadvantage(s): DNS; distance=0.7545
  2. section=Cache > Web server caching; distance=0.7863
  3. section=Security; distance=0.7974

### rag-threshold

Cost: $0.000208 (1160/376)
Rules: 7/9 (good)
Judge: 3/3 — Полностью соответствует запросу: отдельно рассмотрены XSS и CSRF, перечислены основные меры (санитизация/экранирование, CSP, безопасное создание DOM, параметризованные запросы; CSRF‑токены, SameSite, проверка Origin/Referer, ограничение методов). Употреблены ожидаемые термины.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 3 rejected
  - section=Content delivery network > Pull CDNs; distance=0.8612
  - section=Communication > Hypertext transfer protocol (HTTP); distance=0.8632
  - section=Cache > Disadvantage(s): cache; distance=0.8681

Final chunks:
  1. section=Domain name system > Disadvantage(s): DNS; distance=0.7545
  2. section=Cache > Web server caching; distance=0.7863
  3. section=Security; distance=0.7974

### rag-reranker

Cost: $0.000187 (660/386)
Rules: 7/9 (good)
Judge: 3/3 — Полностью корректный и полный ответ, чётко разделяет XSS и CSRF, перечисляет основные mitigations: санитизация/экранирование и контекстно-зависимое экранирование против XSS; CSP, HttpOnly и Secure для cookies; для CSRF — токены и SameSite cookies, проверка происхождения, минимизация привилегий. Упоминаются дополнительные принципы и готовность привести примеры кода.

**Retrieval:** ok (10 candidates → 1 final)

Threshold filtered: 3 rejected
  - section=Content delivery network > Pull CDNs; distance=0.8612
  - section=Communication > Hypertext transfer protocol (HTTP); distance=0.8632
  - section=Cache > Disadvantage(s): cache; distance=0.8681

Reranker scores:
  - section=Security; distance=0.7974; relevance=0.50

Final chunks:
  1. section=Security; distance=0.7974

### rag-full

Cost: $0.000128 (660/237)
Rules: 8/9 (good)
Judge: 2/3 — Ответ в целом верен: разделяет XSS и CSRF и упоминает основные меры (санитизация/экранирование для XSS; токены и SameSite для CSRF). Но привязка к материалу слабая по CSRF (упомянуты как общепринятые практики) и встречаются спорные формулировки (например, 2FA для CSRF). Нет явного форматирования секций Security > Cross-site scripting (XSS) и Security > Cross-site request forgery (CSRF). Groundedness не идеален, но содержание соответствует ожиданию.

**Rewritten query:** What measures can be taken to mitigate XSS and CSRF vulnerabilities in web applications?

**Retrieval:** ok (10 candidates → 1 final)

Threshold filtered: 7 rejected
  - section=Reverse proxy (web server) > Load balancer vs reverse proxy; distance=0.8559
  - section=Cache > Web server caching; distance=0.8620
  - section=Application layer > Service Discovery; distance=0.8630
  - section=System design interview questions with solutions > Design a web crawler; distance=0.8686
  - section=Cache > Disadvantage(s): cache; distance=0.8719
  - section=Reverse proxy (web server) > Disadvantage(s): reverse proxy; distance=0.8802
  - section=Reverse proxy (web server) > Source(s) and further reading; distance=0.8832

Reranker scores:
  - section=Security; distance=0.7591; relevance=0.50

Final chunks:
  1. section=Security; distance=0.7591


## q06: What is the difference between REST and RPC APIs?

**Expectation:** Answer should compare REST as a resource-oriented style and RPC as an operation/procedure-oriented style.

**Expected sections:** Communication > REST, Communication > RPC

### Baseline

Cost: $0.000138 (42/340)
Rules: 6/7 (strong)
Judge: 3/3 — Полный и корректный ответ: чётко сравнивает REST как ресурс-ориентированный стиль и RPC как процедурно/операционно ориентированный, охватывает URL-дизайн, payload, семантику HTTP, состояние и кэширование, сценарии использования и примеры.

### rag-plain

Cost: $0.000203 (1642/302)
Rules: 7/8 (good)
Judge: 2/3 — Ответ корректно сравнивает REST как ресурс-ориентированный стиль и RPC как процедурно-ориентированный, даёт ясные примеры и упоминает характерные особенности. Однако он сознательно не опирается на предоставленные retrieval-материалы (groundedness низкая) и не структурирован в явные секции Communication > REST и Communication > RPC, как ожидалось.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Asynchronism > Source(s) and further reading; distance=0.8893
  2. section=Content delivery network > Disadvantage(s): CDN; distance=0.9002
  3. section=Database > NoSQL; distance=0.9182

### rag-threshold

Cost: $0.000168 (42/415)
Rules: 7/8 (good)
Judge: 3/3 — Полностью соответствует ожиданиям: четко сравнивает REST как ресурс-ориентированный стиль и RPC как операционно-ориентированный; охватывает ключевые различия (URI/HTTP, гипермедиа, контракт, ресурсы vs операции) и включает примеры REST и RPC.

**Retrieval:** no_hits (10 candidates → 0 final)

Threshold filtered: 10 rejected
  - section=Asynchronism > Source(s) and further reading; distance=0.8893
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.9002
  - section=Database > NoSQL; distance=0.9182
  - section=Cache > Disadvantage(s): cache; distance=0.9187
  - section=Content delivery network > Source(s) and further reading; distance=0.9209
  - section=Communication > Hypertext transfer protocol (HTTP); distance=0.9263
  - section=Communication > RPC and REST calls comparison; distance=0.9344
  - section=Latency vs throughput; distance=0.9358
  - section=Reverse proxy (web server) > Source(s) and further reading; distance=0.9479
  - section=Performance vs scalability; distance=0.9505

### rag-reranker

Cost: $0.000164 (42/405)
Rules: 7/8 (good)
Judge: 3/3 — Полный и корректный ответ: сравнение REST как ресурс-ориентированного стиля и RPC как процедурно-ориентированного, охвачены архитектура, работа с ресурсами, контракты, протоколы и примеры. Секции REST и RPC присутствуют, понятны ключевые различия.

**Retrieval:** no_hits (10 candidates → 0 final)

Threshold filtered: 10 rejected
  - section=Asynchronism > Source(s) and further reading; distance=0.8893
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.9002
  - section=Database > NoSQL; distance=0.9182
  - section=Cache > Disadvantage(s): cache; distance=0.9187
  - section=Content delivery network > Source(s) and further reading; distance=0.9209
  - section=Communication > Hypertext transfer protocol (HTTP); distance=0.9263
  - section=Communication > RPC and REST calls comparison; distance=0.9344
  - section=Latency vs throughput; distance=0.9358
  - section=Reverse proxy (web server) > Source(s) and further reading; distance=0.9479
  - section=Performance vs scalability; distance=0.9505

### rag-full

Cost: $0.000236 (1448/409)
Rules: 8/8 (strong)
Judge: 3/3 — Полностью охватывает отличие REST (resource-oriented) и RPC (procedure-oriented) с примерами и сравнениями; соответствует ожиданиям и retrieval-контексту, содержит необходимые термины и понятия.

**Rewritten query:** What are the key differences between RESTful and Remote Procedure Call (RPC) APIs in terms of their architecture, data transfer methods, and use cases?

**Retrieval:** ok (10 candidates → 1 final)

Threshold filtered: 4 rejected
  - section=Database > SQL or NoSQL; distance=0.8501
  - section=Cache > Disadvantage(s): cache; distance=0.8523
  - section=Communication > Representational state transfer (REST); distance=0.8623
  - section=Cache > CDN caching; distance=0.8648

Reranker scores:
  - section=Communication > RPC and REST calls comparison; distance=0.8348; relevance=0.50

Final chunks:
  1. section=Communication > RPC and REST calls comparison; distance=0.8348


## q07: What does eventual consistency mean in distributed systems?

**Expectation:** Answer should define eventual consistency as a weaker consistency model where replicas converge over time if no new updates arrive.

**Expected sections:** Principles > Consistency

### Baseline

Cost: $0.000044 (40/105)
Rules: 4/5 (strong)
Judge: 3/3 — Точное и полное определение: описывает слабую модель консистентности, когда реплики сходятся со временем при отсутствии новых обновлений; упоминаются устаревшие значения чтения, отсутствие глобального порядка и конфликт-резолюция. Соответствует ожиданиям и разделу Principles > Consistency.

### rag-plain

Cost: $0.000172 (1686/220)
Rules: 2/6 (good)
Judge: 2/3 — В целом верно: ответ определяет eventual consistency как слабую модель консистентности с асинхронной репликацией и со временем сходящимися репликами. Однако утверждение про то, что чтения «уводят к самой последней записанной версии» может быть неточным в случае конфликтов обновлений; лучше явно подчеркнуть, что реплики сходятся к согласованному состоянию после периода без новых обновлений. Ответу также соответствует контексту из материалов (CAP/AP) и зафиксирован grounding.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Availability vs consistency; distance=0.6731
  2. section=Consistency patterns; distance=0.7491
  3. section=Availability patterns; distance=0.8698

### rag-threshold

Cost: $0.000169 (1580/226)
Rules: 3/6 (good)
Judge: 3/3 — Полное и точное определение eventual consistency; описывает асинхронную репликацию, задержку чтения, сведения о схождении реплик во времени и условие «без новых обновлений»; соответствует ожиданию и retrieval-данным.

**Retrieval:** ok (10 candidates → 2 final)

Threshold filtered: 8 rejected
  - section=Availability patterns; distance=0.8698
  - section=Database > NoSQL; distance=0.8713
  - section=Performance vs scalability; distance=0.8963
  - section=Database > Relational database management system (RDBMS); distance=0.8984
  - section=Database > Relational database management system (RDBMS); distance=0.8988
  - section=Availability patterns > Availability in numbers; distance=0.9097
  - section=Cache; distance=0.9221
  - section=Load balancer > Disadvantage(s): load balancer; distance=0.9224

Final chunks:
  1. section=Availability vs consistency; distance=0.6731
  2. section=Consistency patterns; distance=0.7491

### rag-reranker

Cost: $0.000086 (752/120)
Rules: 2/6 (good)
Judge: 2/3 — В целом верно: определение eventual consistency, асинхронная репликация и сходимость копий со временем. Но не явно указано, что это слабая модель и что сход возникает при отсутствии новых обновлений.

**Retrieval:** ok (10 candidates → 1 final)

Threshold filtered: 8 rejected
  - section=Availability patterns; distance=0.8698
  - section=Database > NoSQL; distance=0.8713
  - section=Performance vs scalability; distance=0.8963
  - section=Database > Relational database management system (RDBMS); distance=0.8984
  - section=Database > Relational database management system (RDBMS); distance=0.8988
  - section=Availability patterns > Availability in numbers; distance=0.9097
  - section=Cache; distance=0.9221
  - section=Load balancer > Disadvantage(s): load balancer; distance=0.9224

Reranker scores:
  - section=Consistency patterns; distance=0.7491; relevance=0.50

Final chunks:
  1. section=Consistency patterns; distance=0.7491

### rag-full

Cost: $0.000175 (2658/104)
Rules: 4/6 (good)
Judge: 2/3 — Верно описана идея eventual consistency: реплики могут быть несинхронны, но со временем приходят к консистентному состоянию. Однако явно не указано условие «если новых обновлений не возникает» (речь о слабой модели), и формальная привязка к ожидаемым секциям не полностью отражена.

**Rewritten query:** Eventual consistency describes how data across a distributed system may not be immediately synchronized but will eventually reach a consistent state. It contrasts with strong consistency where all nodes must have the same data simultaneously.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 1 rejected
  - section=Database > Relational database management system (RDBMS); distance=0.8501

Reranker scores:
  - section=Consistency patterns; distance=0.5812; relevance=0.50
  - section=Database > NoSQL; distance=0.7648; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.8083; relevance=0.50
  - section=Availability patterns; distance=0.8139; relevance=0.50

Final chunks:
  1. section=Consistency patterns; distance=0.5812
  2. section=Database > NoSQL; distance=0.7648
  3. section=Database > Relational database management system (RDBMS); distance=0.8083


## q08: How can I horizontally scale a relational database using sharding and federation?

**Expectation:** Answer should explain both federation and sharding as ways to split data across multiple databases or partitions to scale horizontally.

**Expected sections:** Database > Federation, Database > Sharding

### Baseline

Cost: $0.000376 (50/935)
Rules: 6/6 (strong)
Judge: 3/3 — Полный и корректный ответ, охватывает обе техники: шардинг и федерацию, их цели, плюсы/минусы, сценарии применения и практические шаги внедрения. Упоминаются стратегии маршрутизации, транзакции, комбинации подходов и примеры технологий. Есть мелкие стилистические огрехи (地域/跨-шардинг), но содержание верно и полезно.

### rag-plain

Cost: $0.000350 (2488/563)
Rules: 5/7 (good)
Judge: 3/3 — Полный и корректный ответ: ясно объясняет обе техники (шардирование и федерацию) как способы горизонтального масштабирования RDBMS, перечисляет принципы, архитектурные подходы, плюсы/минусы и ограничения, относится к ожидаемым секциям и включает релевантные термины.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Load balancer > Horizontal scaling; distance=0.7075
  2. section=Database > Relational database management system (RDBMS); distance=0.7313
  3. section=Database > Relational database management system (RDBMS); distance=0.7337

### rag-threshold

Cost: $0.000398 (2488/685)
Rules: 5/7 (good)
Judge: 2/3 — Ответ в целом верен: объясняет шардирование и федерацию как способы горизонтального масштабирования, перечисляет плюсы/минусы, репликацию и балансировку, а также шаги к реализации. Присутствуют секции по шардированию и федерации и упоминаются релевантные термины. Однако есть неточность: утверждение, что шардирование 'уменьшает репликацию' спорно, поскольку репликация обычно нужна внутри шарда для отказоустойчивости. Также оформление не строго разделяет секции Database > Federation и Database > Sharding, хотя смысл понятен.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 5 rejected
  - section=Database > SQL or NoSQL; distance=0.8557
  - section=Cache; distance=0.8653
  - section=Asynchronism; distance=0.8687
  - section=System design interview questions with solutions > Design a system that scales to millions of users on AWS; distance=0.8696
  - section=How to approach a system design interview question > Step 4: Scale the design; distance=0.8724

Final chunks:
  1. section=Load balancer > Horizontal scaling; distance=0.7075
  2. section=Database > Relational database management system (RDBMS); distance=0.7313
  3. section=Database > Relational database management system (RDBMS); distance=0.7337

### rag-reranker

Cost: $0.000403 (2488/696)
Rules: 6/7 (good)
Judge: 3/3 — Полный и корректный ответ: ясно объясняет шардинг и федерацию, их цели, способы реализации и сложности, использует требуемые термины и соответствует ожидаемым секциям.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 5 rejected
  - section=Database > SQL or NoSQL; distance=0.8557
  - section=Cache; distance=0.8653
  - section=Asynchronism; distance=0.8687
  - section=System design interview questions with solutions > Design a system that scales to millions of users on AWS; distance=0.8696
  - section=How to approach a system design interview question > Step 4: Scale the design; distance=0.8724

Reranker scores:
  - section=Load balancer > Horizontal scaling; distance=0.7075; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.7313; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.7337; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.7530; relevance=0.50
  - section=Index of system design topics; distance=0.8311; relevance=0.50

Final chunks:
  1. section=Load balancer > Horizontal scaling; distance=0.7075
  2. section=Database > Relational database management system (RDBMS); distance=0.7313
  3. section=Database > Relational database management system (RDBMS); distance=0.7337

### rag-full

Cost: $0.000523 (2488/997)
Rules: 6/7 (good)
Judge: 3/3 — Полный и корректный ответ, охватывающий обе концепции (шардирование и федерацию) с объяснением преимуществ, ограничений, практических подходов к реализации и аспектов согласованности. Соответствует ожиданиям и имеет хорошую связку с ожиданием секций.

**Rewritten query:** To horizontally scale a relational database, what strategies can be employed for sharding and federation?

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 4 rejected
  - section=Database > SQL or NoSQL; distance=0.8532
  - section=Cache > Database caching; distance=0.8624
  - section=Database > NoSQL; distance=0.8630
  - section=Asynchronism; distance=0.8647

Reranker scores:
  - section=Database > Relational database management system (RDBMS); distance=0.7158; relevance=0.50
  - section=Load balancer > Horizontal scaling; distance=0.7249; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.7252; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.7496; relevance=0.50
  - section=Index of system design topics; distance=0.8151; relevance=0.50

Final chunks:
  1. section=Database > Relational database management system (RDBMS); distance=0.7158
  2. section=Load balancer > Horizontal scaling; distance=0.7249
  3. section=Database > Relational database management system (RDBMS); distance=0.7252


## q09: How does a Content Delivery Network reduce latency for static assets?

**Expectation:** Answer should explain that a CDN serves static content from edge locations closer to users instead of always hitting the origin.

**Expected sections:** Concepts > Content delivery network (CDN)

### Baseline

Cost: $0.000101 (46/247)
Rules: 6/7 (strong)
Judge: 3/3 — Полностью соответствующий ответ: объясняет, что CDN обслуживает статический контент из edge-локаций ближе к пользователю, снижает задержку за счёт географического кэширования, близости к пользователю, кэширования по типу контента и оптимизации маршрутов. Включены уместные термины (CDN, latency/задержка, edge/край, static assets) и связь с ожиданием.

### rag-plain

Cost: $0.000169 (954/304)
Rules: 5/8 (good)
Judge: 3/3 — Полное и корректное объяснение: CDN уменьшает задержку за счёт доставки статических активов c edge-локаций ближе к пользователю, объяснены pull/push модели и влияние TTL на кэширование и обновления контента. Соответствует ожиданию и секции Concepts > CDN, упоминаются ключевые термины: CDN, latency, edge, origin, static assets.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Content delivery network > Disadvantage(s): CDN; distance=0.8217
  2. section=Content delivery network > Pull CDNs; distance=0.8391
  3. section=Latency vs throughput; distance=0.8634

### rag-threshold

Cost: $0.000097 (694/157)
Rules: 7/8 (good)
Judge: 3/3 — Полный и корректный ответ. Чётко объясняет, что CDN снижает задержку, обслуживая статические артефакты с edge-локаций ближе к пользователю, вместо прямого обращения к origin. Упоминаются кеширование на edge, TTL и возможные недостатки (первый запрос, устаревание). Соответствует ожиданиям и Retrieval-материалам.

**Retrieval:** ok (10 candidates → 2 final)

Threshold filtered: 8 rejected
  - section=Latency vs throughput; distance=0.8634
  - section=Availability patterns > Fail-over; distance=0.8794
  - section=Load balancer > Disadvantage(s): load balancer; distance=0.8821
  - section=Availability patterns > Disadvantage(s): failover; distance=0.8877
  - section=Asynchronism > Disadvantage(s): asynchronism; distance=0.8938
  - section=Domain name system > Disadvantage(s): DNS; distance=0.8966
  - section=Cache > Application caching; distance=0.8968
  - section=Content delivery network > Push CDNs; distance=0.9035

Final chunks:
  1. section=Content delivery network > Disadvantage(s): CDN; distance=0.8217
  2. section=Content delivery network > Pull CDNs; distance=0.8391

### rag-reranker

Cost: $0.000121 (492/241)
Rules: 6/8 (good)
Judge: 3/3 — Полный и корректный ответ: ясно объясняет, как CDN обслуживает статический контент с edge-локаций ближе к пользователю, использует кеширование (TTL) и упоминает origin. Соответствует ожиданиям и retrieval-данным.

**Retrieval:** ok (10 candidates → 1 final)

Threshold filtered: 8 rejected
  - section=Latency vs throughput; distance=0.8634
  - section=Availability patterns > Fail-over; distance=0.8794
  - section=Load balancer > Disadvantage(s): load balancer; distance=0.8821
  - section=Availability patterns > Disadvantage(s): failover; distance=0.8877
  - section=Asynchronism > Disadvantage(s): asynchronism; distance=0.8938
  - section=Domain name system > Disadvantage(s): DNS; distance=0.8966
  - section=Cache > Application caching; distance=0.8968
  - section=Content delivery network > Push CDNs; distance=0.9035

Reranker scores:
  - section=Content delivery network > Pull CDNs; distance=0.8391; relevance=0.50

Final chunks:
  1. section=Content delivery network > Pull CDNs; distance=0.8391

### rag-full

Cost: $0.000121 (752/209)
Rules: 5/8 (good)
Judge: 3/3 — Полностью соответствует ожиданию: объясняет, что CDN снижает задержку за счёт отдачи статических файлов с edge-локаций ближе к пользователю, упоминает механизмы pull CDN и TTL кеширования и связь с origin.

**Rewritten query:** What is a Content Delivery Network and how can it minimize latency for static assets?

**Retrieval:** ok (10 candidates → 2 final)

Threshold filtered: 7 rejected
  - section=Availability patterns > Fail-over; distance=0.8560
  - section=Cache > Application caching; distance=0.8575
  - section=Load balancer > Disadvantage(s): load balancer; distance=0.8587
  - section=Asynchronism > Disadvantage(s): asynchronism; distance=0.8643
  - section=Cache > Disadvantage(s): cache; distance=0.8701
  - section=Content delivery network > Push CDNs; distance=0.8739
  - section=Domain name system > Disadvantage(s): DNS; distance=0.8754

Reranker scores:
  - section=Content delivery network > Pull CDNs; distance=0.8039; relevance=0.50
  - section=Latency vs throughput; distance=0.8157; relevance=0.50

Final chunks:
  1. section=Content delivery network > Pull CDNs; distance=0.8039
  2. section=Latency vs throughput; distance=0.8157


## q10: What is the latency of reading 1 MB sequentially from SSD versus memory?

**Expectation:** Answer should reference the latency table and compare SSD sequential read of 1 MB with memory access, making clear that SSD is much slower than RAM.

**Expected sections:** Appendix > Latency numbers every programmer should know

### Baseline

Cost: $0.000087 (54/210)
Rules: 9/9 (strong)
Judge: 2/3 — В целом верно: дано сравнение задержек RAM и SSD для 1 MB и приведены разумные диапазоны. Но ответ не ссылается на ожидаемую секцию Appendix > Latency numbers every programmer should know и не явно привязан к базовым данным (groundedness). Также формулировка про NVMe и разбивку 1 MB на IO может вводить в заблуждение без точной привязки к таблице задержек.

### rag-plain

Cost: $0.000141 (1508/164)
Rules: 9/10 (good)
Judge: 1/3 — Нет конкретных чисел latency 1MB чтения для SSD и RAM в указанных источниках; ответ не приводит сравнение и не опирается на Appendix > Latency numbers every programmer should know. Есть только замечание об отсутствии данных и предложение внешних оценок.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Latency vs throughput; distance=0.7313
  2. section=Cache > When to update the cache; distance=0.8118
  3. section=Availability patterns > Availability in numbers; distance=0.8377

### rag-threshold

Cost: $0.000196 (1508/302)
Rules: 9/10 (good)
Judge: 1/3 — Нет конкретных чисел для 1 МБ чтения последовательно с SSD и из памяти, не приведены данные из ожидаемой таблицы задержек (Appendix > Latency numbers every programmer should know). Ответ опирается на общие понятия и не привязан к источнику, что снижает groundedness.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 6 rejected
  - section=Appendix; distance=0.8635
  - section=Performance vs scalability; distance=0.8661
  - section=Cache > Application caching; distance=0.8702
  - section=Database > Relational database management system (RDBMS); distance=0.8812
  - section=Asynchronism > Disadvantage(s): asynchronism; distance=0.8924
  - section=Cache > When to update the cache; distance=0.8926

Final chunks:
  1. section=Latency vs throughput; distance=0.7313
  2. section=Cache > When to update the cache; distance=0.8118
  3. section=Availability patterns > Availability in numbers; distance=0.8377

### rag-reranker

Cost: $0.000142 (596/280)
Rules: 9/10 (good)
Judge: 1/3 — Не соответствует ожиданиям: не ссылается на ожидаемую секцию Appendix > Latency numbers every programmer should know, не дает конкретных чисел для 1 MB последовательного чтения, и привязан к общим оценкам вне материалов.

**Retrieval:** ok (10 candidates → 2 final)

Threshold filtered: 6 rejected
  - section=Appendix; distance=0.8635
  - section=Performance vs scalability; distance=0.8661
  - section=Cache > Application caching; distance=0.8702
  - section=Database > Relational database management system (RDBMS); distance=0.8812
  - section=Asynchronism > Disadvantage(s): asynchronism; distance=0.8924
  - section=Cache > When to update the cache; distance=0.8926

Reranker scores:
  - section=Latency vs throughput; distance=0.7313; relevance=0.50
  - section=Cache > When to update the cache; distance=0.8118; relevance=0.50

Final chunks:
  1. section=Latency vs throughput; distance=0.7313
  2. section=Cache > When to update the cache; distance=0.8118

### rag-full

Cost: $0.000106 (414/213)
Rules: 9/10 (good)
Judge: 1/3 — Не даёт цифры для 1 MB и не ссылается на требуемый раздел Appendix > Latency numbers every programmer should know; частично корректно даёт общие диапазоны задержек, но не выполнена задача сравнения по конкретной таблице и объёму.

**Rewritten query:** How does sequential read latency compare between an SSD and a RAM for accessing 1 MB of data?

**Retrieval:** ok (10 candidates → 1 final)

Threshold filtered: 6 rejected
  - section=Asynchronism > Source(s) and further reading; distance=0.8508
  - section=Appendix; distance=0.8588
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.8656
  - section=Content delivery network > Pull CDNs; distance=0.8680
  - section=Asynchronism > Disadvantage(s): asynchronism; distance=0.8741
  - section=Cache > When to update the cache; distance=0.8826

Reranker scores:
  - section=Latency vs throughput; distance=0.7114; relevance=0.50

Final chunks:
  1. section=Latency vs throughput; distance=0.7114



# Day 23 — RAG reranking & filtering comparison report

Generated at: 2026-04-16T07:48:31.807Z
Strategy: **structural**

## Mode comparison summary

| Mode | Avg judge | Avg cost | Wins vs baseline |
|------|-----------|----------|------------------|
| baseline | 2.80/3 | $0.000153 | — |
| rag-plain | 2.50/3 | $0.000225 | 1/10 |
| rag-threshold | 2.70/3 | $0.000196 | 1/10 |
| rag-reranker | 2.70/3 | $0.000178 | 0/10 |
| rag-full | 2.60/3 | $0.000182 | 1/10 |

## Per-question summary

| # | Question | baseline judge | rag-plain judge | rag-threshold judge | rag-reranker judge | rag-full judge |
|---|----------|---|---|---|---|---|
| q01 | What is the difference between cache-aside and write-through caching strategies? | 3/3 | 2/3 | 2/3 | 3/3 | 3/3 |
| q02 | When should I use a NoSQL database instead of a SQL database? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| q03 | How does master-slave database replication handle reads and writes? | 2/3 | 3/3 | 3/3 | 2/3 | 3/3 |
| q04 | What is the CAP theorem and what are its three properties? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| q05 | How can I prevent cross-site scripting and cross-site request forgery attacks? | 3/3 | 2/3 | 3/3 | 3/3 | 3/3 |
| q06 | What is the difference between REST and RPC APIs? | 3/3 | 2/3 | 3/3 | 3/3 | 3/3 |
| q07 | What does eventual consistency mean in distributed systems? | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 |
| q08 | How can I horizontally scale a relational database using sharding and federation? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| q09 | How does a Content Delivery Network reduce latency for static assets? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| q10 | What is the latency of reading 1 MB sequentially from SSD versus memory? | 2/3 | 1/3 | 1/3 | 1/3 | 0/3 |

## q01: What is the difference between cache-aside and write-through caching strategies?

**Expectation:** Answer should explain that cache-aside loads data lazily on cache miss, while write-through updates cache and backing store synchronously on write. A good answer should mention trade-offs such as stale reads, simplicity, or write latency.

**Expected sections:** Cache > When to update the cache

### Baseline

Cost: $0.000124 (50/303)
Rules: 5/7 (strong)
Judge: 3/3 — Полный и корректный ответ: чётко объясняет cache-aside как ленивая загрузка на пропускe и write-through как синхронное обновление кэша и источника; упоминаются trade-offs (согласованность, нагрузка на источник, простота реализации).

### rag-plain

Cost: $0.000262 (2322/365)
Rules: 8/8 (strong)
Judge: 2/3 — В целом верно: объясняет lazy loading (cache-aside) и write-through, указывает на основные торговые предложения и латентности. Однако есть неточность по утверждению, что данные в кэше не устаревают в write-through, и не полностью раскрыты детали обновления/инвалидации кэша при записях в cache-aside.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Cache > When to update the cache; distance=0.7314
  2. section=Cache > CDN caching; distance=0.7539
  3. section=Cache > When to update the cache; distance=0.7564

### rag-threshold

Cost: $0.000235 (2322/298)
Rules: 8/8 (strong)
Judge: 2/3 — Ключевые различия описаны: cache-aside — ленивый загруз на промах, write-through — синхронная запись в кэш и БД; упомянуты trade-offs. Однако не хватает явного обсуждения задержки записи для write-through и деталей поведения обновления кэша при записи, а формулировка про записи в кэш в cache-aside может быть неполной.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 2 rejected
  - section=Content delivery network > Pull CDNs; distance=0.8661
  - section=Cache > Web server caching; distance=0.8716

Final chunks:
  1. section=Cache > When to update the cache; distance=0.7314
  2. section=Cache > CDN caching; distance=0.7539
  3. section=Cache > When to update the cache; distance=0.7564

### rag-reranker

Cost: $0.000299 (2706/409)
Rules: 8/8 (strong)
Judge: 3/3 — Полный и точный ответ: объясняет cache-aside как ленивое (lazy) загрузку данных по промаху и write-through как синхронное обновление кэша и БД на запись, упоминает trade-offs (устаревание данных, задержка записи, простоту использования) и соответствует секции Cache > When to update the cache.

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

Cost: $0.000285 (2706/373)
Rules: 8/8 (strong)
Judge: 3/3 — Полный и корректный ответ. Чётко объясняет различия: cache-aside — ленивый загрузчик, данные читаются из кеша, промах приводит к загрузке из БД и заполнению кеша; запись идёт напрямую в БД. Write-through — кеш как основное место записи, данные синхронно пишутся в БД. Упомянуты trade-offs: устарелость (решается TTL/синхронизацией) для cache-aside и задержки записи/масштабирование для write-through, плюс преимущества и сценарии использования. Соответствует секции и ключевым терминам.

**Rewritten query:** What are the differences between cache-aside and write-through caching techniques?

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 3 rejected
  - section=Cache > Database caching; distance=0.8629
  - section=Content delivery network > Pull CDNs; distance=0.8833
  - section=Cache > Web server caching; distance=0.8856

Reranker scores:
  - section=Cache > When to update the cache; distance=0.7370; relevance=0.50
  - section=Cache > When to update the cache; distance=0.7779; relevance=0.50
  - section=Cache > Application caching; distance=0.7849; relevance=0.50
  - section=Cache > When to update the cache; distance=0.8232; relevance=0.50

Final chunks:
  1. section=Cache > When to update the cache; distance=0.7370
  2. section=Cache > When to update the cache; distance=0.7779
  3. section=Cache > Application caching; distance=0.7849


## q02: When should I use a NoSQL database instead of a SQL database?

**Expectation:** Answer should contrast SQL and NoSQL at a high level and mention that NoSQL can be a better fit for non-tabular data, large scale, flexible schema, or specific data models such as key-value/document/wide-column/graph.

**Expected sections:** Database > NoSQL, Database > SQL or NoSQL

### Baseline

Cost: $0.000085 (50/205)
Rules: 5/8 (strong)
Judge: 3/3 — Полный и корректный ответ: дано высокоуровневое сравнение SQL и NoSQL, перечислены сценарии для выбора NoSQL (гибкая схема, масштабируемость, высокий throughput, неструктурированные данные, распределение) и для SQL (ACID, сложные запросы, нормализованные схемы). Упоминания соответствуют необходимым терминам (NoSQL, SQL) и ожидаемым контекстам.

### rag-plain

Cost: $0.000245 (1874/378)
Rules: 9/9 (strong)
Judge: 3/3 — Полностью соответствующий ответ: даёт высокоуровневое сравнение SQL и NoSQL, упоминает случаи, когда NoSQL может быть лучше (крупномасштабируемость, гибкая схема, нестандартные модели данных: ключ-значение, документы, широкие колонки, графы), перечисляет типы NoSQL и связанные с консистентностью принципы (BASE vs ACID). Соответствие терминам соблюдено, ответ привязан к ожидаемым секциям (Database > NoSQL).

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Database > NoSQL; distance=0.7990
  2. section=Database > NoSQL; distance=0.8024
  3. section=Cache > Database caching; distance=0.8102

### rag-threshold

Cost: $0.000204 (1874/275)
Rules: 9/9 (strong)
Judge: 3/3 — Полный и корректный ответ. Упрощённо сравниваются SQL и NoSQL на высоком уровне, явно отмечаются нетабличные/полуструктурированные данные, масштабируемость и гибкость схем, а также модели NoSQL (ключ-значение, документ, wide-column, граф). Также обсуждаются случаи с ACID vs BASE/ eventual consistency и сценарии кэширования. Соответствует ожидаемым секциям (Database > NoSQL, Database > SQL or NoSQL) и использует термины NoSQL/реляционный SQL.

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

Cost: $0.000220 (2216/273)
Rules: 9/9 (strong)
Judge: 3/3 — Полный и корректный ответ: ясно сравнивает SQL и NoSQL на высоком уровне, перечисляет случаи, когда NoSQL предпочтителен (масштабирование, гибкая схема, неструктурированные/полуструктурированные данные, разные модели хранения: key-value, документ, wide-column, graph), упоминает отсутствие необходимости в ACID и сложных соединениях, охватывает секции Database > NoSQL и Database > SQL or NoSQL. Все обязательные термины присутствуют.

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 4 rejected
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.8527
  - section=Database > Relational database management system (RDBMS); distance=0.8665
  - section=Index of system design topics; distance=0.8685
  - section=Communication > Remote procedure call (RPC); distance=0.8745

Reranker scores:
  - section=Database > NoSQL; distance=0.7990; relevance=0.50
  - section=Cache > Application caching; distance=0.8172; relevance=0.50
  - section=Database > SQL or NoSQL; distance=0.8272; relevance=0.50
  - section=Database > NoSQL; distance=0.8024; relevance=0.30

Final chunks:
  1. section=Database > NoSQL; distance=0.7990
  2. section=Cache > Application caching; distance=0.8172
  3. section=Database > SQL or NoSQL; distance=0.8272

### rag-full

Cost: $0.000244 (2218/332)
Rules: 8/9 (strong)
Judge: 3/3 — Полностью соответствует ожиданию: ясно объясняет, когда использовать NoSQL по сравнению с SQL на высоком уровне, упоминает неструктурированные данные, гибкую схему, масштаб и конкретные модели (key-value/document/wide-column/graph); соответствует секциям Database > NoSQL и Database > SQL or NoSQL и использует необходимые термины.

**Rewritten query:** When to choose a NoSQL database over a SQL database?

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 4 rejected
  - section=Communication > RPC and REST calls comparison; distance=0.8547
  - section=Database > Relational database management system (RDBMS); distance=0.8698
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.8701
  - section=Database > NoSQL; distance=0.8883

Reranker scores:
  - section=Database > NoSQL; distance=0.7926; relevance=0.50
  - section=Database > SQL or NoSQL; distance=0.8187; relevance=0.50
  - section=Cache > Application caching; distance=0.8391; relevance=0.50
  - section=Database > NoSQL; distance=0.8204; relevance=0.30

Final chunks:
  1. section=Database > NoSQL; distance=0.7926
  2. section=Database > SQL or NoSQL; distance=0.8187
  3. section=Cache > Application caching; distance=0.8391


## q03: How does master-slave database replication handle reads and writes?

**Expectation:** Answer should say that the master handles writes and replicas/slaves can serve reads, with replication lag or failover trade-offs mentioned if possible.

**Expected sections:** Availability patterns > Replication, Database > Relational database management system (RDBMS)

### Baseline

Cost: $0.000118 (46/288)
Rules: 9/10 (strong)
Judge: 2/3 — Вопрос решён в целом верно: мастер принимает записи, реплики/слейвы обслуживают чтения; упомянут лаг репликации и возможность синхронной репликации как вариант. Но не раскрыты явные trade-offs по failover/promote и даны не все детали по консистентности и доступности. По ожиданиям секций и терминов ответ близок к ним, но недостаёт части о переключении/фейловере.

### rag-plain

Cost: $0.000240 (2266/318)
Rules: 10/11 (strong)
Judge: 3/3 — Полный и корректный ответ: описывает, что мастер обрабатывает записи и чтение, реплики обслуживают чтение; упоминаются репликационный лаг и переключение/промоушен при падении мастера; соответствует ожидаемым секциям и терминам.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Availability patterns > Replication; distance=0.6379
  2. section=Database > Relational database management system (RDBMS); distance=0.6390
  3. section=Database > Relational database management system (RDBMS); distance=0.6544

### rag-threshold

Cost: $0.000224 (2266/278)
Rules: 9/11 (strong)
Judge: 3/3 — Полный и корректный ответ: описано, что мастер обрабатывает записи, реплики/слейвы обслуживают чтение; упомянуты лаг репликации и варианты failover/promotion, а также общие ограничения. Грундинг присутствует (соответствие секциям Availability patterns > Replication и Database > Relational database management system (RDBMS)).

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

Cost: $0.000215 (2432/234)
Rules: 9/11 (strong)
Judge: 2/3 — Корректно объясняет, что записи делают мастер, чтение — на репликах, есть возможность масштабирования чтения и переключение на новый мастер (promote). Однако упоминание задержки репликации (replication lag) отсутствует, что снижает groundedness.

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

Cost: $0.000203 (2432/203)
Rules: 9/11 (strong)
Judge: 3/3 — Полный и корректный ответ: объясняет, что мастер обрабатывает записи, реплики читают данные, упоминается лаг репликации и сценарии failover/promote, соответствует ожидаемым секциям и терминам.

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

Cost: $0.000086 (46/208)
Rules: 5/7 (partial)
Judge: 3/3 — Полное и корректное определение CAP и трех свойств: согласованность (consistency), доступность (availability) и устойчивость к разрывам сети (partition tolerance). Также упомянут компромисс и формулировку 'две из трёх', что соответствует базовой трактовке теоремы.

### rag-plain

Cost: $0.000184 (2358/165)
Rules: 6/8 (good)
Judge: 3/3 — Полное и корректное объяснение CAP‑теоремы и трёх свойств: определение CAP, перечисление и ясные формулировки для Consistency, Availability, Partition tolerance; соответствует ожидаемым секциям и терминам.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Database > NoSQL; distance=0.8701
  2. section=Asynchronism > Source(s) and further reading; distance=0.8748
  3. section=Availability patterns > Availability in numbers; distance=0.9070

### rag-threshold

Cost: $0.000074 (46/179)
Rules: 7/8 (good)
Judge: 3/3 — Полный и корректный ответ: дано определение CAP и перечислены три свойства (consistency, availability, partition tolerance) на понятном языке, с соответствующими терминами. Соответствует ожидаемым секциям и базовым понятиям.

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

Cost: $0.000076 (46/183)
Rules: 6/8 (good)
Judge: 3/3 — Полное и корректное определение CAP и трёх свойств; названы consistency, availability, partition tolerance, приведены сочетания (CA, CP, AP) и пояснения к каждому."

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

Cost: $0.000062 (46/149)
Rules: 7/8 (good)
Judge: 3/3 — Полный и корректный ответ: чётко определён CAP-подход и перечислены три свойства (Consistency, Availability, Partition tolerance) с ясными определениями; упомянуты возможные пары (CA, CP, AP).

**Rewritten query:** What is CAP theorem and what are its three properties?

**Retrieval:** no_hits (10 candidates → 0 final)

Threshold filtered: 10 rejected
  - section=Asynchronism > Source(s) and further reading; distance=0.8959
  - section=Database > NoSQL; distance=0.8965
  - section=Availability patterns > Availability in numbers; distance=0.9243
  - section=Reverse proxy (web server) > Disadvantage(s): reverse proxy; distance=0.9266
  - section=Reverse proxy (web server) > Source(s) and further reading; distance=0.9333
  - section=Communication > Hypertext transfer protocol (HTTP); distance=0.9394
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.9406
  - section=Cache > Disadvantage(s): cache; distance=0.9431
  - section=Index of system design topics; distance=0.9431
  - section=Appendix > Powers of two table; distance=0.9450


## q05: How can I prevent cross-site scripting and cross-site request forgery attacks?

**Expectation:** Answer should distinguish XSS and CSRF and mention core mitigations such as sanitization/escaping for XSS and tokens/same-site protections for CSRF.

**Expected sections:** Security > Cross-site scripting (XSS), Security > Cross-site request forgery (CSRF)

### Baseline

Cost: $0.000306 (52/758)
Rules: 7/8 (strong)
Judge: 3/3 — Полный и корректный ответ, чётко разделяет XSS и CSRF и перечисляет основные mitigations: escaping/sanitization и безопасная рендеринг/CSP/SRI/secure cookies для XSS; CSRF-токены, double-submit cookies, SameSite, Referer/Origin, аудит. Также даны практические шаги по внедрению. Есть небольшие нюансы формулировок (например, рекомендация GET для state-changing операций), но в целом текст соответствует ожиданиям.

### rag-plain

Cost: $0.000178 (1160/299)
Rules: 7/9 (good)
Judge: 2/3 — В целом верно: разделение XSS и CSRF, упоминание санитизации/экранирования для XSS и токенов + SameSite для CSRF. Однако groundedness к источнику слабая (нет явных деталей из Retrieval) и отсутствуют более конкретные паттерны/практические примеры.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Domain name system > Disadvantage(s): DNS; distance=0.7545
  2. section=Cache > Web server caching; distance=0.7863
  3. section=Security; distance=0.7974

### rag-threshold

Cost: $0.000212 (1160/384)
Rules: 7/9 (good)
Judge: 3/3 — Полностью корректный и понятный ответ. Разделены XSS и CSRF, приведены ключевые mitigations: для XSS — санитация/экранирование, CSP, выходная кодировка и ограничение источников; для CSRF — CSRF-токены, повторная аутентификация для важных действий, SameSite cookies и проверки Referer/Origin. Соответствует ожидаемым секциям и основным терминам.

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

Cost: $0.000182 (660/372)
Rules: 7/9 (good)
Judge: 3/3 — Ответ полно охватывает XSS и CSRF, включает основные mitigations (санитизация/escaping/CSP для XSS; токены CSRF и SameSite для CSRF) и помнит о принципах безопасности; секции соответствуют ожиданиям, вывод согласован с retrieval.

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

Cost: $0.000161 (660/320)
Rules: 8/9 (good)
Judge: 3/3 — Полный и корректный ответ: ясно разделяет XSS и CSRF, перечисляет базовые mitigations (санитизация/экранирование, CSP, безопасное обращение с DOM для XSS; токены CSRF и SameSite для CSRF), включает общие принципы и термины. Небольшая опечатка (XSFR) не влияет на суть.

**Rewritten query:** To protect against cross-site scripting and cross-site request forgery attacks, implement input validation and sanitization on all user inputs. Use secure coding practices to avoid vulnerabilities in server-side code. Additionally, ensure that your application uses HTTPS for data transmission to encrypt sensitive information. Regularly update and patch your software to address known vulnerabilities.

**Retrieval:** ok (10 candidates → 1 final)

Threshold filtered: 1 rejected
  - section=Cache > Application caching; distance=0.8527

Reranker scores:
  - section=Security; distance=0.7104; relevance=0.50

Final chunks:
  1. section=Security; distance=0.7104


## q06: What is the difference between REST and RPC APIs?

**Expectation:** Answer should compare REST as a resource-oriented style and RPC as an operation/procedure-oriented style.

**Expected sections:** Communication > REST, Communication > RPC

### Baseline

Cost: $0.000129 (42/318)
Rules: 7/7 (strong)
Judge: 3/3 — Ответ полностью соответствует ожиданиям: ясно сравнивает REST как ресурс-ориентированный стиль и RPC как процедурно-ориентированный, включает различия в подходе, структуре URL, использовании HTTP и гибкости, а также примеры REST и RPC. Приведены необходимые термины (REST, resource, RPC, procedure, operation) и ожидаемые секции.

### rag-plain

Cost: $0.000279 (1642/493)
Rules: 7/8 (good)
Judge: 2/3 — В целом верно и полно сравнение REST и RPC: REST — про ресурсы и HTTP-операции, RPC — про вызовы функций/методов, затрагиваются контракты, кэширование и стиль взаимодействия. Но ответ не явно структурирован по ожидаемым секциям Communication > REST и Communication > RPC и не явно опирается на retrieval-данные.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Asynchronism > Source(s) and further reading; distance=0.8893
  2. section=Content delivery network > Disadvantage(s): CDN; distance=0.9002
  3. section=Database > NoSQL; distance=0.9182

### rag-threshold

Cost: $0.000133 (42/327)
Rules: 7/8 (good)
Judge: 3/3 — Полный и точный ответ: REST — ресурс-ориентированный стиль с использованием HTTP-методов и URL-ресурсов; RPC — процедурно-ориентированный стиль с контрактами/протоколами (например, gRPC); охвачены различия в подходе, структуре URL, стандартах и кэшировании/HATEOAS.

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

Cost: $0.000130 (42/319)
Rules: 7/8 (good)
Judge: 3/3 — Полный и корректный ответ: ясно сравнивает REST как ресурс-ориентированный стиль поверх HTTP и RPC как вызов удалённых процедур/методов, охватывает привязку к ресурсам (URL и HTTP-методы), форматы сообщений, использование HTTP-статусов, эволюцию/совместимость и приводит примеры. Соответствует ожидаемым секциям.

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

Cost: $0.000144 (42/356)
Rules: 7/8 (good)
Judge: 3/3 — Полностью корректно и полно: REST описан как стиль, ориентированный на ресурсы и представления, RPC — как вызов процедур; охватываются ключевые различия (ресурсы vs процедуры, HTTP против произвольного протокола, кэширование, контракт/интерфейс); соответствуют ожидаемым секциям Communication > REST и Communication > RPC; использованы требуемые термины.

**Rewritten query:** REST vs RPC: What are the key differences between RESTful and Remote Procedure Call-based APIs?

**Retrieval:** no_hits (10 candidates → 0 final)

Threshold filtered: 9 rejected
  - section=Asynchronism > Source(s) and further reading; distance=0.8663
  - section=Latency vs throughput; distance=0.8719
  - section=Communication > RPC and REST calls comparison; distance=0.8720
  - section=Database > NoSQL; distance=0.8810
  - section=Performance vs scalability; distance=0.8904
  - section=Database > SQL or NoSQL; distance=0.8920
  - section=Content delivery network > Source(s) and further reading; distance=0.8944
  - section=Cache > Disadvantage(s): cache; distance=0.8947
  - section=Application layer > Disadvantage(s): application layer; distance=0.9067

Reranker scores:


## q07: What does eventual consistency mean in distributed systems?

**Expectation:** Answer should define eventual consistency as a weaker consistency model where replicas converge over time if no new updates arrive.

**Expected sections:** Principles > Consistency

### Baseline

Cost: $0.000054 (40/129)
Rules: 4/5 (strong)
Judge: 3/3 — Полное и корректное определение eventual consistency: описывает слабую модель, где данные могут временно расходиться между узлами, копии сходятся со временем при отсутствии новых обновлений; упомянуты устаревшие чтения и причины (асинхронная репликация, конфликт‑управление).

### rag-plain

Cost: $0.000136 (1686/130)
Rules: 3/6 (good)
Judge: 3/3 — Полное и корректное определение: описывает слабую модель консистентности, при которой реплики сходятся со временем при отсутствии новых обновлений; упоминает асинхронную репликацию, возможную устарелость чтения во время репликации и сохранение доступности. Г groundedness: ответ основан на базовой концепции eventual consistency; retrieval-данные присутствуют, но ответ не критично опирается на них и формулировка подходит к ожидаемому объяснению.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Availability vs consistency; distance=0.6731
  2. section=Consistency patterns; distance=0.7491
  3. section=Availability patterns; distance=0.8698

### rag-threshold

Cost: $0.000127 (1580/119)
Rules: 4/6 (good)
Judge: 3/3 — Определение верно и полно: описано, что eventual consistency — слабая модель, при которой реплики сходятся со временем; чтения могут видеть устаревшие данные; обновления реплицируются асинхронно. Упомянут CAP-упор на доступность/разделение и соответствующие концепции.

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

Cost: $0.000097 (752/148)
Rules: 2/6 (good)
Judge: 3/3 — Полное и корректное определение eventual consistency: описано как слабая модель, при которой реплики асинхронно реплицируются и чтения со временем становятся актуальными, упомянуты trade-offs в виде высокой доступности и отказоустойчивости, а также временная рассинхронность между копиями; соответствует ожидаемой секции Principles > Consistency и терминам.

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

Cost: $0.000114 (752/190)
Rules: 5/6 (good)
Judge: 2/3 — В целом верно: определение близко к ожиданию, указывает на асинхронную репликацию и конечное согласование копий. Но не явно формулирует условие 'если новых обновлений не приходит', и утверждение о конвергенции в пределах миллисекунд не всегда точно, что снижает groundedness.

**Rewritten query:** What is eventual consistency in distributed systems?

**Retrieval:** ok (10 candidates → 1 final)

Threshold filtered: 8 rejected
  - section=Availability patterns; distance=0.8666
  - section=Database > NoSQL; distance=0.8863
  - section=Database > Relational database management system (RDBMS); distance=0.9006
  - section=Database > Relational database management system (RDBMS); distance=0.9046
  - section=Performance vs scalability; distance=0.9050
  - section=Asynchronism > Disadvantage(s): asynchronism; distance=0.9055
  - section=Index of system design topics; distance=0.9133
  - section=Cache; distance=0.9147

Reranker scores:
  - section=Consistency patterns; distance=0.7585; relevance=0.50

Final chunks:
  1. section=Consistency patterns; distance=0.7585


## q08: How can I horizontally scale a relational database using sharding and federation?

**Expectation:** Answer should explain both federation and sharding as ways to split data across multiple databases or partitions to scale horizontally.

**Expected sections:** Database > Federation, Database > Sharding

### Baseline

Cost: $0.000475 (50/1181)
Rules: 5/6 (strong)
Judge: 3/3 — Полный и корректный ответ, охватывающий шардинг и федерацию как способы горизонтального масштабирования РСУБД, объясняет архитектуры, trade-offs, применения, практические шаги и примеры технологий.

### rag-plain

Cost: $0.000418 (2488/735)
Rules: 6/7 (good)
Judge: 3/3 — Полный и корректный обзор: объясняет sharding и federation, их роли в горизонтальном масштабировании РСУБД, архитектурные варианты (мастер-слейв, мастер-мастер), маршрутизацию и межшард-агрегацию; учитывает плюсы и сложности и согласуется с ожидаемыми секциями и Retrieval.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Load balancer > Horizontal scaling; distance=0.7075
  2. section=Database > Relational database management system (RDBMS); distance=0.7313
  3. section=Database > Relational database management system (RDBMS); distance=0.7337

### rag-threshold

Cost: $0.000476 (2488/879)
Rules: 6/7 (good)
Judge: 3/3 — Полный и корректный ответ. Ясно объясняет оба подхода (federation и sharding), их цели, архитектуру, плюсы/минусы, сложности кросс-шардовых операций и практические рекомендации. Соответствует ожидаемым секциям и терминам.

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

Cost: $0.000379 (2488/636)
Rules: 6/7 (good)
Judge: 3/3 — Полный и корректный ответ. Четко объясняет шардинг и федерацию как способы горизонтального масштабирования, перечисляет плюсы/минусы, практические шаги и архитектурные аспекты. Соответствует ожидаемым секциям Database > Federation и Database > Sharding; термины shard/sharding и federation упомянуты. Grounded на retrieval-данных.

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

Cost: $0.000394 (2488/674)
Rules: 5/7 (good)
Judge: 3/3 — Полностью охватывает обе концепции: federation и sharding, объясняет горизонтальное масштабирование реляционной БД, выделяет преимущества и ограничения, даёт рекомендации по реализации и примеры архитектуры. Соответствует ожидаемым секциям (Database > Federation и Database > Sharding) и содержит необходимые термины.

**Rewritten query:** What are the methods to horizontally scale a relational database by implementing sharding and federation techniques?

**Retrieval:** ok (10 candidates → 3 final)

Threshold filtered: 5 rejected
  - section=Asynchronism; distance=0.8558
  - section=Cache; distance=0.8677
  - section=How to approach a system design interview question > Step 4: Scale the design; distance=0.8692
  - section=Database > SQL or NoSQL; distance=0.8728
  - section=System design interview questions with solutions > Design a system that scales to millions of users on AWS; distance=0.8767

Reranker scores:
  - section=Load balancer > Horizontal scaling; distance=0.7180; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.7217; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.7680; relevance=0.50
  - section=Database > Relational database management system (RDBMS); distance=0.7710; relevance=0.50
  - section=Index of system design topics; distance=0.8268; relevance=0.50

Final chunks:
  1. section=Load balancer > Horizontal scaling; distance=0.7180
  2. section=Database > Relational database management system (RDBMS); distance=0.7217
  3. section=Database > Relational database management system (RDBMS); distance=0.7680


## q09: How does a Content Delivery Network reduce latency for static assets?

**Expectation:** Answer should explain that a CDN serves static content from edge locations closer to users instead of always hitting the origin.

**Expected sections:** Concepts > Content delivery network (CDN)

### Baseline

Cost: $0.000062 (46/150)
Rules: 7/7 (strong)
Judge: 3/3 — Полностью соответствует ожиданиям. Объясняет, что CDN обслуживает статический контент с edge-локаций ближе к пользователю и снижает задержку за счёт кеширования на границе, умной маршрутизации, протокольных оптимизаций и уменьшения нагрузки на origin.

### rag-plain

Cost: $0.000170 (954/306)
Rules: 6/8 (good)
Judge: 3/3 — Полный и корректный ответ: объясняет, как CDN уменьшает задержку за счет edge-локаций ближе к пользователю, охватывает механизмы push/pull и кеширование TTL, упоминает первую загрузку как задержку и влияние на latency для статических ресурсов. Соответствует ожиданию и retrieval-контексту.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Content delivery network > Disadvantage(s): CDN; distance=0.8217
  2. section=Content delivery network > Pull CDNs; distance=0.8391
  3. section=Latency vs throughput; distance=0.8634

### rag-threshold

Cost: $0.000123 (694/221)
Rules: 7/8 (good)
Judge: 3/3 — Полный и корректный ответ. Чётко объясняет, что CDN снижает задержку за счёт размещения копий ближе к пользователю (edge) и кэширования на узлах CDN, избегая обращения к origin. Упоминаются edge, origin и static assets; соответствует ожидаемой секции Concepts > CDN; grounded на retrieval (Pull CDNs, TTL).

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

Cost: $0.000058 (492/83)
Rules: 7/8 (good)
Judge: 3/3 — Полностью соответствует ожиданию: объясняет концепцию CDN как обслуживающего статические файлы с edge-локаций ближе к пользователю, что снижает задержку за счёт кэширования и обращения к origin только при первом запросе (pull CDN); упоминаются TTL и локальное хранение на краях сети.

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

Cost: $0.000134 (752/240)
Rules: 5/8 (good)
Judge: 3/3 — Полный и корректный ответ: объясняет, что CDN снижает задержку за счёт размещения копий статических файлов ближе к пользователю (edge) и кеширования; упоминаются pull CDN и TTL, что покрывает механизмы обновления кеша. Соответствует ожиданию и базовым секциям.

**Rewritten query:** What is the role of a Content Delivery Network in minimizing latency for static assets?

**Retrieval:** ok (10 candidates → 2 final)

Threshold filtered: 6 rejected
  - section=Asynchronism > Disadvantage(s): asynchronism; distance=0.8585
  - section=Availability patterns > Fail-over; distance=0.8611
  - section=Availability patterns > Disadvantage(s): failover; distance=0.8675
  - section=Cache > Application caching; distance=0.8728
  - section=Communication > Representational state transfer (REST); distance=0.8785
  - section=Cache > Disadvantage(s): cache; distance=0.8805

Reranker scores:
  - section=Latency vs throughput; distance=0.8079; relevance=0.50
  - section=Content delivery network > Pull CDNs; distance=0.8282; relevance=0.50

Final chunks:
  1. section=Latency vs throughput; distance=0.8079
  2. section=Content delivery network > Pull CDNs; distance=0.8282


## q10: What is the latency of reading 1 MB sequentially from SSD versus memory?

**Expectation:** Answer should reference the latency table and compare SSD sequential read of 1 MB with memory access, making clear that SSD is much slower than RAM.

**Expected sections:** Appendix > Latency numbers every programmer should know

### Baseline

Cost: $0.000091 (54/221)
Rules: 9/9 (strong)
Judge: 2/3 — В целом верно: latency SSD ~0.3–1 ms для 1 MB, DRAM ~50–100 ns; память существенно быстрее. Но не упомянут ожидаемый раздел Appendix/LAT таблицу и есть ошибка в фразе про пропускную способность: память имеет намного больший bandwidth, чем SSD; текст не явно ссылался на конкретную таблицу.

### rag-plain

Cost: $0.000137 (1508/153)
Rules: 9/10 (good)
Judge: 1/3 — Не приведены конкретные числа из раздела Appendix > Latency numbers every programmer should know и не сделано сравнение 1 MB SSD vs RAM; ответ говорит об отсутствии данных, хотя Retrieval содержит релевантные секции. Можно дать ориентировочные значения, но в текущем виде ответ неполон.

**Retrieval:** ok (3 candidates → 3 final)

Final chunks:
  1. section=Latency vs throughput; distance=0.7313
  2. section=Cache > When to update the cache; distance=0.8118
  3. section=Availability patterns > Availability in numbers; distance=0.8377

### rag-threshold

Cost: $0.000152 (1508/192)
Rules: 7/10 (good)
Judge: 1/3 — Не приводит конкретных чисел латентности чтения 1 MB с SSD и памяти и не ссылается на ожидаемую секцию Appendix > Latency numbers every programmer should know, хотя в retrieval-данных есть соответствующие материалы. В итоге ответ частично верен (о отсутствии конкретной цифры), но не удовлетворяет запросу на сравнение и привязку к таблице латентности.

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

Cost: $0.000125 (596/239)
Rules: 8/10 (good)
Judge: 1/3 — Ответ не приводит числовые значения из таблицы задержек Appendix и не сравнивает явно 1 МБ чтение на SSD и RAM. Заявляет об отсутствии цифр в источниках и даёт лишь общие ориентиры, не привязанные к конкретным разделам источников. Не выполняет требование по grounding и явному соотношению к retrieved материалам.

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

Cost: $0.000081 (596/127)
Rules: 7/10 (good)
Judge: 0/3 — Ответ не предоставляет чисел задержки для чтения 1 МБ последовательно с SSD и памятью, не ссылается на указанный раздел Appendix > Latency numbers every programmer should know и не содержит явного сравнения. Признание отсутствия данных не удовлетворяет требованию к grounded ответу.

**Rewritten query:** How does the sequential read latency compare between an SSD and RAM for accessing 1 MB of data?

**Retrieval:** ok (10 candidates → 2 final)

Threshold filtered: 6 rejected
  - section=Performance vs scalability; distance=0.8547
  - section=Appendix; distance=0.8654
  - section=Content delivery network > Disadvantage(s): CDN; distance=0.8657
  - section=Content delivery network > Pull CDNs; distance=0.8677
  - section=Cache > When to update the cache; distance=0.8832
  - section=Asynchronism > Disadvantage(s): asynchronism; distance=0.8862

Reranker scores:
  - section=Latency vs throughput; distance=0.7295; relevance=0.50
  - section=Cache > When to update the cache; distance=0.8205; relevance=0.50

Final chunks:
  1. section=Latency vs throughput; distance=0.7295
  2. section=Cache > When to update the cache; distance=0.8205



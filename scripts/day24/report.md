# Day 24 — Citations, sources & anti-hallucination evaluation report

Generated at: 2026-04-16T18:52:14.452Z

## Summary

| Metric | Value |
|--------|-------|
| In-scope questions | 10 |
| Out-of-scope questions | 3 |
| Sources present | 9/10 |
| Quotes present | 9/10 |
| Avg judge score | 2.00/3 |
| Avg faithfulness | 2.44/3 |
| Out-of-scope correctly refused | 3/3 |

## Per-question summary

| # | Question | Sources | Quotes | Confidence | Judge | Faithfulness |
|---|----------|---------|--------|------------|-------|--------------|
| q01 | What is the difference between cache-aside and wri… | ✓ | ✓ | high | 3/3 | 2/3 |
| q02 | When should I use a NoSQL database instead of a SQ… | ✓ | ✓ | low | 2/3 | 2/3 |
| q03 | How does master-slave database replication handle … | ✓ | ✓ | high | 1/3 | 3/3 |
| q04 | What is the CAP theorem and what are its three pro… | ✓ | ✓ | high | 2/3 | 3/3 |
| q05 | How can I prevent cross-site scripting and cross-s… | ✓ | ✓ | low | 1/3 | 1/3 |
| q06 | What is the difference between REST and RPC APIs? | ✓ | ✓ | high | 3/3 | 2/3 |
| q07 | What does eventual consistency mean in distributed… | ✓ | ✓ | high | 3/3 | 3/3 |
| q08 | How can I horizontally scale a relational database… | ✓ | ✓ | high | 2/3 | 3/3 |
| q09 | How does a Content Delivery Network reduce latency… | ✓ | ✓ | high | 3/3 | 3/3 |
| q10 | What is the latency of reading 1 MB sequentially f… | ✗ | ✗ | insufficient | 0/3 | — |
| q11_oos | Как приготовить борщ? | ✗ | ✗ | insufficient | — | — |
| q12_oos | Какова столица Мадагаскара? | ✗ | ✗ | insufficient | — | — |
| q13_oos | Расскажи про квантовые вычисления и кубиты | ✗ | ✗ | insufficient | — | — |

## q01: What is the difference between cache-aside and write-through caching strategies?

**Expectation:** Answer should explain that cache-aside loads data lazily on cache miss, while write-through updates cache and backing store synchronously on write. A good answer should mention trade-offs such as stale reads, simplicity, or write latency.

**Retrieval:** ok (10→3)
**Rewritten query:** What are the differences between cache-aside and write-through caching strategies in system design?

**Confidence:** high
**Sources:** 3 | **Quotes:** 3
**Rules:** 7/8 (strong)
**Judge:** 3/3 �� Полностью верный и качественный ответ: объясняет различия между cache-aside (ленивая подгрузка по miss, кэширование на уровне приложения) и write-through (запись в кэш и БД синхронно). Упоминаются ключевые trade-offs: возможность устаревших данных в cache-aside без TTL, простота реализации и задержка записи/latency у write-through, а также наглядно охвачено обновление кэша (при miss для cache-aside; при записи для write-through).
**Faithfulness:** 2/3 — Основные утверждения (описания cache-aside и write-through) подтверждаются цитатами; есть мелкие расхождения: упоминание TTL/устаревания кэша для cache-aside и явной синхронности записи в write-through не полностью зафиксированы цитатами.

**Answer:**

Cache-aside and write-through are two cache strategies described in the materials. Cache-aside: the application is responsible for reading from storage and writing to cache; on a cache miss it loads from the database, then adds to cache and returns. This is lazy loading and data can become stale unless TTL or write-through is used. It is slower on misses because each miss causes loading from DB. Write-through: the application uses the cache as the main data store, writing data to cache and to the underlying data store synchronously, so subsequent reads of recently written data are fast, and data in cache is not stale.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Cache > When to update the cache
- [2] scripts/day21/data/system-design-primer.md > Cache > When to update the cache
- [3] scripts/day21/data/system-design-primer.md > Application caching

**Quotes:**
- [2] "The application is responsible for reading and writing from storage.  The cache does not interact with storage directly.  The application does the following:

* Look for entry in cache, resulting in a cache miss
* Load entry from the database
* Add entry to cache
* Return entry"
- [2] "#### Write-through

<p align="center">
  <img src="images/0vBc0hN.png">
  <br/>
  <i><a href=http://www.slideshare.net/jboner/scalability-availability-stability-patterns/>Source: Scalability, availability, stability, patterns</a></i>
</p>

The application uses the cache as the main data store, reading and writing data to it, while"
- [1] "Write-through is a slow overall operation due to the write operation, but subsequent reads of just written data are fast.  Users are generally more tolerant of latency when updating data than reading data.  Data in the cache is not stale."

## q02: When should I use a NoSQL database instead of a SQL database?

**Expectation:** Answer should contrast SQL and NoSQL at a high level and mention that NoSQL can be a better fit for non-tabular data, large scale, flexible schema, or specific data models such as key-value/document/wide-column/graph.

**Retrieval:** ok (10→3)
**Rewritten query:** What are the key considerations for choosing between a NoSQL and a SQL database in system design?

**Confidence:** low
**Sources:** 2 | **Quotes:** 4
**Rules:** 5/9 (strong)
**Judge:** 2/3 �� В целом верно: отмечены гибкая схема, обработка неструктурированных/больших объемов данных, отсутствие необходимости сложных join и транзакций, а также высокая пропускная способность. Но ответ неполон: не явлен явный контраст SQL vs NoSQL на высоком уровне, не перечислены конкретные модели данных (ключ-знач, документ, ширококолонный, граф), и нет упоминания характерных компромиссов (ACID vs BASE). Также не оформлен в ожидаемые секции Database > NoSQL / Database > SQL or NoSQL.
**Faithfulness:** 2/3 — Утверждения про гибкую схему, денормализацию, отсутствие необходимости сложных джойнов, большие объёмы данных и высокую пропускную способность подтверждаются цитатами; упоминание отсутствия транзакций не подтверждается цитатами.

**Answer:**

Используйте NoSQL вместо SQL, когда требуется гибкая схема и возможность обработки неструктурированных или очень больших объемов данных без необходимости сложных joins и транзакций. Также NoSQL подходит для очень высокой пропускной способности ввода-вывода и хранения больших объемов данных (много тБ/пБ), а данные часто денормализованы и объединения выполняются на стороне приложения.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Database > NoSQL
- [2] scripts/day21/data/system-design-primer.md > Database > SQL or NoSQL

**Quotes:**
- [1] "Reasons for NoSQL: * Semi-structured data * Dynamic or flexible schema * Non-relational data * No need for complex joins * Store many TB (or PB) of data * Very data intensive workload * Very high throughput for IOPS"
- [1] "NoSQL is a collection of data items represented in a key-value store, document store, wide column store, or a graph database.  Data is denormalized, and joins are generally done in the application code."
- [2] "Reasons for SQL: * Structured data * Strict schema * Relational data * Need for complex joins * Transactions"
- [2] "Reasons for NoSQL: * Semi-structured data * Dynamic or flexible schema * Non-relational data * No need for complex joins * Store many TB (or PB) of data"

## q03: How does master-slave database replication handle reads and writes?

**Expectation:** Answer should say that the master handles writes and replicas/slaves can serve reads, with replication lag or failover trade-offs mentioned if possible.

**Retrieval:** ok (10→3)
**Rewritten query:** What mechanisms do master-slave databases use to manage read and write operations?

**Confidence:** high
**Sources:** 2 | **Quotes:** 2
**Rules:** 10/11 (strong)
**Judge:** 1/3 �� Ключевая идея частично верна: мастер отвечает за записи, реплики обслуживают чтение. Но утверждение 'один мастер для чтения и записи' неверно в типичной мастер-слейв архитектуре; упоминание задержки репликации отсутствует, а торговые преимущества/failover и явные детали задержки не освещены.
**Faithfulness:** 3/3 — Все утверждения полностью подтверждаются данными цитатами.

**Answer:**

Master-slave replication uses a single master for both reads and writes, while one or more slaves replicate the master's writes and serve only reads. Slaves can also form a tree and replicate to further slaves. If the master goes offline, the system can operate in read-only mode until a slave is promoted or a new master is provisioned.

**Sources used:**
- [2] scripts/day21/data/system-design-primer.md > Relational database management system (RDBMS)
- [1] scripts/day21/data/system-design-primer.md > Availability patterns > Replication

**Quotes:**
- [2] "The master serves reads and writes, replicating writes to one or more slaves, which serve only reads.  Slaves can also replicate to additional slaves in a tree-like fashion.  If the master goes offline, the system can continue to operate in read-only mode until a slave is promoted to a master or a new master is provisioned."
- [1] "Master-slave replication"

## q04: What is the CAP theorem and what are its three properties?

**Expectation:** Answer should define CAP theorem and name consistency, availability, and partition tolerance.

**Retrieval:** ok (10→3)
**Rewritten query:** What is the CAP theorem in distributed systems, and what are its three fundamental properties: consistency, availability, and partition tolerance?

**Confidence:** high
**Sources:** 1 | **Quotes:** 2
**Rules:** 3/8 (partial)
**Judge:** 2/3 �� Верно сформулировано определение CAP и названы три свойства: консистентность, доступность и устойчивость к разрыву (partition tolerance). Однако ответ неполный: не объяснено, какие две из трёх свойств можно обеспечить одновременно (AP/CP/CA), не приведён конкретный trade-off, и отсутствует явная привязка к ожидаемой секции и исходным retrieval-данным.
**Faithfulness:** 3/3 — Ответ полностью соответствует цитатам: упоминает три гарантии CAP и утверждает, что можно поддерживать только две из них; цитаты прямо описывают этот trade-off.

**Answer:**

CAP theorem описывает выбор между тремя гарантиями в распределенной системе: консистентность, доступность и устойчивость к разделению сети. Указано, что можно поддерживать только две из трех возможностей:

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Availability vs consistency

**Quotes:**
- [1] "In a distributed computer system, you can only support two of the following guarantees: 

* Consistency - Every read receives the most recent write or an error
* Availability - Every request receives a response, without guarantee that it contains the most recent version of the information
* Partition Tolerance - The system continues to operate despite arbitrary partitioning due to network failures"
- [1] "Networks aren't reliable, so you'll need to support partition tolerance.  You'll need to make a software tradeoff between consistency and availability."

## q05: How can I prevent cross-site scripting and cross-site request forgery attacks?

**Expectation:** Answer should distinguish XSS and CSRF and mention core mitigations such as sanitization/escaping for XSS and tokens/same-site protections for CSRF.

**Retrieval:** ok (10→1)
**Rewritten query:** To protect against cross-site scripting (XSS) and cross-site request forgery (CSRF), implement input validation and sanitization, use secure cookies, and ensure that all user inputs are properly escaped. Additionally, consider using HTTPS to encrypt data in transit.

**Confidence:** low
**Sources:** 1 | **Quotes:** 4
**Rules:** 4/9 (good)
**Judge:** 1/3 �� Ответ частично верен: упоминает Sanitizатию как защиту от XSS, но не разделяет XSS и CSRF, не приводит меры для CSRF (тайкены CSRF, SameSite), и не содержит ожидаемых секций Security > XSS/CSRF; недостает ключевых деталей и точной привязки к базе.
**Faithfulness:** 1/3 — Часть утверждений подтверждается цитатами: шифрование, очистка входных данных, параметризованные запросы и принцип наименьших привилегий подтверждены. Однако утверждение о предотвращении CSRF не поддержано цитатами.

**Answer:**

Чтобы предотвратить XSS и CSRF, следуйте базовым мерам безопасности: шифруйте данные в транзите и на хранении; очищайте все входные данные или параметры, доступные пользователю, чтобы предотвратить XSS; используйте параметризованные запросы для предотвращения SQL-инъекций; применяйте принцип наименьших привилегий. Эти принципы упомянуты как базовые меры безопасности в источнике.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Security

**Quotes:**
- [1] "Sanitize all user inputs or any input parameters exposed to user to prevent [XSS](https://en.wikipedia.org/wiki/Cross-site_scripting) and [SQL injection](https://en.wikipedia.org/wiki/SQL_injection)."
- [1] "Encrypt in transit and at rest."
- [1] "Use parameterized queries to prevent SQL injection."
- [1] "Use the principle of [least privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege)."

## q06: What is the difference between REST and RPC APIs?

**Expectation:** Answer should compare REST as a resource-oriented style and RPC as an operation/procedure-oriented style.

**Retrieval:** ok (10→1)
**Rewritten query:** What are the key differences between RESTful and Remote Procedure Call (RPC) APIs in terms of their architectural styles, data transfer formats, and use cases?

**Confidence:** high
**Sources:** 1 | **Quotes:** 4
**Rules:** 8/8 (strong)
**Judge:** 3/3 �� Ответ верно сравнивает REST как ресурс-ориентированный стиль и RPC как процедуро-ориентированный. Приведены примеры REST-эндпойнтов и RPC-подходов, упомянуты ресурсы и стандартные HTTP-операции для REST и процедуроподобные вызовы для RPC. Соответствует ожидаемой структуре (Communication > REST, Communication > RPC) и использованию ключевых терминов.
**Faithfulness:** 2/3 — Часть утверждений подтверждается: примеры RPC-путей (например, /signup, /readPerson, /readUsersItemsList, /addItemToUsersItemsList) и REST-пути (/persons, /persons/1234, /persons/1234/items) соответствуют цитатам. Но упоминание /modifyItem не фигурирует в цитатах, и детали по PUT/DELETE не поддержаны цитатами.

**Answer:**

REST and RPC have different endpoint and operation styles as shown in the comparison table. RPC lists specific procedure-like calls (e.g., POST /signup, GET /readPerson?personid=1234, POST /modifyItem) and uses RPC-centric actions, whereas REST focuses on resources and standard HTTP verbs (e.g., POST /persons, GET /persons/1234, GET /persons/1234/items, POST /persons/1234/items, PUT /items/456, DELETE /items/456).

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Communication > RPC and REST calls comparison

**Quotes:**
- [1] "Signup    | **POST** /signup | **POST** /persons"
- [1] "Read a person | **GET** /readPerson?personid=1234 | **GET** /persons/1234"
- [1] "Read a person’s items list | **GET** /readUsersItemsList?personid=1234 | **GET** /persons/1234/items"
- [1] "Add an item to a person’s items | **POST** /addItemToUsersItemsList<br/>{<br/>"personid": "1234";<br/>"itemid": "456"<br/>} | **POST** /persons/1234/items<br/>{<br/>"itemid": "456"<br/>}"

## q07: What does eventual consistency mean in distributed systems?

**Expectation:** Answer should define eventual consistency as a weaker consistency model where replicas converge over time if no new updates arrive.

**Retrieval:** ok (10→3)
**Rewritten query:** Eventual consistency refers to a system where eventually all nodes will have the same data, but not necessarily at the same time. It is a trade-off between consistency and availability in distributed systems.

**Confidence:** high
**Sources:** 2 | **Quotes:** 2
**Rules:** 2/6 (good)
**Judge:** 3/3 �� Полное и корректное определение eventual consistency: это слабая модель согласованности, при которой реплики сходятся со временем, если не поступают новые обновления; после записи чтения рано или поздно увидит запись. Упоминаются асинхронная репликация и итоговая консистентность, что соответствует ожиданиям и секции Principles > Consistency.
**Faithfulness:** 3/3 — Все утверждения в ответе полностью подтверждаются цитатами.

**Answer:**

Eventual consistency means: after a write, reads will eventually see it, data is replicated asynchronously, and the system becomes consistent over time.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Consistency patterns
- [2] scripts/day21/data/system-design-primer.md > Database > NoSQL

**Quotes:**
- [1] "### Eventual consistency

After a write, reads will eventually see it (typically within milliseconds).  Data is replicated asynchronously."
- [2] "### NoSQL

NoSQL is a collection of data items represented in a **key-value store**, **document store**, **wide column store**, or a **graph database**.  Data is denormalized, and joins are generally done in the application code.  Most NoSQL stores lack true ACID transactions and favor [eventual consistency](#eventual-consistency)."

## q08: How can I horizontally scale a relational database using sharding and federation?

**Expectation:** Answer should explain both federation and sharding as ways to split data across multiple databases or partitions to scale horizontally.

**Retrieval:** ok (10→3)
**Rewritten query:** To horizontally scale a relational database using sharding and federation, how can I distribute data across multiple servers to improve performance and availability?

**Confidence:** high
**Sources:** 2 | **Quotes:** 4
**Rules:** 5/7 (good)
**Judge:** 2/3 �� Ответ в целом верен и охватывает sharding и federation, упоминает плюсы и сложности и сохраняет концептуальную связность. Однако отсутствуют более детальные примеры реализации, стратегии выбора shard key и режимов консистентности, а также явная структурная привязка к секциям Database > Federation и Database > Sharding.
**Faithfulness:** 3/3 — Все утверждения совпадают с цитатами: шардинг и федерация работают без единого мастера, поддерживают параллельную запись и рост пропускной способности, при этом требуют иной логики приложения и добавляют сложность.

**Answer:**

Для горизонтального масштабирования реляционной БД с использованием шардирования и федерации опирайтесь на принципы, описанные в материалах:
- Шардирование распределяет данные по нескольким базам данных, каждая из которых управляет подмножеством данных, что уменьшает нагрузку и увеличивает пропускную способность при параллельной записи/чтению. Также меньше повторной записи и лучше кеширование, при этом при падении одного шарда остальные работают, но стоит обеспечить репликацию для защиты от потери данных. 
- Федерация позволяет читать/писать через несколько баз данных без единого центрального мастера, но требует обновления логики приложения для определения, в каком узле читать/писать, и сложнее выполнять соединения между базами. 
- В обоих подходах отсутствует единый центральный мастер, что позволяет параллельную запись и повышение пропускной способности, но влечет дополнительную сложность и требования к разработке.

Подкрепляющие цитаты приведены ниже.

**Sources used:**
- [2] scripts/day21/data/system-design-primer.md > Database > Relational database management system (RDBMS)
- [1] scripts/day21/data/system-design-primer.md > Load balancer > Horizontal scaling

**Quotes:**
- [2] "Sharding distributes data across different databases such that each database can only manage a subset of the data.  Taking a users database as an example, as the number of users increases, more shards are added to the cluster."
- [2] "Similar to the advantages of [federation](#federation), sharding results in less read and write traffic, less replication, and more cache hits.  Index size is also reduced, which generally improves performance with faster queries.  If one shard goes down, the other shards are still operational, although you'll want to add some form of replication to avoid data loss.  Like federation, there is no single central master serializing writes, allowing you to write in parallel with increased throughput."
- [2] "Federation is not effective if your schema requires huge functions or tables.
You'll need to update your application logic to determine which database to read and write.
Joining data from two databases is more complex with a server link."
- [1] "Federation adds more hardware and additional complexity."

## q09: How does a Content Delivery Network reduce latency for static assets?

**Expectation:** Answer should explain that a CDN serves static content from edge locations closer to users instead of always hitting the origin.

**Retrieval:** ok (10→3)
**Rewritten query:** What is a content delivery network and how can it minimize the time it takes to load static assets on websites?

**Confidence:** high
**Sources:** 3 | **Quotes:** 2
**Rules:** 4/8 (good)
**Judge:** 3/3 �� Полностью соответствует ожиданию: объясняет, что CDN обслуживает контент (включая статические assets) из edge-локаций ближе к пользователю, снижая необходимость обращения к origin и тем самым уменьшая задержку.
**Faithfulness:** 3/3 — Все утверждения в ответе полностью подтверждаются цитатами.

**Answer:**

CDN reduces latency by serving content from locations closer to the user and by offloading requests from your own servers to the CDN, which means users receive content from data centers near them and your servers do not have to serve those requests.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Content delivery network
- [2] scripts/day21/data/system-design-primer.md > Content delivery network > Pull CDNs
- [3] scripts/day21/data/system-design-primer.md > Content delivery network > Push CDNs

**Quotes:**
- [1] "A content delivery network (CDN) is a globally distributed network of proxy servers, serving content from locations closer to the user.  Generally, static files such as HTML/CSS/JS, photos, and videos are served from CDN, although some CDNs such as Amazon's CloudFront support dynamic content.  The site's DNS resolution will tell clients which server to contact."
- [1] "Serving content from CDNs can significantly improve performance in two ways:

* Users receive content from data centers close to them
* Your servers do not have to serve requests that the CDN fulfills"

## q10: What is the latency of reading 1 MB sequentially from SSD versus memory?

**Expectation:** Answer should reference the latency table and compare SSD sequential read of 1 MB with memory access, making clear that SSD is much slower than RAM.

**Retrieval:** ok (10→1)
**Rewritten query:** What is the read latency for sequential access of 1 MB data between an SSD and RAM?

**Confidence:** insufficient
**Sources:** 0 | **Quotes:** 0
**Rules:** 7/10 (good)
**Judge:** 0/3 �� Ответ не приводит запрошённых чисел и не сравнивает задержку между SSD и RAM, не ссылается на Appendix > Latency numbers every programmer should know. Хотя retrieval указывает на релевантный раздел, ответ игнорирует его и сообщает об отсутствии информации.

**Answer:**

К сожалению, в доступной базе знаний нет конкретной информации о задержке чтения 1 МБ последовательно с SSD и из памяти.

## q11_oos: Как приготовить борщ?

**Type:** out-of-scope
**Retrieval:** insufficient_context (10 candidates)
**Correctly refused:** ✓ yes
**Confidence:** insufficient

**Answer:** К сожалению, в доступной базе знаний нет информации для ответа на этот вопрос. Попробуйте переформулировать запрос или уточнить тему.

## q12_oos: Какова столица Мадагаскара?

**Type:** out-of-scope
**Retrieval:** insufficient_context (10 candidates)
**Correctly refused:** ✓ yes
**Confidence:** insufficient

**Answer:** К сожалению, в доступной базе знаний нет информации для ответа на этот вопрос. Попробуйте переформулировать запрос или уточнить тему.

## q13_oos: Расскажи про квантовые вычисления и кубиты

**Type:** out-of-scope
**Retrieval:** insufficient_context (10 candidates)
**Correctly refused:** ✓ yes
**Confidence:** insufficient

**Answer:** К сожалению, в доступной базе знаний нет информации для ответа на этот вопрос. Попробуйте переформулировать запрос или уточнить тему.


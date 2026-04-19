# Day 24 — Citations, sources & anti-hallucination evaluation report

Generated at: 2026-04-16T19:02:55.383Z

## Summary

| Metric | Value |
|--------|-------|
| In-scope questions | 10 |
| Out-of-scope questions | 3 |
| Sources present | 9/10 |
| Quotes present | 9/10 |
| Avg judge score | 1.80/3 |
| Avg faithfulness | 2.89/3 |
| Out-of-scope correctly refused | 3/3 |

## Per-question summary

| # | Question | Sources | Quotes | Confidence | Judge | Faithfulness |
|---|----------|---------|--------|------------|-------|--------------|
| q01 | What is the difference between cache-aside and wri… | ✓ | ✓ | high | 3/3 | 2/3 |
| q02 | When should I use a NoSQL database instead of a SQ… | ✓ | ✓ | high | 2/3 | 3/3 |
| q03 | How does master-slave database replication handle … | ✓ | ✓ | high | 1/3 | 3/3 |
| q04 | What is the CAP theorem and what are its three pro… | ✓ | ✓ | high | 3/3 | 3/3 |
| q05 | How can I prevent cross-site scripting and cross-s… | ✓ | ✓ | low | 1/3 | 3/3 |
| q06 | What is the difference between REST and RPC APIs? | ✓ | ✓ | high | 2/3 | 3/3 |
| q07 | What does eventual consistency mean in distributed… | ✓ | ✓ | high | 2/3 | 3/3 |
| q08 | How can I horizontally scale a relational database… | ✓ | ✓ | high | 1/3 | 3/3 |
| q09 | How does a Content Delivery Network reduce latency… | ✓ | ✓ | high | 3/3 | 3/3 |
| q10 | What is the latency of reading 1 MB sequentially f… | ✗ | ✗ | insufficient | 0/3 | — |
| q11_oos | Как приготовить борщ? | ✗ | ✗ | insufficient | — | — |
| q12_oos | Какова столица Мадагаскара? | ✗ | ✗ | insufficient | — | — |
| q13_oos | Расскажи про квантовые вычисления и кубиты | ✗ | ✗ | insufficient | — | — |

## q01: What is the difference between cache-aside and write-through caching strategies?

**Expectation:** Answer should explain that cache-aside loads data lazily on cache miss, while write-through updates cache and backing store synchronously on write. A good answer should mention trade-offs such as stale reads, simplicity, or write latency.

**Retrieval:** ok (10→3)
**Rewritten query:** What are the differences between cache-aside and write-through caching mechanisms?

**Confidence:** high
**Sources:** 3 | **Quotes:** 2
**Rules:** 6/8 (strong)
**Judge:** 3/3 — Полное и корректное объяснение различий: cache-aside загружает данные лениво при пропуске в кэш и обновляет кэш после обращения к хранилищу; write-through обновляет кэш и основное хранилище синхронно на запись. Упомянуты trade-offs (задержка на запись, задержка при пропусках, неустаревание данных). Соответствует секции Cache > When to update the cache и требуемым терминам.
**Faithfulness:** 2/3 — Ответ в основном подтверждается цитатами: описание cache-aside соответствует цитате [2], описание write-through согласуется с цитате [1]. Проблема: утверждение о трех обращениях при пропуске кэша не подтверждается данными цитатами.

**Answer:**

Cache-aside is when the application is responsible for loading data from storage into the cache on a cache miss and caching it for future reads, while write-through uses the cache as the primary data store where reads and writes go through the cache with synchronous writes to the underlying data store. Evidence: Cache-aside description: "The application is responsible for reading and writing from storage. The cache does not interact with storage directly. The application does the following: Look for entry in cache... Load entry from the database... Add entry to cache... Return entry" and Write-through description: "The application uses the cache as the main data store, reading and writing data to it". Additional notes: For cache-aside, cache miss causes three trips (read from cache, then from DB, then back to cache). This is part of its disadvantages. For write-through, writes are synchronous to the data store, making writes slower but reads of recently written data fast, and data in cache is not stale."

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Cache > When to update the cache
- [2] scripts/day21/data/system-design-primer.md > Cache > When to update the cache
- [3] scripts/day21/data/system-design-primer.md > Cache > Application caching

**Quotes:**
- [1] "Write-through is a slow overall operation due to the write operation, but subsequent reads of just written data are fast.  Users are generally more tolerant of latency when updating data than reading data.  Data in the cache is not stale."
- [2] "The application is responsible for reading and writing from storage.  The cache does not interact with storage directly.  The application does the following:

* Look for entry in cache, resulting in a cache miss
* Load entry from the database
* Add entry to cache
* Return entry"

## q02: When should I use a NoSQL database instead of a SQL database?

**Expectation:** Answer should contrast SQL and NoSQL at a high level and mention that NoSQL can be a better fit for non-tabular data, large scale, flexible schema, or specific data models such as key-value/document/wide-column/graph.

**Retrieval:** ok (10→3)
**Rewritten query:** What are the key differences between NoSQL and SQL databases, and when is it advisable to choose one over the other?

**Confidence:** high
**Sources:** 2 | **Quotes:** 2
**Rules:** 5/9 (strong)
**Judge:** 2/3 — Ответ в целом верен: он отмечает, что NoSQL подходит для гибких схем, больших масштабов и неклстерируемых/нереляционных данных. Однако он не упоминает явно конкретные модели NoSQL (ключ-значение, документы, широкие колонки, граф) и не точнее связывает утверждения с ожидаемыми секциями.
**Faithfulness:** 3/3 — Все утверждения ответа полностью подтверждены цитатами.

**Answer:**

SQL is preferred for structured data, strict schema, relational data, and complex joins or transactions; NoSQL is suitable for semi-structured or flexible schemas, non-relational data, very large scale, and high throughput without complex joins.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Database > NoSQL
- [2] scripts/day21/data/system-design-primer.md > Database > SQL or NoSQL

**Quotes:**
- [1] "Reasons for NoSQL: ... Semi-structured data, Dynamic or flexible schema, Non-relational data, No need for complex joins, Store many TB (or PB) of data, Very data intensive workload, Very high throughput for IOPS"
- [2] "Reasons for SQL: ... Structured data, Strict schema, Relational data, Need for complex joins, Transactions"

## q03: How does master-slave database replication handle reads and writes?

**Expectation:** Answer should say that the master handles writes and replicas/slaves can serve reads, with replication lag or failover trade-offs mentioned if possible.

**Retrieval:** ok (10→3)
**Rewritten query:** What is the architecture of master-slave database replication, specifically regarding read and write operations?

**Confidence:** high
**Sources:** 2 | **Quotes:** 2
**Rules:** 9/11 (strong)
**Judge:** 1/3 — Неполно верно: в типичной master-slave репликации мастер отвечает за записи, а реплики — за чтение (с возможной задержкой репликации). В ответе неверно заявлено, что мастер обрабатывает чтение, и не упомянуты лаги репликации и варианты переключения/failover.
**Faithfulness:** 3/3 — Все утверждения ответа полностью подтверждаются цитатами.

**Answer:**

Master-slave replication uses a single master for both reads and writes, while one or more slaves replicate the writes and serve only reads.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Database > Relational database management system (RDBMS)
- [2] scripts/day21/data/system-design-primer.md > Availability patterns > Replication

**Quotes:**
- [1] "The master serves reads and writes, replicating writes to one or more slaves, which serve only reads."
- [2] "Master-slave and master-master"

## q04: What is the CAP theorem and what are its three properties?

**Expectation:** Answer should define CAP theorem and name consistency, availability, and partition tolerance.

**Retrieval:** ok (10→1)
**Rewritten query:** What is the CAP theorem in distributed systems, and what are its three fundamental properties?

**Confidence:** high
**Sources:** 1 | **Quotes:** 1
**Rules:** 5/8 (partial)
**Judge:** 3/3 — Полный и корректный ответ: определение CAP-теоремы и перечисление трёх свойств (consistency/согласованность, availability/доступность, partition tolerance/устойчивость к разрыву).
**Faithfulness:** 3/3 — Все утверждения ответа точно соответствуют цитатам; CAP теорема утверждает выбор двух из трёх гарантий (Consistency, Availability, Partition Tolerance) и цитата содержит аналогичные определения.

**Answer:**

CAP теорема говорит, что в распределенной системе можно поддерживать только две из трёх гарантий: консистентность, доступность и устойчивость к разрыву сети (partition tolerance).

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Availability vs consistency

**Quotes:**
- [1] "In a distributed computer system, you can only support two of the following guarantees:  * **Consistency** - Every read receives the most recent write or an error  * **Availability** - Every request receives a response, without guarantee that it contains the most recent version of the information  * **Partition Tolerance** - The system continues to operate despite arbitrary partitioning due to network failures"

## q05: How can I prevent cross-site scripting and cross-site request forgery attacks?

**Expectation:** Answer should distinguish XSS and CSRF and mention core mitigations such as sanitization/escaping for XSS and tokens/same-site protections for CSRF.

**Retrieval:** ok (10→1)
**Rewritten query:** To prevent cross-site scripting and cross-site request forgery attacks, implement input validation, use secure coding practices, and employ HTTP-only cookies with secure flags. Additionally, ensure that all user inputs are sanitized before rendering on the client side.

**Confidence:** low
**Sources:** 1 | **Quotes:** 4
**Rules:** 5/9 (good)
**Judge:** 1/3 — Частично верно: упоминается санитизация входных данных как мера против XSS, но не даётся явное различие XSS и CSRF и отсутствуют ключевые меры CSRF (использование токенов, SameSite); ответ не привязан к ожидаемым секциям.
**Faithfulness:** 3/3 — Все утверждения в ответе прямо соответствуют цитатам: санитизация входов и параметризированные запросы — предотвращение XSS/SQL-инъекций; шифрование в транзите и покое — общая безопасность; принцип наименьших привилегий; упоминания CSRF отсутствуют в цитатах, что согласуется с текстом.

**Answer:**

Похоже, что в доступной базе знаний прямо по Preventing XSS и CSRF информация ограничена общими рекомендациями: санитификация входных данных и шифрование в пути, а также использование параметризованных запросов и принципа наименьших прав. Это перекликается с рекомендациями по предотвращению XSS и других инъекций через санитизацию всего пользовательского ввода и exposure параметров; однако конкретных мер против CSRF в тексте не упомянуто отдельно. Можно заключить, что: 1) санитизация входов и параметризованные запросы помогают предотвратить XSS и SQL-инъекции; 2) шифрование в transit и at rest относится к общей безопасности, но в материале не указаны конкретные техники CSRF.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Security

**Quotes:**
- [1] "Sanitize all user inputs or any input parameters exposed to user to prevent [XSS](https://en.wikipedia.org/wiki/Cross-site-scripting) and [SQL injection](https://en.wikipedia.org/wiki/SQL_injection)."
- [1] "Encrypt in transit and at rest."
- [1] "Use parameterized queries to prevent SQL injection."
- [1] "Use the principle of [least privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege)."

## q06: What is the difference between REST and RPC APIs?

**Expectation:** Answer should compare REST as a resource-oriented style and RPC as an operation/procedure-oriented style.

**Retrieval:** ok (10→2)
**Rewritten query:** REST vs RPC API comparison: What are their key differences in architecture, communication style, scalability, and use cases?

**Confidence:** high
**Sources:** 1 | **Quotes:** 4
**Rules:** 6/8 (strong)
**Judge:** 2/3 — Ответ частично верен: упоминаются различия подходов и приводятся примеры сопоставления RPC vs REST, а также затрагиваются различия в маршрутах и методах. Но не явно сформулировано, что REST является ресурс-ориентированным стилем, а RPC — процедурно-ориентированным, и не раскрыты ключевые аспекты (ресурсы, единообразный интерфейс, статусность и т. п.). Привязка к ожидаемым секциям присутствует через упоминание сопоставления, но формулировка не полностью соответствует требованию.
**Faithfulness:** 3/3 — Все утверждения полностью подтверждаются цитатами.

**Answer:**

REST и RPC рассматриваются в материаловедении как разные подходы к вызовам API; таблица в источнике 1 демонстрирует сопоставление операций между RPC и REST (например, Signup: RPC POST /signup против REST POST /persons, Read a person: RPC GET /readPerson?personid=1234 против REST GET /persons/1234 и т.д.), что наглядно иллюстрирует различия в маршрутaх и методах для тех же действий.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Communication > RPC and REST calls comparison

**Quotes:**
- [1] "Signup    | **POST** /signup | **POST** /persons"
- [1] "Read a person | **GET** /readPerson?personid=1234 | **GET** /persons/1234"
- [1] "Read a person’s items list | **GET** /readUsersItemsList?personid=1234 | **GET** /persons/1234/items"
- [1] "Add an item to a person’s items | **POST** /addItemToUsersItemsList<br/>{<br/>"personid": "1234";<br/>"itemid": "456"<br/>} | **POST** /persons/1234/items<br/>{<br/>"itemid": "456"<br/>}"

## q07: What does eventual consistency mean in distributed systems?

**Expectation:** Answer should define eventual consistency as a weaker consistency model where replicas converge over time if no new updates arrive.

**Retrieval:** ok (10→1)
**Rewritten query:** In distributed systems, what is the concept of eventual consistency and how does it differ from strong consistency?

**Confidence:** high
**Sources:** 1 | **Quotes:** 1
**Rules:** 2/6 (good)
**Judge:** 2/3 — В целом верно: определение eventual consistency совпадает с идеей, что реплики асинхронно реплицируются и чтения со временем увидят запись. Но ответ не явно упоминает условие о том, что это происходит при отсутствии новых обновлений, и не подчеркивает, что модель слабее по сравнению с сильной консистентностью. Groundedness: retrieval-запрос относится к разделу Consistency и ответ согласован с ожидаемым контекстом.
**Faithfulness:** 3/3 — Полное соответствие: ответ повторяет смысл цитаты — после записи чтения увидят её, данные реплицируются асинхронно; цитата также упоминает это прямо.

**Answer:**

Eventual consistency means that after a write, reads will eventually see it, with data replicated asynchronously.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Consistency patterns

**Quotes:**
- [1] "### Eventual consistency

After a write, reads will eventually see it (typically within milliseconds).  Data is replicated asynchronously.

This approach is seen in systems such as DNS and email.  Eventual consistency works well in highly available systems.

"

## q08: How can I horizontally scale a relational database using sharding and federation?

**Expectation:** Answer should explain both federation and sharding as ways to split data across multiple databases or partitions to scale horizontally.

**Retrieval:** ok (10→3)
**Rewritten query:** How can I horizontally scale a relational database by implementing sharding and federation techniques?

**Confidence:** high
**Sources:** 3 | **Quotes:** 3
**Rules:** 5/7 (good)
**Judge:** 1/3 — Частично верно: упомянуты оба подхода, но отсутствуют объяснения того, как работают федерация и шардинг, их различия, плюсы/минусы и практические примеры; ответ не привязывается к retrieval-данным.
**Faithfulness:** 3/3 — Все утверждения ответа полностью подтверждаются приведёнными цитатами: [1] перечисляет шардирование и федерацию как техники масштабирования; [3] обсуждают недостатки федерации и преимущества шардинга, а также общие свойства масштабирования.

**Answer:**

Чтобы горизонтально масштабировать RDBMS с использованием шардирования и федерации, можно применять оба подхода, так как материалы прямо упоминают их как техники масштабирования и обсуждают их свойства и недостатки.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Database > Relational database management system (RDBMS)
- [2] scripts/day21/data/system-design-primer.md > Load balancer > Horizontal scaling
- [3] scripts/day21/data/system-design-primer.md > Database > Relational database management system (RDBMS)

**Quotes:**
- [1] "There are many techniques to scale a relational database: master-slave replication, master-master replication, federation, sharding, denormalization, and SQL tuning."
- [3] "##### Disadvantage(s): federation

* Federation is not effective if your schema requires huge functions or tables.
* You'll need to update your application logic to determine which database to read and write.
* Joining data from two databases is more complex with a [server link](http://stackoverflow.com/questions/5145637/querying-data-by-joining-two-tables-in-two-database-on-different-servers).
* Federation adds more hardware and additional complexity."
- [3] "#### Sharding

Sharding distributes data across different databases such that each database can only manage a subset of the data.  Taking a users database as an example, as the number of users increases, more shards are added to the cluster.

Similar to the advantages of [federation](#federation), sharding results in less read and write traffic, less replication, and more cache hits.  Index size is also reduced, which generally improves performance with faster queries.

Like federation, there is no single central master serializing writes, allowing you to write in parallel with increased throughput."

## q09: How does a Content Delivery Network reduce latency for static assets?

**Expectation:** Answer should explain that a CDN serves static content from edge locations closer to users instead of always hitting the origin.

**Retrieval:** ok (10→3)
**Rewritten query:** What are the mechanisms used by content delivery networks to minimize latency in serving static assets?

**Confidence:** high
**Sources:** 3 | **Quotes:** 4
**Rules:** 4/8 (good)
**Judge:** 3/3 — Полностью соответствует ожиданиям: объясняет, что CDN обслуживает статические ресурсы с edge-локаций ближе к пользователю и снимает нагрузку с origin.
**Faithfulness:** 3/3 — Все утверждения в ответе полностью подтверждаются цитатами.

**Answer:**

CDN reduces latency by serving content from locations closer to the user and by offloading requests from your own servers.

**Sources used:**
- [1] scripts/day21/data/system-design-primer.md > Content delivery network
- [2] scripts/day21/data/system-design-primer.md > Content delivery network > Pull CDNs
- [3] scripts/day21/data/system-design-primer.md > Cache > CDN caching

**Quotes:**
- [1] "A content delivery network (CDN) is a globally distributed network of proxy servers, serving content from locations closer to the user.  Generally, static files such as HTML/CSS/JS, photos, and videos are served from CDN, although some CDNs such as Amazon's CloudFront support dynamic content.  The site's DNS resolution will tell clients which server to contact."
- [1] "Serving content from CDNs can significantly improve performance in two ways:

* Users receive content from data centers close to them
* Your servers do not have to serve requests that the CDN fulfills"
- [2] "Pull CDNs grab new content from your server when the first user requests the content.  You leave the content on your server and rewrite URLs to point to the CDN.  This results in a slower request until the content is cached on the CDN."
- [3] "CDNs are considered a type of cache."

## q10: What is the latency of reading 1 MB sequentially from SSD versus memory?

**Expectation:** Answer should reference the latency table and compare SSD sequential read of 1 MB with memory access, making clear that SSD is much slower than RAM.

**Retrieval:** ok (10→2)
**Rewritten query:** What is the sequential read latency for 1 MB data access on an SSD compared to RAM?

**Confidence:** insufficient
**Sources:** 0 | **Quotes:** 0
**Rules:** 0/10 (weak)
**Judge:** 0/3 — Ответ не содержит чисел или сравнения RAM vs SSD; не ссылается на Appendix > Latency numbers every programmer should know. Retrieval содержит релевантные разделы, но ответ игнорирует их и утверждает об отсутствии информации.

**Answer:**

К сожалению, в доступной базе знаний нет информации для ответа на этот вопрос. Попробуйте переформулировать запрос или уточнить тему.

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


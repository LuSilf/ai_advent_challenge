# Day 22 — RAG answer comparison report

Generated at: 2026-04-15T04:39:43.916Z
RAG strategy: **structural**
RAG topK: **3**

## Final comparison summary

- Average baseline judge score: 2.80/3
- Average RAG judge score: 2.50/3
- Average baseline cost: $0.000138
- Average RAG cost: $0.000219
- Judge comparison: RAG wins 1, baseline wins 4, ties 5

## Per-question summary

| # | Question | Baseline cost | RAG cost | Baseline rules | RAG rules | Baseline judge | RAG judge | Retrieval | Expected section hit |
|---|----------|---------------|----------|----------------|-----------|----------------|-----------|-----------|----------------------|
| q01 | What is the difference between cache-aside and write-through caching strategies? | $0.000117 (50/287) | $0.000227 (2322/276) | 6/7 (strong) | 8/8 (strong) | 3/3 | 2/3 | ok | yes |
| q02 | When should I use a NoSQL database instead of a SQL database? | $0.000093 (50/225) | $0.000216 (1874/305) | 6/8 (strong) | 9/9 (strong) | 2/3 | 3/3 | ok | yes |
| q03 | How does master-slave database replication handle reads and writes? | $0.000071 (46/172) | $0.000211 (2266/244) | 10/10 (strong) | 9/11 (strong) | 3/3 | 3/3 | ok | yes |
| q04 | What is the CAP theorem and what are its three properties? | $0.000058 (46/139) | $0.000184 (2358/166) | 6/7 (strong) | 6/8 (good) | 3/3 | 3/3 | ok | no |
| q05 | How can I prevent cross-site scripting and cross-site request forgery attacks? | $0.000200 (52/494) | $0.000187 (1160/323) | 7/8 (strong) | 7/9 (good) | 3/3 | 2/3 | ok | no |
| q06 | What is the difference between REST and RPC APIs? | $0.000160 (42/394) | $0.000278 (1642/489) | 6/7 (strong) | 7/8 (good) | 3/3 | 2/3 | ok | no |
| q07 | What does eventual consistency mean in distributed systems? | $0.000068 (40/166) | $0.000170 (1686/215) | 4/5 (strong) | 3/6 (good) | 3/3 | 3/3 | ok | no |
| q08 | How can I horizontally scale a relational database using sharding and federation? | $0.000454 (50/1128) | $0.000400 (2488/688) | 6/6 (strong) | 5/7 (good) | 3/3 | 3/3 | ok | no |
| q09 | How does a Content Delivery Network reduce latency for static assets? | $0.000060 (46/144) | $0.000132 (954/210) | 7/7 (strong) | 6/8 (good) | 3/3 | 3/3 | ok | no |
| q10 | What is the latency of reading 1 MB sequentially from SSD versus memory? | $0.000100 (54/242) | $0.000189 (1508/284) | 9/9 (strong) | 8/10 (good) | 2/3 | 1/3 | ok | no |

## q01: What is the difference between cache-aside and write-through caching strategies?

**Expectation:** Answer should explain that cache-aside loads data lazily on cache miss, while write-through updates cache and backing store synchronously on write. A good answer should mention trade-offs such as stale reads, simplicity, or write latency.

**Expected sections:** Cache > When to update the cache

### Baseline (without RAG)

Cost: $0.000117 (50/287)
Rules: 6/7 (strong)
Judge: 3/3 — Полный и корректный ответ. Четко объясняет cache-aside как ленивый загрузчик данных на пропуск (miss) и обновление кэша при следующем чтении или явной записи, а write-through — синхронное обновление кэша и БД на каждую запись. Раскрыты ключевые различия, включая инициаторов заполнения кэша, консистентность и влияние на производительность/сложность. Также присутствует упоминание секции о времени обновления кэша и торговых-offs (устаревшие данные, простота, задержка записи).

Кратко:

- Cache-aside (lazy): приложение сам читает данные из кеша и если их нет (мимо кеша) — читает из БД и записывает в кеш. При обновлении данные пишутся в БД, а кеш обновляется либо при следующем чтении, либо явной операцией. Кеш — второстепенный источник, он заполняется по запросу.

- Write-through: каждое запись в БД сопровождается мгновенной записью в кеш. Кеш всегда содержит актуальные данные, т.к. не требуется отдельная логика обновления кеша. Упрощает консистентность, но writes идут через кешованный путь.

Ключевые различия:
- Кто инициирует заполнение кеша: cache-aside — приложение само, write-through — кеш как промежуточный слейв, получает записи сразу.
- Консистентность: write-through обеспечивает строгую консистентность между БД и кешем; cache-aside требует дополнительной логики обновления/инвалидирования.
- Производительность/сложность: cache-aside может сэкономить ресурсы кеша для редко запрашиваемых данных; write-through может снизить задержку чтения, но увеличивает время записи и сложность кеша.

- Rule score: 6/7
- Verdict: strong
- Matched must-have: cache-aside||ленив, write-through||сквозн
- Matched nice-to-have: lazy||ленив, latency||задерж

### Retrieval

- Retrieved 3 chunk(s) (strategy=structural, topK=3)
  1. source=scripts/day21/data/system-design-primer.md; section=Cache > When to update the cache; distance=0.7314
  2. source=scripts/day21/data/system-design-primer.md; section=Cache > CDN caching; distance=0.7539
  3. source=scripts/day21/data/system-design-primer.md; section=Cache > When to update the cache; distance=0.7564

### RAG answer

Cost: $0.000227 (2322/276)
Rules: 8/8 (strong)
Judge: 2/3 — Ответ в целом верно объясняет различия и trade-offs между cache-aside и write-through: lazy loading для cache-aside, синхронное обновление кеша и БД для write-through, а также упоминание задержки и устаревших данных. Тем не менее есть неточность по механизму записи в cache-aside (на практике запись идёт в БД, кеш может обновляться/инвалидироваться позже) и ответ не явно структурирован в соответствии с секцией 'Cache > When to update the cache'.

Коротко:

- Cache-aside (lazy loading)
  - Приложение читает кеш и при промахе загружает данные из БД, затем кладет в кеш.
  - Запись в кеш и БД выполняются отдельно: запись в кеш может произойти позже или через другой путь.
  - Преимущества: простота, кеш заполняется только по запросам; недостатки: задержка при каждом промахе и риск устаревших данных без TTL или других механизмов синхронизации.

- Write-through
  - При записи данные сначала пишутся в кеш, затем синхронно в БД.
  - Кеш на всегда содержит актуальные данные после записи; чтение после записи очень быстро.
  - Преимущества: данные в кеше не устаревают; недостатки: более медленная запись из-за синхронного дыма в БД и потенциальные проблемы при новых узлах/разгоне, если данные не кешируются сразу.

Пример из материалов:
- В cache-aside приложение сначала ищет в кеше, при промахе читает из БД и сохраняет в кеш.
- В write-through приложение пишет в кеш и синхронно в БД.

- Rule score: 8/8
- Verdict: strong
- Matched must-have: cache-aside||ленив, write-through||сквозн
- Matched nice-to-have: lazy||ленив, stale||устар, latency||задерж
- Matched sections: Cache > When to update the cache

## q02: When should I use a NoSQL database instead of a SQL database?

**Expectation:** Answer should contrast SQL and NoSQL at a high level and mention that NoSQL can be a better fit for non-tabular data, large scale, flexible schema, or specific data models such as key-value/document/wide-column/graph.

**Expected sections:** Database > NoSQL, Database > SQL or NoSQL

### Baseline (without RAG)

Cost: $0.000093 (50/225)
Rules: 6/8 (strong)
Judge: 2/3 — В целом корректно контрастирует SQL/NoSQL и охватывает ключевые мотивы для выбора NoSQL (гибкая схема, масштаб, данные вне табличной структуры). Пропущено явное упоминание графной модели (graph) как одного из типов NoSQL, и нет явной секции Database > NoSQL / SQL or NoSQL.

Use a NoSQL database when:

- Flexible schemas or dynamic data: you need evolving or heterogeneous data models (JSON-like documents, key-value, wide-column).
- High scalability and throughput: you require easy horizontal scaling and large write/read throughput.
- Low-latency, high-availability needs: you can tolerate eventual consistency or your app is OK with AP/BASE models.
- Semi-structured data or complex relationships are not strong constraints: you don’t need strict ACID across multiple documents.
- Rapid development with evolving requirements: you want faster schema changes and iterative development.

Prefer SQL when:

- Strong ACID transactions and data integrity are critical (financial, inventory, accounts).
- Fixed, well-defined schema with relationships and complex queries (joins) are common.
- Mature tooling, reporting, and complex analytics are important.
- You require strict consistency and standard SQL querying.

Common hybrid approach: use SQL for core transactional data and NoSQL (or specialized NewSQL) for scalability, caching, logs, or unstructured data.

- Rule score: 6/8
- Verdict: strong
- Matched must-have: NoSQL||No SQL, SQL||реляцион
- Matched nice-to-have: key-value||ключ-знач, document||документ

### Retrieval

- Retrieved 3 chunk(s) (strategy=structural, topK=3)
  1. source=scripts/day21/data/system-design-primer.md; section=Database > NoSQL; distance=0.7990
  2. source=scripts/day21/data/system-design-primer.md; section=Database > NoSQL; distance=0.8024
  3. source=scripts/day21/data/system-design-primer.md; section=Cache > Database caching; distance=0.8102

### RAG answer

Cost: $0.000216 (1874/305)
Rules: 9/9 (strong)
Judge: 3/3 — Полный и корректный ответ: ясно объясняет, когда стоит рассмотреть NoSQL вместо SQL, охватывает горизонтальное масштабирование, гибкие схемы и разные модели данных (ключ-значение, документ, граф, широкие колонки), а также BASE vs ACID и соответствующие trade-offs. Соответствует ожидающим секциям и терминам.

Когда использовать NoSQL вместо SQL:

- Требуется шкалирование по горизонтали (распределённое хранение данных) и высокая доступность.
- Модели данных без жестких связей и нормализации: документа/ключ-значение, графы, широкие колонки. Применимо для быстро меняющихся данных.
- Нужна денормализация и минимизация сложных join’ов в БД; логику соединения чаще ведёт приложение.
- Желаемая модель данных: ключ-значение, документ, граф или широкая колонка (в зависимости от кейса).
- Наличие BASE и готовность к eventual consistency, а не строгой ACID.

Обратите внимание: NoSQL может не поддерживать ACID полностью; лучше подойдет, когда важнее доступность и масштабируемость, чем строгая консистентность в транзакциях.

Как выбрать конкретную тип NoSQL:
- Для простых пар ключ-значение и кэширования — ключ-значение store.
- Для гибких схем и вложенных документов — документ-ориентированная база.
- Для сложных связей и графов — графовая база.
- Для больших наборов столбцов и аналитики по колонкам — wide-column store.

Если нужен более конкретный совет по вашему кейсу, опишите модель данных и требования к транзакциям.

- Rule score: 9/9
- Verdict: strong
- Matched must-have: NoSQL||No SQL, SQL||реляцион
- Matched nice-to-have: key-value||ключ-знач, document||документ, wide column||широк, graph||граф
- Matched sections: Database > NoSQL

## q03: How does master-slave database replication handle reads and writes?

**Expectation:** Answer should say that the master handles writes and replicas/slaves can serve reads, with replication lag or failover trade-offs mentioned if possible.

**Expected sections:** Availability patterns > Replication, Database > Relational database management system (RDBMS)

### Baseline (without RAG)

Cost: $0.000071 (46/172)
Rules: 10/10 (strong)
Judge: 3/3 — Полностью соответствует ожиданиям: объясняет, что writes идут на мастер, reads — на реплики/слейвы; упоминается репликация с лагом (асинхронно или полусинхронно) и возможные trade-offs, включая failover и паттерн чтение/запись.

- Writes go to the master (primary) database. The master handles all update/insert/delete operations.
- Reads go to the slaves (replicas). Read requests can be distributed across one or more slaves to balance load.
- Replication: changes from the master are asynchronously (or semi-synchronously) streamed to slaves to keep them in sync. There’s typically a replication lag.
- Pros: simple to implement, good read scaling.
- Cons/cons: eventual consistency (reads may see stale data), single point of write bottleneck at master, lag during high write throughput, failover risk if master unavailable.
- Typical patterns: read-write split, application logic to route writes to master and reads to slaves; optional multi-master or failover mechanisms for availability.

- Rule score: 10/10
- Verdict: strong
- Matched must-have: writes||запис, reads||чтен, master||мастер, replica||реплик||slave||слейв
- Matched nice-to-have: replication lag||лаг, failover||переключ||promote

### Retrieval

- Retrieved 3 chunk(s) (strategy=structural, topK=3)
  1. source=scripts/day21/data/system-design-primer.md; section=Availability patterns > Replication; distance=0.6379
  2. source=scripts/day21/data/system-design-primer.md; section=Database > Relational database management system (RDBMS); distance=0.6390
  3. source=scripts/day21/data/system-design-primer.md; section=Database > Relational database management system (RDBMS); distance=0.6544

### RAG answer

Cost: $0.000211 (2266/244)
Rules: 9/11 (strong)
Judge: 3/3 — Полностью верно: мастер отвечает за записи, реплики/slaves обслуживают чтение; упомянуты задержка репликации (lag) и переключение/промоушен при отказе мастера, что соответствует ожидаемым секциям.

Кратко:

- Мастер-слейв: мастер принимает и записывает данные; слейвы реплицируют письма от мастера и обслуживают чтение. Чтения идут с слейвов, записи — только на мастере. При выходе мастера система может работать в режиме чтения по слейвам до назначения нового мастера.
- Проблемы: задержка репликации (lag), необходимость продвижения слейва в мастера при отказе, дополнительная логика для маршрутизации записей и обработки чтений.

Из материалов:
- Master-slave: мастер служит чтениям и записям, слейвы — только чтение; репликация записей на слейвы; возможна иерархия слейвов. Плюс: при отказе мастера можно перейти в режим только чтения до замены мастера.
- Предупреждения: задержка репликации, риск потери данных при сбое мастера до репликации, больше нагрузки на мастер из-за записи и репликации.

- Rule score: 9/11
- Verdict: strong
- Matched must-have: writes||запис, reads||чтен, master||мастер, replica||реплик||slave||слейв
- Matched sections: Availability patterns > Replication, Database > Relational database management system (RDBMS)

## q04: What is the CAP theorem and what are its three properties?

**Expectation:** Answer should define CAP theorem and name consistency, availability, and partition tolerance.

**Expected sections:** Principles > CAP theorem

### Baseline (without RAG)

Cost: $0.000058 (46/139)
Rules: 6/7 (strong)
Judge: 3/3 — Полное и корректное объяснение CAP, перечислены три свойства и их смысл; соответствует ожиданию и секции Principles > CAP theorem, без заметных ошибок.

CAP theorem: In a distributed data store, you can’t simultaneously guarantee Consistency, Availability, and Partition tolerance. At most two of the three can be achieved.

Three properties:
- Consistency (C): Every read receives the most recent write or an error.
- Availability (A): Every request receives a (non-error) response, without guarantee of being the latest.
- Partition tolerance (P): The system continues to operate despite network partitions that separate nodes.

Implications: In presence of a network partition, you must choose between C and A. Without partitions, you can have C and A.

- Rule score: 6/7
- Verdict: strong
- Matched must-have: consistency||согласован, availability||доступност, partition tolerance||partition-tolerant||устойчивост к разрыв

### Retrieval

- Retrieved 3 chunk(s) (strategy=structural, topK=3)
  1. source=scripts/day21/data/system-design-primer.md; section=Database > NoSQL; distance=0.8701
  2. source=scripts/day21/data/system-design-primer.md; section=Asynchronism > Source(s) and further reading; distance=0.8748
  3. source=scripts/day21/data/system-design-primer.md; section=Availability patterns > Availability in numbers; distance=0.9070

### RAG answer

Cost: $0.000184 (2358/166)
Rules: 6/8 (good)
Judge: 3/3 — Полный и корректный ответ. Дано определение CAP-теоремы, перечислены три свойства (consistency, availability, partition tolerance) и их суть; формулировка согласуется с ожидаемой секцией Principles > CAP theorem; присутствуют релевантные контекст и термины (grounding).

CAP theorem: In a distributed data system, it is impossible to simultaneously provide all three guarantees—Consistency, Availability, and Partition tolerance. A system can satisfy at most two of the three at any given time.

Three properties:
- Consistency: All nodes see the same data at the same time.
- Availability: Every request receives a (non-error) response, without guaranteed freshness of data.
- Partition tolerance: The system continues to operate despite any number of messages being dropped or delayed between nodes (i.e., network partitions).

Context from materials: The provided sources mention BASE vs CAP and discuss availability and consistency trade-offs in NoSQL systems, highlighting that many NoSQL stores favor availability and eventual consistency over strict ACID/strong consistency.

- Rule score: 6/8
- Verdict: good
- Matched must-have: consistency||согласован, availability||доступност, partition tolerance||partition-tolerant||устойчивост к разрыв

## q05: How can I prevent cross-site scripting and cross-site request forgery attacks?

**Expectation:** Answer should distinguish XSS and CSRF and mention core mitigations such as sanitization/escaping for XSS and tokens/same-site protections for CSRF.

**Expected sections:** Security > Cross-site scripting (XSS), Security > Cross-site request forgery (CSRF)

### Baseline (without RAG)

Cost: $0.000200 (52/494)
Rules: 7/8 (strong)
Judge: 3/3 — Полностью верно и полно: разделение XSS и CSRF, перечисление основных mitigations (экранирование/санитизация и CSP для XSS; CSRF-токены, SameSite, double-submit, Referer/Origin, безопасные методы) и шаги внедрения. Соответствует ожиданиям.

Кратко по делу:

XSS (межсайтовый скриптинг)
- Валидация и экранирование входящих данных: кодируйте все выходящие данные в контексте (HTML, JS, CSS, URL).
- Используйте безопасные функции вывода (escape/encode) и шаблоны.
- Content Security Policy (CSP): ограничьте источники скриптов, стилей и объекты.
- HttpOnly и Secure флаги для cookies: защищают куки от доступа через JavaScript и отправку по HTTPS.
- Нетравимые обновления: избегайте инъекций путем использование параметризованных запросов к БД (prepared statements).
- Ввод ограничений: минимизируйте допустимый ввод и валидируйте на сервере.
- Защита от DOM-based XSS: избегайте необработанных данных в DOM; используйте безопасные методы манипуляций.

CSRF (межсайтовая подделка запроса)
- Проверка CSRF-токена: включайте уникальный CSRF-токен в каждую форму и проверяйте на сервере.
- SameSite cookies: устанавливайте SameSite=Strict или Lax для кук по умолчанию.
- Double-submit cookies: токен в куках и в теле запроса (при отсутствии HttpOnly).
- Проверка реферера/Origin: базовая проверка происхождения запроса, особенно для критических действий.
- Мягкие методы: используйте безопасные методы HTTP для изменений состояния (POST/PUT/DELETE) и требуйте повторную аутентификацию там, где нужно.
- Аудит и тестирование: регулярно проводите сканирование на XSS/CSRF и внедряйте CSP-слои.

Коротко по шагам
1) Включите CSP и применяйте строгий контент-дескриптор.
2) Экранируйте/кодируйте все выходящие данные.
3) Используйте HttpOnly/Secure куки и SameSite.
4) Применяйте параметризованные запросы к БД.
5) Внедрите CSRF-токены для форм и API.
6) Регулярно тестируйте и обновляйте зависимости.

- Rule score: 7/8
- Verdict: strong
- Matched must-have: XSS||cross-site scripting, CSRF||cross-site request forgery
- Matched nice-to-have: escape||экранир, token||токен, same-site||samesite

### Retrieval

- Retrieved 3 chunk(s) (strategy=structural, topK=3)
  1. source=scripts/day21/data/system-design-primer.md; section=Domain name system > Disadvantage(s): DNS; distance=0.7545
  2. source=scripts/day21/data/system-design-primer.md; section=Cache > Web server caching; distance=0.7863
  3. source=scripts/day21/data/system-design-primer.md; section=Security; distance=0.7974

### RAG answer

Cost: $0.000187 (1160/323)
Rules: 7/9 (good)
Judge: 2/3 — В целом верно: отделяет XSS и CSRF, перечисляет базовые mitigations (санитизация/экранирование для XSS; CSRF-токены). Недостаточно упомянута защита SameSite (важная мера против CSRF), и часть материала по CSRF может быть не явно подкреплена источниками; некоторые пункты выходят за рамки материалов.

Кратко по методам предотвращения XSS и CSRF, опираясь на предоставленные материалы:

- XSS:
  - Санитизация входных данных и параметров, которые отправляются от пользователя (sanitize user inputs) чтобы не допустить внедрения вредоносного кода.
  - Применение безопасного кодирования при выводе данных в HTML (избегать вывода сырых пользовательских значений без экранирования).
  - Использовать параметризованные запросы и общую принципиальную защиту на уровне приложения (из раздела Security: “Sanitize all user inputs … to prevent XSS” и “Encrypt in transit and at rest”).

- CSRF (CSRF не прямо упомянут в материалах, но логично следует из базовых принципов безопасности и защиты веб-приложений):
  - Применение сильной аутентификации и проверки CSRF-токенов на состояниях, изменяющих данные.
  - Принцип минимальных привилегий и проверка подлинности запросов.

Общие принципы из материалов:
- Шифрование в транзите и на хранении.
- Санитация входных данных и использование безопасных практик разработки (OWASP и т.д. в источниках).

Если нужно, могу дать краткий чек-лист по внедрению в коде (например, примеры экранирования вывода, какие заголовки и токены использовать).

- Rule score: 7/9
- Verdict: good
- Matched must-have: XSS||cross-site scripting, CSRF||cross-site request forgery
- Matched nice-to-have: escape||экранир, sanitize||санит, token||токен

## q06: What is the difference between REST and RPC APIs?

**Expectation:** Answer should compare REST as a resource-oriented style and RPC as an operation/procedure-oriented style.

**Expected sections:** Communication > REST, Communication > RPC

### Baseline (without RAG)

Cost: $0.000160 (42/394)
Rules: 6/7 (strong)
Judge: 3/3 — Полный и корректный ответ: ясно объясняет различие REST как ресурс-ориентированного стиля и RPC как процедурно-ориентированного. Упоминаются ресурсы, HTTP-методы и гипермедиа для REST; вызовы удалённых процедур/методов, контракты и сериализация для RPC; разобраны ключевые различия, гипермедиа, а также сценарии выбора. Соответствует ожидаемым секциям и терминам.

Кратко:

- REST API:
  - Архитектурный стиль. Использует ресурсы (URN/URL) и стандартные HTTP-методы (GET, POST, PUT, PATCH, DELETE).
  - Стратегия: манипуляции ресурсами через их представления; статус — статусы HTTP; чаще используют гипермедиа (HATEOAS).
  - Фокус на ресурсы, согласование форматов через представления (обычно JSON/XML).

- RPC API:
  - Функциональный стиль. Клиент вызывает удалённую процедуру/метод как локальную функцию.
  - Вызовы определяются набором методов/эндпойнтов, часто с передачей параметров и возвратом результата.
  - Меньше акцента на ресурсах; больше на действиях. Может быть собственный контракт и сериализация (JSON, Protobuf, и т. п.).

Ключевые различия:
- Объект внимания: REST — ресурсы, RPC — функции/методы.
- Способ взаимодействия: REST — действия через HTTP-методы и состояния ресурса; RPC — вызов удалённой функции.
- Стандарты: REST опирается на принципы HTTP (статусы, кэширование, гипермедиа); RPC может быть более самодостаточным набором контрактов без строгих HTTP-обязательств.
- Гипермедиа: в REST может быть навигация через ссылки; в RPC обычно нет.

Когда выбрать:
- REST: веб-аппликации, публичные API, требующие кэширования, масштабирования и совместимости.
- RPC: внутренние сервисы, низкозатратные вызовы между микросервисами, требования к четкому контракту и низкой задержке.

- Rule score: 6/7
- Verdict: strong
- Matched must-have: REST||resource-oriented||ресурс, RPC||procedure-oriented||процедур||операц
- Matched nice-to-have: resource||ресурс, procedure||процедур

### Retrieval

- Retrieved 3 chunk(s) (strategy=structural, topK=3)
  1. source=scripts/day21/data/system-design-primer.md; section=Asynchronism > Source(s) and further reading; distance=0.8893
  2. source=scripts/day21/data/system-design-primer.md; section=Content delivery network > Disadvantage(s): CDN; distance=0.9002
  3. source=scripts/day21/data/system-design-primer.md; section=Database > NoSQL; distance=0.9182

### RAG answer

Cost: $0.000278 (1642/489)
Rules: 7/8 (good)
Judge: 2/3 — В целом верно и понятно: REST как ресурс-ориентированный, RPC как процедурно/операционно ориентированный, перечислены практические различия. Однако grounding на предоставленные retrieval-данные слабый (ответ опирается на общие знания), и есть небольшие неточности в формулировках (упоминание «state transfer» и стиль).

Кратко:

- REST (Representational State Transfer)
  - Архитектурный стиль веб-API.
  - Клиенты взаимодействуют с ресурсами через унифицированные HTTP-методы (GET, POST, PUT, DELETE и т.д.).
  - Ресурсы идентифицируются по URL; обмен происходит через стандартные форматы данных (обычно JSON или XML).
  - Структура сообщений и маршрутизация завязаны на ресурсах и гипермедиа (в некоторых реализациях) — «state transfer» через набор операций над ресурсами.
  - Обычно ориентирован на CRUD-операции и имеет статусы ресурсов, кэшируемость, гипермедию и независимость клиента/сервера.

- RPC (Remote Procedure Call) API
  - Инкапсулирует вызов удаленной функции/метода.
  - Клиент вызывает удаленную процедуру по имени и передает параметры; ответ возвращает результат выполнения.
  - Не обязательно привязан к HTTP-методам или ресурсам; важно действие/функция и её сигнатура.
  - Может быть более эффективным для исполнений, где нужен конкретный вызов (например, обновить состояние через одну операцию), но менее «посредственный» в терминах ресурсов и гипермедиа.

Различия на практике
- Модель: REST — ресурс-ориентированная; RPC — процедура-ориентированная.
- Инварианты: REST использует статусы HTTP, кэшируемость, URIs как ресурсы; RPC может не следовать этим принципам и чаще фокусируется на вызове конкретной функции.
- Расширяемость/кешируемость: REST легче кэшировать и разворачивать в веб-инфраструктуре; RPC-проанализировать можно как внутри сервиса, так и поверх HTTP, но кэширование не обязательно стандартно.
- Эволюция API: REST-подход способствует гипермедиа и самостоятельности сервисов; RPC может быть проще для быстрого взаимодействия, но часто менее гибок в изменениях ресурсов.

Примечание: В доступных материалах напрямую о REST vs RPC упоминаний нет. Если нужно, могу привести дополнительные пояснения или примеры.

- Rule score: 7/8
- Verdict: good
- Matched must-have: REST||resource-oriented||ресурс, RPC||procedure-oriented||процедур||операц
- Matched nice-to-have: resource||ресурс, procedure||процедур, operation||операц

## q07: What does eventual consistency mean in distributed systems?

**Expectation:** Answer should define eventual consistency as a weaker consistency model where replicas converge over time if no new updates arrive.

**Expected sections:** Principles > Consistency

### Baseline (without RAG)

Cost: $0.000068 (40/166)
Rules: 4/5 (strong)
Judge: 3/3 — Полностью верный и исчерпывающий ответ: даёт определение eventual consistency, описывает как реплики сходятся, возможную устаревшую информацию при чтении, асинхронное распространение записей и торговлю между доступностью/низкой задержкой; соответствует ожиданиям и секциям.

Eventual consistency means that in a distributed system, updates to data will propagate to all replicas, and eventually all copies will become consistent with each other. There may be temporary discrepancies after an update, but if no new updates occur, all replicas will converge to the same value.

Key points:
- Writes can be accepted by any replica and propagate asynchronously.
- Reads may return stale data for a while.
- The system guarantees convergence: after some bounded time without new writes, all replicas agree.
- Often used to improve availability and partition tolerance (as per CAP theorem).

Common scenarios: multi-region databases, caching layers, and some NoSQL stores. Trade-off: higher availability and lower latency at the cost of potential reads returning stale data temporarily.

- Rule score: 4/5
- Verdict: strong
- Matched must-have: eventual consistency||итогов||eventually consistent
- Matched nice-to-have: replicas||реплик, converge||сход

### Retrieval

- Retrieved 3 chunk(s) (strategy=structural, topK=3)
  1. source=scripts/day21/data/system-design-primer.md; section=Availability vs consistency; distance=0.6731
  2. source=scripts/day21/data/system-design-primer.md; section=Consistency patterns; distance=0.7491
  3. source=scripts/day21/data/system-design-primer.md; section=Availability patterns; distance=0.8698

### RAG answer

Cost: $0.000170 (1686/215)
Rules: 3/6 (good)
Judge: 3/3 — Полностью корректное и чётко изложенное определение eventual consistency: слабая модель консистентности, при которой реплики сходятся со временем; упомянута асинхронная репликация и возможность чтения устаревшей версии до завершения синхронизации; соответствует ожиданиям и секции Principles > Consistency.

Eventual consistency в распределённых системах означает, что после записи данные будут синхронизированы между копиями асинхронно, и чтение в конечном итоге увидит последнюю запись. Это обеспечивает высокую доступность и продолжение работы при сбоях, но чтение может вернуть не самую свежую версию на время синхронизации.

Контекст из материалов:
- AP часть CAP: система может быть доступной и переносимой при разделении, ноReads могут возвращать не самую последнюю версию до завершения репликации (eventual consistency).
- В разделе Consistency patterns: eventual consistency — копии данных реплицируются асинхронно и читаемость со временем становится согласованной.

Кратко: eventual consistency — гарантирует, что запись со временем становится видимой во всех копиях, но мгновенно прочитанная версия может быть устаревшей до завершения репликации.

- Rule score: 3/6
- Verdict: good
- Matched must-have: eventual consistency||итогов||eventually consistent
- Matched nice-to-have: replicas||реплик

## q08: How can I horizontally scale a relational database using sharding and federation?

**Expectation:** Answer should explain both federation and sharding as ways to split data across multiple databases or partitions to scale horizontally.

**Expected sections:** Database > Federation, Database > Sharding

### Baseline (without RAG)

Cost: $0.000454 (50/1128)
Rules: 6/6 (strong)
Judge: 3/3 — Полностью соответствует ожиданиям: ясно объясняет шардинг и федерацию как способы горизонтального масштабирования БД, охватывает архитектуру, плюсы/минусы, выбор между подходами, практические шаги и примеры. Учитывает необходимые термины (шард, федерац), упоминает горизонтальное разделение и затрагивает консистентность.

Кратко: горизонтальное масштабирование РСУБД можно за счёт шардинга (sharding) и федерации (federation). Ниже основные идеи и шаги.

1) Шардинг (sharding)
- Что это: разделение данных на несколько шардов (узлов/файловых систем), каждый хранит подмножество таблиц или подмножество строк.
- Варианты распределения:
  - Хэштинг по ключу (hash-based): выбирается shard = hash(ключ_записи) mod N. Быстрый доступ к конкретному ключу, простая консистентность.
  - Диапазонный шардинг (range): данные по диапазонам значений ключа. Хорошо для диапазонных запросов и прогнозируемой локализации.
  - Декстентрированный (directory-based): внешний каталог mapping ключ-> shard. Гибко, но требует каталога.
- Архитектура:
  - Каждый шард — отдельная РСУБД (PostgreSQL, MySQL, Spanner-like nodes).
  - Прокси/маршрутизатор: приложение или прокси-сервер выбирает shard по ключу.
  - Репликация внутри шарда для отказоустойчивости.
  - Распределённые транзакции: не рекомендуется на уровне SQL; используйте saga-pattern, eventual consistency, или two-phase commit только если нужна строгая консистентность.
- Применение:
  - Выбор стратегии: по ключу пользователя, по области данных, по диапазонам.
  - Обновление схемы: минимально совместимая схема на шардах, миграции по частям.
  - Мониторинг: баланс нагрузки, горячие и холодные шарды, автомасштабирование.

2) Федерация (federation)
- Что это: объединение данных из нескольких баз данных без физического переноса. Запрос определяется к нескольким источникам, затем агрегируется.
- Архитектура:
  - Федерированный слой: слой запросов, который отправляет подзапросы каждому источнику, собирает результаты и выполняет финальную агрегацию.
  - Источники: независимые базы (можно разные версии или разные СУБД).
  - Транзакции: чаще заканчиваются eventual consistency; распределенные транзакции сложны. Обычно без распределённых транзакций.
- Применение:
  - Глобальные аналитические запросы, объединение данных из разных сервисов.
  - Федерированный доступ к мигрированным частям данных без полного копирования.
- Ограничения:
  - Сложности с точной консистентностью и задержками из-за сетевых вызовов.
  - Запросы могут быть медленнее, чем локальные.

3) Как выбрать между ними
- Шардинг подходит для больших одним источником данных, требующих высокой пропускной способности по конкретным ключам, когда данные можно разделить без частого пересечения запросов между шардами.
- Федерация подходит для интеграции данных из разнородных систем, когда нужна глобальная видимость без переносов, но не нужна сильная консистентность или ультранизкая задержка.
- Часто применяют комбинацию: шардинг внутри сервисов для основного ХД, федерацию для кросс-сервисных аналитик и отчётности.

4) Практические шаги
- Определитесь с доменами и ключами шардинга.
- Выберите технологическую реализацию:
  - Шардинг: Citus (для PostgreSQL), Vitess (для MySQL), безопасные шарды в CockroachDB, или собственная реализация прокси+шардинг на уровне приложения.
  - Федерация: есть решения как дистрибутивные движки (например, Apache Calcite, Data Federation слои), или архитектурные подходы через API Gateway и агрегацию на клиенте/сервере.
- Обеспечьте мониторинг и балансировку:
  - баланс нагрузки между шардами, репликациями.
  - распределение горячих данных, патчинг схем.
- Управление схемой и миграциями:
  - Безопасные миграции без простоя, версионирование схем.
- Существенные технологии/инструменты:
  - Постгрес + Citus для горизонтального шардинга.
  - Vitess для MySQL шардинга.
  - CockroachDB как распределённая РСУБД.
  - Data Virtualization/Calcite или Presto/Trino для федерации аналитики.

5) Пример сценария
- Вы запускаете приложение, где учетная запись пользователя определяет shard по user_id (hash-based). Каждый shard — независимая PostgreSQL. В аналитике вы используете federation-слой: ETL/CDC копирует данные в data warehouse, или используете federated запросы к каждому shard через слой агрегации.

Если хотите, скажите вашу СУБД и требования к консистентности и ответам на запросы — подскажу конкретную схему шардинга и пример архитектурного решения.

- Rule score: 6/6
- Verdict: strong
- Matched must-have: sharding||шард, federation||федерац
- Matched nice-to-have: horizontal||горизонт, partition||разделен

### Retrieval

- Retrieved 3 chunk(s) (strategy=structural, topK=3)
  1. source=scripts/day21/data/system-design-primer.md; section=Load balancer > Horizontal scaling; distance=0.7075
  2. source=scripts/day21/data/system-design-primer.md; section=Database > Relational database management system (RDBMS); distance=0.7313
  3. source=scripts/day21/data/system-design-primer.md; section=Database > Relational database management system (RDBMS); distance=0.7337

### RAG answer

Cost: $0.000400 (2488/688)
Rules: 5/7 (good)
Judge: 3/3 — Ответ полно охватывает обе концепции: шардирование и федерацию, объясняет их различия, подходы к горизонтальному масштабированию, риски и ситуации применения, а также даёт практические шаги и примеры комбинирования; текст согласован с ожидаемыми секциями и терминологией.

Кратко: горизонтальное масштабирование RDBMS можно реализовать через шардирование и федерацию, но они решают разные задачи и требуют другой логики приложения.

Что такое и зачем
- Шардирование (sharding): разбиение данных на несколько независимых баз данных (шардов). Каждый шард отвечает за подмножество данных (например, по последней букве имени или по географии). Выносит нагрузку на чтение/запись параллельно и уменьшает размер индексов. Но требует изменений в логике приложения и маршрутизации запросов.
- Федерация (federation): запросы обрабатываются через несколько баз данных, но данные могут находиться в разных местах. Без единого центра сериализации writes — можно писать параллельно, получая меньшую блокировку и масштабируемость. Математически сложнее писать кросс-базы и агрегировать данные.

Как связать с горизонтальным масштабированием
- Вложите шардирование в архитектуру базы данных:
  - Разделите данные на несколько шардов, каждый держится отдельно.
  - Назначайте клиента/запрос конкретному шарду по ключу (например, по географии или части ключа).
  - Обеспечьте репликацию внутри каждого шарда для устойчивости и читабельности.
  - Управляйте маршрутизацией на уровне приложения или через прокси/распределённый слой.
- Используйте federation там, где нужна интеграция данных из нескольких источников без строгой централизованной записи:
  - Применяйте для сценариев, где данные естественно разбиты по доменам или сервисам.
  - Учитывайте сложности соединения и агрегации данных между базами (сложность запросов, необходимость сервер‑links, увеличение аппаратной нагрузки).
- Комбинация:
  - Часто применяют шардирование для основных таблиц, а федерацию — для распределённых аналитических запросов или межшардинной агрегации, где требуется объединение данных из нескольких источников.
- Складирование и отказоустойчивость:
  - У каждого шарда своя репликация (мастер‑слейв или мастер‑мастер), чтобы при падении шарда продолжать работу.
  - Обеспечьте мониторинг и автоматическое переназначение маршрутов при сбоях.

Типичные недостатки/риски (из материалов)
- Шардирование:
  - Требуется изменение логики приложения для работы с шардами и маршрутизацией.
  - Нужно обеспечить репликацию внутри шарда и обработку сбоев одного шарда.
- Федерация:
  - Сложность запросов и агрегации между базами, необходимость управления связями между базами.
  - Большее аппаратное обеспечение и сложность конфигурации.

Если хотите, могу привести компакт план миграции: выбрать ключ шардинга, определить шард‑ключ, настроить маршрутизатор/прокси, выбрать репликацию в каждом шарде, а затем рассмотреть сценарии кросс‑шард агрегаций и мониторинг.

- Rule score: 5/7
- Verdict: good
- Matched must-have: sharding||шард, federation||федерац
- Matched nice-to-have: horizontal||горизонт

## q09: How does a Content Delivery Network reduce latency for static assets?

**Expectation:** Answer should explain that a CDN serves static content from edge locations closer to users instead of always hitting the origin.

**Expected sections:** Concepts > Content delivery network (CDN)

### Baseline (without RAG)

Cost: $0.000060 (46/144)
Rules: 7/7 (strong)
Judge: 3/3 — Ответ полностью соответствует ожиданию. Чётко объясняет, что CDN обслуживает статический контент из edge-локаций ближе к пользователю, что снижает задержку по сравнению с обращением к origin. Дополнительные детали (кеширование на краях, маршрутизация/anycast, улучшения протоколов) уточняют механизм и поддерживают основную идею без противоречий.

A CDN reduces latency for static assets by:

- Deploying many edge servers close to users, so requests travel shorter network distances.
- Caching static content (images, CSS, JS) at edge locations, serving from cache instead of origin.
- Using efficient routing and anycast to minimize hops and find the fastest path.
- Pre-warming caches and smart invalidation to keep hot content ready.
- Leveraging protocol optimizations (HTTP/2, HTTP/3, TLS termination) and gzip/br compression.
- Reducing origin server load, lowering response time when cache miss occurs (local cache miss is rarer).

- Rule score: 7/7
- Verdict: strong
- Matched must-have: CDN||content delivery network, latency||задерж
- Matched nice-to-have: edge||край, origin||origin server||исходн, static assets||статичес

### Retrieval

- Retrieved 3 chunk(s) (strategy=structural, topK=3)
  1. source=scripts/day21/data/system-design-primer.md; section=Content delivery network > Disadvantage(s): CDN; distance=0.8217
  2. source=scripts/day21/data/system-design-primer.md; section=Content delivery network > Pull CDNs; distance=0.8391
  3. source=scripts/day21/data/system-design-primer.md; section=Latency vs throughput; distance=0.8634

### RAG answer

Cost: $0.000132 (954/210)
Rules: 6/8 (good)
Judge: 3/3 — Полностью корректный и чётко привязанный к материалам ответ: объясняет, как CDN обслуживает статический контент с edge-локаций ближе к пользователю, уменьшает время до первого байта и общую задержку; упоминаются pull CDNs и кеширование TTL, что соответствует retrieval-контексту.

CDN снижает задержку статических ресурсов за счет размещения копий контента ближе к пользователю на распределённых серверах (edge servers). Это позволяет клиенту получить файл с ближайшего нода, уменьшая время до первого байта и общую задержку сетевого пути. В материалах упомянуто:

- Pull CDNs: сначала копия берётся с вашего сервера при первом запросе, затем кэшируется на CDN; последующие запросы идут к ближайшему edge-узлу, что уменьшает задержку по мере кэширования.
- TTL кэша: время жизни кэша контролирует, как долго контент остаётся на CDN; обновления могут не попасть мгновенно, если TTL ещё не истёк.

Важно: вопросы по стоимости и возможной устарелости контента тоже упомянуты в материалах, но они не напрямую объясняют снижение задержки.

- Rule score: 6/8
- Verdict: good
- Matched must-have: CDN||content delivery network, latency||задерж
- Matched nice-to-have: edge||край, static assets||статичес

## q10: What is the latency of reading 1 MB sequentially from SSD versus memory?

**Expectation:** Answer should reference the latency table and compare SSD sequential read of 1 MB with memory access, making clear that SSD is much slower than RAM.

**Expected sections:** Appendix > Latency numbers every programmer should know

### Baseline (without RAG)

Cost: $0.000100 (54/242)
Rules: 9/9 (strong)
Judge: 2/3 — В целом верно: приведены примерно правильные значения задержек для SATA/NVMe SSD и для RAM, и сделан вывод, что RAM значительно быстрее. Но ответ не ссылается на конкретную таблицу задержек и ожидаемую секцию Appendix > Latency numbers, что снижает groundedness и соответствие требуемому формату.

- SSD: Sequential read latency is dominated by transfer time plus small random access overhead. For a 1 MB read, typical SATA SSDs ~0.1–0.3 ms (100–300 µs) plus ~0.2–0.5 ms if micro‑seconds depends. NVMe SSDs are faster: ~0.05–0.15 ms (50–150 µs) for 1 MB, assuming cache can fill; real worst case higher if not cached.

- DRAM memory: Latency is tens of nanoseconds. Typical random/streaming 1–2 ns (nanoseconds) for on‑chip/cache, ~10–100 ns for DDR4/DDR5 memory access; sequential 1 MB read bandwidth the latency is just the access latency + memory controller overhead, so around 50–100 ns in modern systems.

In short: memory latency ~ tens to low hundreds of nanoseconds; SSD latency ~ tens to hundreds of microseconds (NVMe faster than SATA). Memory is ~1000x lower latency; bandwidth differences depend on size and caching.

- Rule score: 9/9
- Verdict: strong
- Matched must-have: SSD||ssd, memory||RAM||памят, 1 MB||1MB||1 МБ||1мб
- Matched nice-to-have: latency||задерж, microseconds||микросек, nanoseconds||наносек

### Retrieval

- Retrieved 3 chunk(s) (strategy=structural, topK=3)
  1. source=scripts/day21/data/system-design-primer.md; section=Latency vs throughput; distance=0.7313
  2. source=scripts/day21/data/system-design-primer.md; section=Cache > When to update the cache; distance=0.8118
  3. source=scripts/day21/data/system-design-primer.md; section=Availability patterns > Availability in numbers; distance=0.8377

### RAG answer

Cost: $0.000189 (1508/284)
Rules: 8/10 (good)
Judge: 1/3 — Ответ частично верен по тематике (SSD медленнее RAM, даются общие диапазоны задержек), но не выполняет требования: не ссылается на таблицу задержек Appendix > Latency numbers every programmer should know и не приводит конкретных чисел для чтения 1 MB последовательно с SSD и RAM из ожидаемого раздела. Также retrieval-данные не явно используются для обоснования цифр.

Найденные материалы не содержат конкретных чисел по задержке чтения 1 МБ последовательно с SSD и с памятью (RAM). В материалах обсуждаются общие понятия latency vs throughput, а также общие примеры доступности, но без апдейтов по конкретным размерам данных и устройствам.

Поэтому ответить точно по источникам не могу. Могу предложить ориентироваться на общие оценки:
- Латентность чтения последовательного блока с SSD обычно выше, чем задержка доступа к оперативной памяти, и составляет миллисекунды для больших блоков на обычных SATA/NVMe-картах в реальных системах, но точное число зависит от интерфейса, типа SSD, параллелизма и контроллера.
- Оперативная память имеет очень низкую латентность (несколько десятков наносекунд) на произвольный доступ, но для последовательного чтения 1 МБ реальная задержка включает prefetching и DRAM throughput, часто в диапазоне десятков наносекунд до сотен наносекунд.

Если хотите, могу поискать дополнительную информацию и привести конкретные диапазоны из внешних источников, либо объяснить, как измерить эти значения в вашей конфигурации.

- Rule score: 8/10
- Verdict: good
- Matched must-have: SSD||ssd, memory||RAM||памят, 1 MB||1MB||1 МБ||1мб
- Matched nice-to-have: latency||задерж, nanoseconds||наносек


# Day 22 — RAG answer comparison report

Generated at: 2026-04-14T18:44:37.083Z
RAG strategy: **structural**
RAG topK: **5**

## Final comparison summary

- Average baseline judge score: 2.80/3
- Average RAG judge score: 2.70/3
- Average baseline cost: $0.000149
- Average RAG cost: $0.000277
- Judge comparison: RAG wins 1, baseline wins 2, ties 7

## Per-question summary

| # | Question | Baseline cost | RAG cost | Baseline rules | RAG rules | Baseline judge | RAG judge | Retrieval | Expected sections |
|---|----------|---------------|----------|----------------|-----------|----------------|-----------|-----------|-------------------|
| q01 | What is the difference between cache-aside and write-through caching strategies? | $0.000137 (50/335) | $0.000316 (2992/416) | 5/7 (strong) | 5/8 (strong) | 3/3 | 3/3 | ok | Cache > When to update the cache |
| q02 | When should I use a NoSQL database instead of a SQL database? | $0.000197 (50/486) | $0.000299 (3020/369) | 4/8 (strong) | 5/9 (strong) | 3/3 | 3/3 | ok | Database > NoSQL, Database > SQL or NoSQL |
| q03 | How does master-slave database replication handle reads and writes? | $0.000076 (46/183) | $0.000282 (4406/155) | 10/10 (strong) | 3/11 (partial) | 3/3 | 3/3 | ok | Availability patterns > Replication, Database > Relational database management system (RDBMS) |
| q04 | What is the CAP theorem and what are its three properties? | $0.000084 (46/205) | $0.000235 (2832/234) | 6/7 (strong) | 6/8 (good) | 3/3 | 3/3 | ok | Principles > CAP theorem |
| q05 | How can I prevent cross-site scripting and cross-site request forgery attacks? | $0.000258 (52/639) | $0.000222 (1838/325) | 4/8 (strong) | 4/9 (good) | 3/3 | 2/3 | ok | Security > Cross-site scripting (XSS), Security > Cross-site request forgery (CSRF) |
| q06 | What is the difference between REST and RPC APIs? | $0.000137 (42/337) | $0.000279 (2102/435) | 4/7 (strong) | 5/8 (good) | 3/3 | 3/3 | ok | Communication > REST, Communication > RPC |
| q07 | What does eventual consistency mean in distributed systems? | $0.000033 (40/78) | $0.000198 (3078/109) | 4/5 (strong) | 4/6 (good) | 3/3 | 3/3 | ok | Principles > Consistency |
| q08 | How can I horizontally scale a relational database using sharding and federation? | $0.000352 (50/874) | $0.000567 (4578/845) | 6/6 (strong) | 4/7 (good) | 3/3 | 3/3 | ok | Database > Federation, Database > Sharding |
| q09 | How does a Content Delivery Network reduce latency for static assets? | $0.000057 (46/136) | $0.000178 (1616/242) | 6/7 (strong) | 2/8 (partial) | 2/3 | 3/3 | ok | Concepts > Content delivery network (CDN) |
| q10 | What is the latency of reading 1 MB sequentially from SSD versus memory? | $0.000162 (54/398) | $0.000194 (2088/224) | 8/9 (strong) | 2/10 (partial) | 2/3 | 1/3 | ok | Appendix > Latency numbers every programmer should know |

## q01: What is the difference between cache-aside and write-through caching strategies?

**Expectation:** Answer should explain that cache-aside loads data lazily on cache miss, while write-through updates cache and backing store synchronously on write. A good answer should mention trade-offs such as stale reads, simplicity, or write latency.

**Expected sections:** Cache > When to update the cache

### Baseline (without RAG)

Cost: $0.000137 (50/335)
Rules: 5/7 (strong)
Judge: 3/3 — Полностью верный и качественный ответ: объясняет, что cache-aside загружает данные lazily при miss и не обновляет кеш на запись автоматически, в то время как write-through пишет сразу в кэш и в источник данных. Приведены trade-offs: консистентность, задержка записи, простота использования и возможность устаревших данных. Соответствует ожиданиям по секции Cache > When to update the cache.

Коротко:

- Write-through caching: каждый write операция в приложении сразу записывает данные в кэш и в основной источник данных (БД). Гарантия консистентности: кэш всегда содержит актуальные данные. Медленнее на запись, требует больше ресурсов кэша, но проще для чтения.

- Cache-aside (lazy) caching: приложение читает из кэша; если данные отсутствуют (cache miss), оно загружает их из источника данных, помещает в кэш и возвращает. Запись в основном источнике данных не обязательно пишет в кэш автоматически: кэш может быть обновлён отдельно, например при записи через приложение. Консистентность менее автоматическая и требует явного обновления кэша при изменениях.

Ключевые различия:
- Где запись в кэш происходит: в write-through — автоматически вместе с записью в источник; в cache-aside — только при чтении или при явной инфляции/обновлении.
- Гарантии консистентности: write-through обеспечивает сильную консистентность между кэшем и источником; cache-aside требует доп. механизмов обновления.
- Производительность записи: write-through медленнее записи в источник; cache-aside может быть быстрее для записи, если кэш не обновляется синхронно.
- Простота использования: write-through проще для разработчика в плане консистентности; cache-aside более гибок и экономит ресурсы кэша при редких чтениях.

- Rule score: 5/7
- Verdict: strong
- Matched must-have: cache-aside, write-through
- Matched nice-to-have: lazy

### Retrieval

- Retrieved 5 chunk(s) (strategy=structural, topK=5)
  1. source=scripts/day21/data/system-design-primer.md; section=Cache > When to update the cache; distance=0.7314
  2. source=scripts/day21/data/system-design-primer.md; section=Cache > CDN caching; distance=0.7539
  3. source=scripts/day21/data/system-design-primer.md; section=Cache > When to update the cache; distance=0.7564
  4. source=scripts/day21/data/system-design-primer.md; section=Cache > Application caching; distance=0.7838
  5. source=scripts/day21/data/system-design-primer.md; section=Cache > When to update the cache; distance=0.8067

### RAG answerm tool results before

Cost: $0.000316 (2992/416)
Rules: 5/8 (strong)
Judge: 3/3 — Полный и корректный ответ: ясно объясняет, что cache-aside загружает данные лениво при промахе кэша и что запись в кэш не является автоматической для кэш-слоя, в то время как write-through выполняет синхронную запись в кэш и базу данных. Упомянуты trade-offs (устаревание данных, простота реализации, задержка записи) и добавлены упоминания о Write-behind и Refresh-ahead как дополнительных вариантах.

Ключевые различия:

- Cache-aside (ленивая загрузка)
  - Приложение читает из кэша; при отсутствии данные загружаются из БД, кэш записывается.
  - Cache не участвует в записи в хранилище автоматически; данные пишутся сначала в БД, затем в кэш (когда приложение вызывает запись, кэш может обновляться отдельно, но это не автоматическое поведение кэша).
  - Преимущества: кэш содержит только востребованные данные; простота реализации.
  - Недостатки: при промахе кэша задержка из-за триплейца (попытка-database-кую); риск устаревших данных без TTL или доп.策略.

- Write-through (запись через кэш)
  - Приложение пишет в кэш, а кэш синхронно пишет в базу данных.
  - Чтение после записи быстро, т.к. данные уже в кэше.
  - Преимущества: кэш содержит актуальные данные, меньше риск устаревания; читается быстро сразу после записи.
  - Недостатки: запись через кэш может быть медленнее; при масштабировании/сбоях новые ноды могут не иметь кэшированных данных до обновления.

Дополнительно упомянуты варианты:
- Write-behind (write-back): запись в кэш асинхронная в БД; повышает скорость записей, есть риск потери данных при сбое кэша.
- Refresh-ahead: кеш может обновлять данные до истечения TTL, чтобы снизить задержку поздних запросов.

Итого: cache-aside делает кэш вторичным к БД (кэш управляется приложением); write-through заставляет кэш быть основным местом записи и синхронно обновлять БД.

- Rule score: 5/8
- Verdict: strong
- Matched must-have: cache-aside, write-through
- Matched sections: Cache > When to update the cache

## q02: When should I use a NoSQL database instead of a SQL database?

**Expectation:** Answer should contrast SQL and NoSQL at a high level and mention that NoSQL can be a better fit for non-tabular data, large scale, flexible schema, or specific data models such as key-value/document/wide-column/graph.

**Expected sections:** Database > NoSQL, Database > SQL or NoSQL

### Baseline (without RAG)

Cost: $0.000197 (50/486)
Rules: 4/8 (strong)
Judge: 3/3 — Полный и корректный ответ: на высоком уровне сравниваются SQL и NoSQL; перечислены случаи, когда NoSQL подходит лучше: гибкая/изменяемая схема, горизонтальное масштабирование, работа с неструктурированными данными и конкретные модели (key-value/document/wide-column/graph); также указаны сценарии для SQL (ACID, сложные запросы, транзакции); даны примеры типов NoSQL и практический совет по выбору и подходу polyglot persistence.

Когда стоит выбирать NoSQL вместо SQL:

- Гибкая схема и вам нужны частые изменения структуры данных (много JSON/документов, ключ-значение без фиксированного схемы).
- Масштабируемость по горизонтали как приоритет (распределённое хранение данных, несколько узлов).
- Непрерывная схема динамическая или полуструктурированная (много полей, опциональные поля).
- Требуется высокая скорость записи и чтения для конкретного паттерна доступа (например, кэш-слой, реальное время, журнал событий).
- Работа с большими объемами данных (Big Data, логи, клики, метрики) и менее строгие требования к транзакциям.
- Нужна хранение неструктурированных данных (медиа, документы, графовые связи) без сложной SQL-модели.
- Нужна географически распределённая база с локальными чтениями в разных регионах.

Когда лучше использовать SQL:

- Тонко спроектированная, строгая схема и целостность данных (ACID).
- Сложные запросы, аналитика, множество соединений между таблицами.
- Гарантии транзакций и согласованности, строгие целостности данных.
- Многопользовательские транзакции и схемы с фиксированными отношениями.

Типовые примеры:

- NoSQL: документы (MongoDB), ключ-значение (Redis), графовые (Neo4j), широкие колонки (Cassandra), поисковые (Elasticsearch) — когда нужен гибкий контракт схемы, масштаб и скорость по конкретным паттернам.
- SQL: реляционные приложения с четкими отношениями (банковские, ERP, бухгалтерия), аналитика с сложными джойнами и транзакциями.

Совет: начинайте с требований к схеме, согласованности и масштабируемости. Если строгая схема и транзакции критичны — SQL. Если нужна гибкость, горизонтальное масштабирование и работа с большими/неструктурированными данными — NoSQL. Иногда применяют полимерный подход: хранение баз в разных слоях (polyglot persistence).

- Rule score: 4/8
- Verdict: strong
- Matched must-have: NoSQL, SQL

### Retrieval

- Retrieved 5 chunk(s) (strategy=structural, topK=5)
  1. source=scripts/day21/data/system-design-primer.md; section=Database > NoSQL; distance=0.7990
  2. source=scripts/day21/data/system-design-primer.md; section=Database > NoSQL; distance=0.8024
  3. source=scripts/day21/data/system-design-primer.md; section=Cache > Database caching; distance=0.8102
  4. source=scripts/day21/data/system-design-primer.md; section=Cache > Application caching; distance=0.8172
  5. source=scripts/day21/data/system-design-primer.md; section=Database > SQL or NoSQL; distance=0.8272

### RAG answer

Cost: $0.000299 (3020/369)
Rules: 5/9 (strong)
Judge: 3/3 — Полный и корректный ответ: объясняет на высоком уровне, когда NoSQL выгоднее SQL (слабосхемные данные, масштаб, гибкая/различные модели данных), даёт примеры применений, упоминает BASE и eventual consistency и отмечает ограничения.

Когда использовать NoSQL вместо SQL (на основе материалов):

- Когда данные «слабосхемные» или динамичные: semi-structured, гибкая схема, без необходимости сложных связей. Примеры: журналы, логи, clickstream, временные данные, метаданные. Источник 5.
- Когда требуется очень большая масштабируемость и очень высокая пропускная способность: хранение терабайт/паблионов данных, очень высокие IOPS. Источник 5.
- Когда не требуется сложных join’ов и ACID-транзакций: данные могут быть денормализованы, логику объединения держит приложение. Источник 1.
- При выборе типа NoSQL: ключ-значение, документ-ориентированные, wide-column или графовые подтипах — в зависимости от модели и доступа к данным. Источник 1.
- Для быстроходного доступа к данным, где у вас есть потребность в очень быстрых операциях чтения/записи и можно пожертвовать строгими транзакциями (BASE против ACID). Источник 1.

Примеры задач, хорошо подходящих под NoSQL: лидерборды, временные корзины покупок, часто читаемые «hot» таблицы, индексы/lookup-таблицы, хранение больших объемов данных без сложных связей. Источник 5.

Контекст/ограничения: NoSQL обычно не обеспечивает ACID в полном объёме; применяется BASE и eventual consistency. Разные подтипы NoSQL подходят под разные сценарии (ключ-значение, документы, wide-column, граф). Источник 1.

- Rule score: 5/9
- Verdict: strong
- Matched must-have: NoSQL, SQL
- Matched sections: Database > NoSQL, Database > SQL or NoSQL

## q03: How does master-slave database replication handle reads and writes?

**Expectation:** Answer should say that the master handles writes and replicas/slaves can serve reads, with replication lag or failover trade-offs mentioned if possible.

**Expected sections:** Availability patterns > Replication, Database > Relational database management system (RDBMS)

### Baseline (without RAG)

Cost: $0.000076 (46/183)
Rules: 10/10 (strong)
Judge: 3/3 — Полностью соответствует ожиданиям. Упомянуты: мастер принимает записи, реплики читают, существует лаг репликации, возможен отказоустойчивый failover, а также стратегии чтения/записи через прокси и варианты консистентности (асинхронная репликация, полубинарная/мульти-мастер и т. д.).

- Writes go to the master. All updates (insert/update/delete) are applied there.
- Reads can be served by the master or replicated slaves. In typical setups:
  - Reads are distributed to slaves to offload the master (read scaling).
  - Writes are not automatically sent to slaves; they originate on the master and are asynchronously replicated to slaves.
- Replication lag: there is usually some delay (latency) before changes on the master appear on slaves.
- Consistency: reads from slaves may be slightly stale; reads from the master are up-to-date.
- Failover: if the master fails, you may promote a slave to master (automatic or manual) and reconfigure clients.
- Common strategies: read/write splitting with a proxy, multi-master/semi-synchronous replication for stricter consistency.

- Rule score: 10/10
- Verdict: strong
- Matched must-have: writes, reads, master, replica
- Matched nice-to-have: replication lag, failover

### Retrieval

- Retrieved 5 chunk(s) (strategy=structural, topK=5)
  1. source=scripts/day21/data/system-design-primer.md; section=Availability patterns > Replication; distance=0.6379
  2. source=scripts/day21/data/system-design-primer.md; section=Database > Relational database management system (RDBMS); distance=0.6390
  3. source=scripts/day21/data/system-design-primer.md; section=Database > Relational database management system (RDBMS); distance=0.6544
  4. source=scripts/day21/data/system-design-primer.md; section=Index of system design topics; distance=0.7474
  5. source=scripts/day21/data/system-design-primer.md; section=Cache > When to update the cache; distance=0.8151

### RAG answer

Cost: $0.000282 (4406/155)
Rules: 3/11 (partial)
Judge: 3/3 — Правильно описано: мастер принимает записи, реплики/слейвы обслуживают чтение; упомянут лаг репликации и вопросы фейловера (promote-slave-to-master) и риск потери данных до репликации.

Кратко: в master-slave чтение идёт с реплик (слейвов), запись — на мастер. Мастер обрабатывает все записи и реплицирует их на слейвы, которые затем обслуживают чтение. Возможные недостатки: задержка репликации (лаг), нужно дополнительное управление promote-slave‑to‑master при падении мастера, потенциал потери данных при сбое мастера до репликации. Источники описывают: мастер-slave мастер-майстер различия, слейвы читают, мастер пишет; репликация может создавать лаг и сложность при переключении ролей.

- Rule score: 3/11
- Verdict: partial
- Matched must-have: master
- Missed must-have: writes, reads, replica
- Matched sections: Availability patterns > Replication, Database > Relational database management system (RDBMS)

## q04: What is the CAP theorem and what are its three properties?

**Expectation:** Answer should define CAP theorem and name consistency, availability, and partition tolerance.

**Expected sections:** Principles > CAP theorem

### Baseline (without RAG)

Cost: $0.000084 (46/205)
Rules: 6/7 (strong)
Judge: 3/3 — Полный и корректный ответ: дано определение CAP, перечислены три свойства (Consistency, Availability, Partition tolerance) и пояснение ограничений при разрыве сети; упомянуты возможные пары свойств (CA, AP, CP).

CAP theorem: в распределённых системах невозможно одновременно обеспечить все три свойства в любом порядке. За периодическую группу запросов система может обеспечить не более двух из трёх свойств.

Три свойства:
- Consistency (Согласованность): все узлы видят одни и те же данные в одно и то же время.
- Availability (Доступность): каждый запрос к системе получает ответ (без гарантии свежести данных).
- Partition tolerance (Толерантность к разрыву сети): система продолжает работать несмотря на сетевые разделения (разрывы между узлами).

Краткая суть: в случае сетевого разрыва можно выбрать либо Consistency + Availability (CA) или Availability + Partition tolerance (AP) или Consistency + Partition tolerance (CP); фактически в распределённых системах при разрыве сети приходится пожертвовать либо согласованностью, либо доступностью.

- Rule score: 6/7
- Verdict: strong
- Matched must-have: consistency, availability, partition tolerance

### Retrieval

- Retrieved 5 chunk(s) (strategy=structural, topK=5)
  1. source=scripts/day21/data/system-design-primer.md; section=Database > NoSQL; distance=0.8701
  2. source=scripts/day21/data/system-design-primer.md; section=Asynchronism > Source(s) and further reading; distance=0.8748
  3. source=scripts/day21/data/system-design-primer.md; section=Availability patterns > Availability in numbers; distance=0.9070
  4. source=scripts/day21/data/system-design-primer.md; section=Reverse proxy (web server) > Disadvantage(s): reverse proxy; distance=0.9109
  5. source=scripts/day21/data/system-design-primer.md; section=Reverse proxy (web server) > Source(s) and further reading; distance=0.9112

### RAG answer

Cost: $0.000235 (2832/234)
Rules: 6/8 (good)
Judge: 3/3 — Полное и корректное определение CAP теоремы и трёх свойств: Consistency, Availability, Partition tolerance; объяснение trade-off при наличии разрыва связи и упоминание BASE как альтернатива.

CAP теорема (построение распределённых систем) говорит, что в любом распределённом хранении данных нельзя одновременно обеспечить три свойства:

- C (Consistency) — единая согласованность: чтение возвращает наиболее свежие записанные данные; все узлы видят один и тот же ответ.
- A (Availability) — доступность: каждый запрос к системе получает ответ (независимо от состояния узлов).
- P (Partition tolerance) — устойчивость к сетевым разрывам: система продолжает работать при разделении сети, т.е. между кластерами возникают сетевые задержки или потери связи.

Применение CAP означает выбирать между согласованностью и доступностью в условиях сетевых разделений (PartitionTolerance обязательна для распределённых систем; в реальности её наличие принято считать данным). В документах материала упоминается BASE как альтернатива CAP, где предпочтение отдаётся доступности и eventual consistency. Если нужно — могу привести примеры trade-offs для SQL/NoSQL систем по материалу.

- Rule score: 6/8
- Verdict: good
- Matched must-have: consistency, availability, partition tolerance

## q05: How can I prevent cross-site scripting and cross-site request forgery attacks?

**Expectation:** Answer should distinguish XSS and CSRF and mention core mitigations such as sanitization/escaping for XSS and tokens/same-site protections for CSRF.

**Expected sections:** Security > Cross-site scripting (XSS), Security > Cross-site request forgery (CSRF)

### Baseline (without RAG)

Cost: $0.000258 (52/639)
Rules: 4/8 (strong)
Judge: 3/3 — Полный и корректный ответ, разделяет XSS и CSRF, охватывает основные контрмеры (санитация/экранирование, CSP, безопасные шаблоны, HttpOnly/Secure cookies для XSS; CSRF‑токены, SameSite, Referer/Origin и безопасные методы) и включает практический список действий.

Чтобы предотвратить XSS и CSRF, применяйте сочетание техник и рекомендаций:

XSS (межсайтовый скриптинг)
- Экранировать выходные данные: контент, HTML, атрибуты, URL, данные из запросов. Используйте безопасные функции вывода в фреймворке.
- Свести к минимуму доверие к входящим данным: валидируйте и санитизируйте данные.
- Используйте Content Security Policy (CSP): ограничивает выполнение скриптов и загрузку ресурсов.
- Автоматически избегайте инъекций в HTML: используйте шаблонизаторы с экранированием по умолчанию.
- Защищайте ввод: избегайте рекурсивной передачи пользовательских данных в браузер без обработки.
- Защита от XSS в URL: энкодируйте параметры URL и избегайте вставки произвольного HTML/JS в контекст.
- HTTPOnly и Secure флаги для куки: запрещают доступ к кукам через JavaScript.
- Ограничьте использование dangerouslySet/innerHTML (для React/Vue и т.д.).

CSRF (межсайтовая подделка запросов)
- Валидация CSRF-токенов: добавляйте уникальный токен в формы и проверяйте на сервере.
- SameSite куки: устанавливайте SameSite=Strict или Lax, чтобы куки не отправлялись на сторонние сайты по умолчанию.
- Проверка Referer/Origin: дополнительная проверка заголовков запроса, если это применимо.
- Использование безопасных методов: требуйте изменения состояния через POST/PUT и пр.; избегайте действий через GET.
- Двухфакторная аутентификация и MFA для критичных операций (если релевантно).
- Не полагайтесь только на пользователя, применяйте многоступенчатую защиту.

Практический список действий
- Веб-приложение:
  - Включите CSP и настройте безопасные источники.
  - Всегда экранируйте выводимые данные.
  - Используйте безопасные шаблоны/фреймворки с автоэкранованием.
  - Установите HTTPOnly и Secure для куки сессий.
  - Включите SameSite куки (например, SameSite=Strict).
  - Реализуйте и валидируйте CSRF-токены во всех изменяющих данные запросах.
  - Ограничьте доступ к API и применяйте CSRF-токены для браузерных клиентов, но не для API-ключей и сервисных аккаунтов.
  - Регулярно обновляйте зависимости, проводите статический анализ и тестируйте на XSS/CSRF.

Если у вас есть контекст (язык/фреймворк и т.д.), могу привести конкретные настройки и примеры кода.

- Rule score: 4/8
- Verdict: strong
- Matched must-have: XSS, CSRF

### Retrieval

- Retrieved 5 chunk(s) (strategy=structural, topK=5)
  1. source=scripts/day21/data/system-design-primer.md; section=Domain name system > Disadvantage(s): DNS; distance=0.7545
  2. source=scripts/day21/data/system-design-primer.md; section=Cache > Web server caching; distance=0.7863
  3. source=scripts/day21/data/system-design-primer.md; section=Security; distance=0.7974
  4. source=scripts/day21/data/system-design-primer.md; section=Application layer > Service Discovery; distance=0.8160
  5. source=scripts/day21/data/system-design-primer.md; section=Content delivery network > Push CDNs; distance=0.8464

### RAG answer

Cost: $0.000222 (1838/325)
Rules: 4/9 (good)
Judge: 2/3 — Частично верно: ответ различает XSS и CSRF и упоминает ключевые mitigations (санитация/экранирование для XSS; токены CSRF и SameSite для CSRF). Однако структура не в явном виде выделена по секциям Security > XSS/CSRF, формулировки местами расплывчатые и есть несвязанная реплика про SQL-инъекции. В целом идеи присутствуют, но оформление и полнота могли быть лучше.

Кратко: в материалах прямо по XSS/CSRF не приведены конкретные инструкции, они косвенно упоминаются в разделе Security.

Что можно извлечь из материалов:
- Применяйте базовые меры безопасности: шифрование в движении и в хранении, санитация входящих данных, использование параметризованных запросов и принцип минимума привилегий. Это косвенно помогает уменьшить риск XSS и SQL-инъекций, но не охватывает CSRF напрямую.
- Санитизация входов и защита от XSS важны: упоминается необходимость санитизации входных параметров, чтобы предотвратить XSS.
- Для CSRF в представленных материалах прямых рекомендаций нет.

 Ограничения базы: в предоставленных источниках слабый фокус на конкретных техниках предотвращения XSS/CSRF. Не могуствовать дополнительные источники из вне.

 Рекомендации (которые обычно применяются, но не подробно в материалах): 
- XSS: экранирование/санитизация входов и выходов, контентная политика безопасности (CSP), использование безопасных API для DOM, анти-XSS библиотеки.
- CSRF: использование CSRF-токенов, SameSite cookies (Lax/Strict), проверка Referer/Origin там, где возможно.

Если хотите, могу дать краткую проверочную памятку по каждому пункту без внешних источников.

- Rule score: 4/9
- Verdict: good
- Matched must-have: XSS, CSRF

## q06: What is the difference between REST and RPC APIs?

**Expectation:** Answer should compare REST as a resource-oriented style and RPC as an operation/procedure-oriented style.

**Expected sections:** Communication > REST, Communication > RPC

### Baseline (without RAG)

Cost: $0.000137 (42/337)
Rules: 4/7 (strong)
Judge: 3/3 — Полный, корректный ответ: REST — ресурс-ориентированный стиль (ресурсы через URL, стандартные HTTP-методы, stateless, чаще JSON/XML, HATEOAS); RPC — операционно-ориентированный стиль (вызов удалённой процедуры/метода, прямые вызовы функций, может работать поверх HTTP или другого транспорта и использовать свои форматы сериализации). Приведены отличия по подходу и стандартам. Есть мелкая опечатка ('журналистика' вместо 'stateless'), но она не ломает смысл.

Кратко:

- REST API
  - Архитектурный стиль. Ресурсы идентифицируются через URL, операции выполняются по стандартным HTTP-методам (GET, POST, PUT, DELETE и т. д.).
  - Основан на представлениях ресурсов и состояниях; чаще используют JSON/XML.
  - Журналистика (stateless): каждый запрос должен содержать всю необходимую информацию; сервер не хранит состояние между запросами.
  - Часто используют гипермедий (HATEOAS) и конвенции RESTful.

- RPC API
  - Функционально-ориентирован. Клиент вызывает удалённую процедуру/метод как локальный вызов.
  - Меньше абстракции над ресурсами; операции часто соответствуют конкретным методам (например, convertCurrency, getUserInfo).
  - Может быть реализован поверх HTTP (REST-like RPC, gRPC) или другой транспорт.
  - Часто менее зависим от стандартов HTTP; может использовать собственные форматы сериализации (JSON-RPC, XML-RPC, Protocol Buffers в gRPC).

Ключевые различия:
- Подход: REST — ресурс-ориентированный; RPC — вызов удалённой функции.
- Всё в HTTP-методах vs явные методы/граммвызовы.
- Стейтлесс с ресурсами vs прямые вызовы функций.
- Стандарты и конвенции REST против конкретного интерфейса RPC.

- Rule score: 4/7
- Verdict: strong
- Matched must-have: REST, RPC

### Retrieval

- Retrieved 5 chunk(s) (strategy=structural, topK=5)
  1. source=scripts/day21/data/system-design-primer.md; section=Asynchronism > Source(s) and further reading; distance=0.8893
  2. source=scripts/day21/data/system-design-primer.md; section=Content delivery network > Disadvantage(s): CDN; distance=0.9002
  3. source=scripts/day21/data/system-design-primer.md; section=Database > NoSQL; distance=0.9182
  4. source=scripts/day21/data/system-design-primer.md; section=Cache > Disadvantage(s): cache; distance=0.9187
  5. source=scripts/day21/data/system-design-primer.md; section=Content delivery network > Source(s) and further reading; distance=0.9209

### RAG answer

Cost: $0.000279 (2102/435)
Rules: 5/8 (good)
Judge: 3/3 — Ответ полностью и точно сравнивает REST как стиль, ориентированный на ресурсы и их представления, с RPC как моделью вызова удалённых операций; приводятся ключевые различия (ресурсы vs операции, HTTP-методы vs произвольные вызовы, соответствие HTTP, статeless/кэширование, версионирование). Упомянуты ограничения источников.

В найденных материалах прямого описания различий REST и RPC нет. Поэтому отвечу кратко по сути и отмечу ограниченность источников.

Кратко:
- REST (Representational State Transfer) – архитектурный стиль для веб‑API, основанный на ресурсах (URN/URL), операциях только через стандартные HTTP‑методы (GET, POST, PUT, DELETE и т. д.), самодостаточность ответов, гипермедиа (HATEOAS) может присутствовать. Обычно речь идёт об работе с ресурсами и репрезентациями их состояний.
- RPC (Remote Procedure Call) – моделирует вызов удалённой процедуры/функции как локального вызова. Часто ориентирован на действия/методы, не обязательно ограничен ресурсами, может использовать любые интерфейсы и уровни абстракции. В REST‑контексте это чаще воспринимается как «многочисленные RPC‑конец точки» поверх HTTP, но без строгой привязки к ресурсам.

Основные практические различия (общий консенсус):
- Структура: REST опирается на ресурсы и представления; RPC — на вызов конкретной операции.
- Операции: REST использует стандартные HTTP‑методы; RPC может использовать любой набор методов, чаще передает параметры в теле запроса.
- Соответствие HTTP: REST‑API хорошо вписываются в принципы HTTP («stateless», кэшируемость, адресуемость ресурса); RPC не обязан следовать этим принципам и может не использовать кэширование на уровне HTTP.
- Эволюция: REST обычно более гибок к изменениям ресурсов и версионированию через URL/представления; RPC может требовать версионирования операций.

Ограничение: в предоставленных материалах нет детального объяснения REST/RPC. Если нужен более точный разбор, могу привести внешние источники или расписать примеры.

- Rule score: 5/8
- Verdict: good
- Matched must-have: REST, RPC
- Matched nice-to-have: procedure

## q07: What does eventual consistency mean in distributed systems?

**Expectation:** Answer should define eventual consistency as a weaker consistency model where replicas converge over time if no new updates arrive.

**Expected sections:** Principles > Consistency

### Baseline (without RAG)

Cost: $0.000033 (40/78)
Rules: 4/5 (strong)
Judge: 3/3 — Полное и корректное определение: описана слабость модели, что реплики сходятся со временем при отсутствии новых обновлений, чтения могут возвращать устаревшие значения, отсутствует гарантия мгновенной консистентности.

Eventual consistency means that in a distributed system, updates to data may not be immediately visible everywhere, but if no new updates occur, all replicas will eventually converge to the same value. Reads may return stale data temporarily, and there is no guarantee of instant consistency; the system guarantees convergence over time.

- Rule score: 4/5
- Verdict: strong
- Matched must-have: eventual consistency
- Matched nice-to-have: replicas, converge

### Retrieval

- Retrieved 5 chunk(s) (strategy=structural, topK=5)
  1. source=scripts/day21/data/system-design-primer.md; section=Availability vs consistency; distance=0.6731
  2. source=scripts/day21/data/system-design-primer.md; section=Consistency patterns; distance=0.7491
  3. source=scripts/day21/data/system-design-primer.md; section=Availability patterns; distance=0.8698
  4. source=scripts/day21/data/system-design-primer.md; section=Database > NoSQL; distance=0.8713
  5. source=scripts/day21/data/system-design-primer.md; section=Performance vs scalability; distance=0.8963

### RAG answer

Cost: $0.000198 (3078/109)
Rules: 4/6 (good)
Judge: 3/3 — Полное и корректное объяснение eventual consistency: описано, что реплики не немедленно отражают запись, используются асинхронные propagation, данные могут быть устаревшими на промежуточном этапе, и что реплики сходятся со временем при отсутствии новых обновлений; упоминание контекста CAP/AP уместно.

Eventual consistency means: after you write data, not all reads reflect that write immediately. The system propagates updates asynchronously, and over time (often milliseconds) all replicas converge to the same latest value. During the interim, reads may return stale data, but with no new writes, the data will become consistent eventually. This is common in highly available, partition-tolerant systems (AP in CAP), where reads return something quickly and writes propagate later.

- Rule score: 4/6
- Verdict: good
- Matched must-have: eventual consistency
- Matched nice-to-have: replicas, converge

## q08: How can I horizontally scale a relational database using sharding and federation?

**Expectation:** Answer should explain both federation and sharding as ways to split data across multiple databases or partitions to scale horizontally.

**Expected sections:** Database > Federation, Database > Sharding

### Baseline (without RAG)

Cost: $0.000352 (50/874)
Rules: 6/6 (strong)
Judge: 3/3 — Полный и корректный обзор sharding и federation: охватываются ключевые концепции, архитектурные паттерны, маршрутизация запросов, обработка кросс-шард транзакций, вопросы согласованности, операционные соображения и примеры потоков. Соответствует ожиданиям и секциям (Database > Federation, Database > Sharding).

Here’s a concise guide to horizontal scaling with sharding and federation for a relational DB:

1) Decide goals and constraints
- Workload characteristics: read/write ratio, hot keys, cross-tenant data.
- Consistency requirements (ACID vs eventual).
- Operational complexity and tooling.

2) Sharding (data partitioning)
- Choose shard key: pick a field that evenly distributes data and aligns with queries (e.g., user_id, tenant_id). Avoid high cardinality that causes hotspots.
- Partition strategy:
  - Hash-based sharding: simple, even distribution, but cross-shard queries require routing.
  - Range/consistent hashing: preserves locality for range queries, but can imbalance with skew.
- Shard topology:
  - Horizontal shards: each shard is a full relational DB instance with its own storage and compute.
  - Registry/metadata service: keeps mapping of shards and shard keys to physical nodes.
- Query routing:
  - Application-side: route queries to appropriate shard(s) based on shard key.
  - Middleware/DB proxy: transparent routing, can handle cross-shard joins at higher layers (or reject).
- Cross-shard operations:
  - Avoid or decompose: multi-shard transactions are costly; use saga patterns or eventual consistency for cross-shard updates.
  - Replication: keep read replicas per shard to scale reads.

3) Federation (logical aggregation across shards)
- Federation layer:
  - Virtual views or federated queries that join data from multiple shards.
  - Use a query planner to push filters to shards to minimize data transfer.
- Approaches:
  - Application-level federation: fetch data from shards and assemble results in app layer.
  - DB-level federation: use a federated query engine or a gateway that can run distributed joins.
- Trade-offs:
  - Pros: can scale reads and maintain single schema view.
  - Cons: cross-shard joins are expensive; may require denormalization or data duplication.

4) Schema design practices
- Denormalize where it pays off for most queries; keep most hot paths within a shard.
- Use shard-friendly primary keys (composite keys with shard key).
- Maintain consistent lookup tables in each shard or centralized metadata.

5) Consistency and transactions
- Prefer local transactions within a shard.
- For cross-shard updates, use eventual consistency patterns (sagas, compensating actions).
- Use distributed transaction coordinators only if the workload requires strong cross-shard ACID (complex and costly).

6) Operational considerations
- Shard provisioning: add/remove shards with minimal downtime; re-sharding (reshard) strategies.
- Rebalancing: move data between shards with minimal impact; handle re-routing logic.
- Monitoring: shard-level metrics (latency, QPS, hot shards), cross-shard query costs.
- Backups and restores per shard; global restore plan.
- Failover: shard-level replication (primary/standby) and automated failover.

7) Tools and patterns
- Database options: MySQL NDB, Vitess (scaling MySQL with sharding and federation), CockroachDB (built-in sharding with distributed transactions), YugabyteDB (SQL with distributed transactions).
- Federation/query engines: Presto/Trino, Apache Drill, distributed SQL bridges.
- Orchestration: Kubernetes for deployment, service mesh for routing, and a metadata service (Zookeeper/etcd) for shard mapping.

8) Example flows
- Read: determine shard by key, query shard, optionally query replicas for read scaling.
- Write within shard: single SHARD-transaction; commit locally.
- Cross-shard read: send subqueries to relevant shards, assemble at gateway.
- Cross-shard write: orchestrate via saga; publish events to compensate on failure.

9) When to use
- Use sharding when data volume or throughput outgrows a single node and you can model access patterns around shard keys.
- Use federation when you need a unified view across shards or when joining data across tenants without duplicating data.

If you share your stack (DB type, workload, query patterns), I can suggest a concrete shard key, shard count, and a simple federation plan.

- Rule score: 6/6
- Verdict: strong
- Matched must-have: sharding, federation
- Matched nice-to-have: horizontal, partition

### Retrieval

- Retrieved 5 chunk(s) (strategy=structural, topK=5)
  1. source=scripts/day21/data/system-design-primer.md; section=Load balancer > Horizontal scaling; distance=0.7075
  2. source=scripts/day21/data/system-design-primer.md; section=Database > Relational database management system (RDBMS); distance=0.7313
  3. source=scripts/day21/data/system-design-primer.md; section=Database > Relational database management system (RDBMS); distance=0.7337
  4. source=scripts/day21/data/system-design-primer.md; section=Database > Relational database management system (RDBMS); distance=0.7530
  5. source=scripts/day21/data/system-design-primer.md; section=Index of system design topics; distance=0.8311

### RAG answer

Cost: $0.000567 (4578/845)
Rules: 4/7 (good)
Judge: 3/3 — Ответ полно охватывает обе концепции: шардинг и федерацию, объясняет, зачем и как реализовать горизонтальное масштабирование RDBMS через разделение данных, маршрутизацию запросов и агрегацию результатов. Раскрыты архитектурные подходы, компромиссы, проблемы кросс-шардовых операций, репликация для отказоустойчивости, а также рекомендации по денормализации/материализованным представлениям.

Кратко: можно использовать шардирование (sharding) и федерацию (federation) для горизонтального масштабирования RDBMS. Опираясь на материалы:

Что такое и зачем
- Шардирование: разделение данных по нескольким базам данных (шартам) так, чтобы каждая хранела subset данных. Уменьшаются нагрузка и размер индексов, появляется параллелизм записи/чтения. В случае отказа одного шарда остальные работают. Требуется репликация для надежности.
- Федерация: чтение/запись через несколько баз данных без единого центрального мастера. Позволяет писать в paralelo, снижает перегрузку на одном узле, но добавляет сложность в логику маршрутизации запросов и сборки данных.

Как реализовать на практике (из материалов)
1) Архитектура и выбор стратегии
- Определите ключ для шардинга (например, по фамилии начальной букве или по географии). Это иллюстрировано в материалах как типовые подходы к шардингу.
- Решите, нужна ли федерация в дополнение к шардингу (федерация позволяет объединять данные из разных баз, но добавляет сложность в joins и запросы).

2) Разделение и маршрутизация
- В приложении внедрите логику выбора шарда для чтения/записи на основании шардинг-ключа.
- Для федерации добавьте слой, который направляет запросы в соответствующие источники и агрегирует результаты.

3) Потребности и компромиссы
- Шардирование и федерация снижают нагрузку на отдельные базы, уменьшают репликацию и улучшают кеширование, но требуют:
  - обновления бизнес-логики для работы с несколькими источниками;
  - сложностей с кросс-шардовыми join’ами (или их избегания через денормализацию/материализованные представления);
  - балансировки нагрузки и ребалансировки shard’ов (использование концепции консистентного хеширования снижает перераспределение данных).
- Рассмотрите денормализацию и/или материализованные представления для уменьшения кросс-шардовых операций и ускорения частых запросов.

4) Надежность и согласованность
- В мастер-слейв или мастер-майстер подходах есть компромиссы между доступностью и консистентностью. Шарды сами по себе обеспечивают параллельность записи, но может потребоваться репликация между шардами для отказоустойчивости.

5) Проблемы и ограничения
- Шардинг добавляет сложность в SQL-запросы и может привести к неравномерной нагрузке между шардами; ребалансировка и сложные кросс-шардовые операции требуют дополнительной логики.
- Федерирование может быть неэффективно при сложных схемах или больших функций/таблиц, сложнее выполнять joins across databases.

Итого
- Для горизонтального масштабирования RDBMS применяйте шардирование для разделения данных по множеству баз, с параллельной записью и чтением.
- При необходимости объединяйте данные из нескольких баз через федерацию, но готовьтесь к усложнениям в маршрутизации и соединению данных.
- Везде используйте репликацию для отказоустойчивости, подумайте о консистентном хешировании для минимизации перераспределения данных при ребалансировке.
- Применяйте денормализацию/материализованные представления там, где важна скорость чтения и нужна минимизация кросс-шардовых joins.

Если хотите, могу привести схему типичной архитектуры с примером ключа шардинга и примером запроса, основываясь на материалах.

- Rule score: 4/7
- Verdict: good
- Matched must-have: sharding, federation

## q09: How does a Content Delivery Network reduce latency for static assets?

**Expectation:** Answer should explain that a CDN serves static content from edge locations closer to users instead of always hitting the origin.

**Expected sections:** Concepts > Content delivery network (CDN)

### Baseline (without RAG)

Cost: $0.000057 (46/136)
Rules: 6/7 (strong)
Judge: 2/3 — Ответ в целом верно объясняет, как edge‑локации и кэширование уменьшают задержку и другие техники. Но одна деталь некорректна: упоминание HTTP/2/5 — такого стандарта нет (правильно: HTTP/2 и/или HTTP/3).

A CDN reduces latency for static assets by:
- Caching content at distributed edge servers close to users, so requests travel shorter network distances.
- Serving content from the nearest edge cache, reducing round-trip time.
- Using optimized delivery paths and peering to avoid congested routes.
- Supporting HTTP/2/5 and multiplexing, improving transfer efficiency.
- Implementing smart routing and health checks to avoid downed or slow nodes.
- Compressing and optimizing assets (on-edge) to reduce payload size.
- Prefetching/pushing popular content to edge nodes based on traffic patterns.

- Rule score: 6/7
- Verdict: strong
- Matched must-have: CDN, latency
- Matched nice-to-have: edge, static assets

### Retrieval

- Retrieved 5 chunk(s) (strategy=structural, topK=5)
  1. source=scripts/day21/data/system-design-primer.md; section=Content delivery network > Disadvantage(s): CDN; distance=0.8217
  2. source=scripts/day21/data/system-design-primer.md; section=Content delivery network > Pull CDNs; distance=0.8391
  3. source=scripts/day21/data/system-design-primer.md; section=Latency vs throughput; distance=0.8634
  4. source=scripts/day21/data/system-design-primer.md; section=Availability patterns > Fail-over; distance=0.8794
  5. source=scripts/day21/data/system-design-primer.md; section=Load balancer > Disadvantage(s): load balancer; distance=0.8821

### RAG answer

Cost: $0.000178 (1616/242)
Rules: 2/8 (partial)
Judge: 3/3 — Полный и корректный ответ: объясняет, что CDN снижает задержку за счёт размещения копий ближе к пользователям на edge/PoP, кэширования на краях сети (TTL) и варианта pull CDN с кешированием после первого запроса; также упоминается влияние TTL и возможная задержка до заполнения кеша.

К CDN уменьшает задержку для статических активов, в основном за счёт:

- Размещение копий контента ближе к пользователю в распределённой сети точек присутствия (PoP), что снижает время передачи по дальним маршрутам.
- Кэширование контента на краях сети (TTL/кэширование), чтобы повторные запросы обслуживались локально без обращения к оригинальному серверу.
- Возможности pull CDN: сначала контент запрашивается у вашего сервера, затем кэшируется на CDN, уменьшая задержки для последующих запросов.

Примечания из материалов:
- Pull CDN: сначала запрос к вашему серверу, потом кэш на CDN (может быть задержка до кэширования) и TTL для обновления.
- TTL управляет временем кэширования и влияет на устаревание контента и повторные запросы к CDN.

Ограниченность базы: материалы упоминают плюсы/минусы и механизм кэширования, но не дают числовых примеров или альтернативных подходов.

- Rule score: 2/8
- Verdict: partial
- Matched must-have: CDN
- Missed must-have: latency

## q10: What is the latency of reading 1 MB sequentially from SSD versus memory?

**Expectation:** Answer should reference the latency table and compare SSD sequential read of 1 MB with memory access, making clear that SSD is much slower than RAM.

**Expected sections:** Appendix > Latency numbers every programmer should know

### Baseline (without RAG)

Cost: $0.000162 (54/398)
Rules: 8/9 (strong)
Judge: 2/3 — В ответе в целом верные диапазоны латентности RAM и SSD и явное указание, что SSD существенно медленнее RAM. Прямой ссылки на ожидаемую таблицу lateny в Appendix отсутствует; формулировки местами смазаны (разграничение задержки и пропускной способности, равно как и связь с конкретной таблицей). При желании можно сделать более чёткую привязку к таблице и дать единый итоговый пример времени чтения 1 МБ.

Short answer:
- 1 MB sequential read from RAM: latency is dominated by memory access granularity; typical random L1/L2 latencies are ~1–100 ns. Sequential prefetch makes effective latency effectively near 2–10 ns for cache, but main memory access (DRAM) is ~50–100 ns.
- 1 MB sequential read from SSD: latency is on the order of tens to hundreds of microseconds, plus transfer time. Random access to SSD is ~100 µs–1 ms; sequential read throughput is high (hundreds of MB/s to a few GB/s), so time = 1 MB / bandwidth plus startup latency.

Concrete ballpark:
- RAM (DRAM, in a modern system): latency ~50–100 ns for a DRAM access; if data already cached (L1/L2/L3), effective latency ~1–10 ns.
- SSD (SATA): around 100–400 µs startup latency, sustained sequential read bandwidth ~500 MB/s to 3 GB/s depending on device; 1 MB would take ~2–3 ms at 500 MB/s. NAND-based NVMe SSDs can have lower startup but still tens of microseconds, with 1 MB transfer taking a few hundred microseconds to a few milliseconds depending on queue depth and bandwidth.

If you assume no caching and pure sequential:
- RAM: ~60 ns (DRAM) – effectively almost instantaneous.
- SSD: ~100 µs to 1 ms startup plus 1 MB / bandwidth (e.g., 1 MB / 1 GB/s = 1 ms). So total ~1–3 ms.

Note: exact numbers vary by device, interface (SATA vs NVMe), queue depth, and whether data is cold or warm. If you want a specific model, tell me the SSD type and memory type.

- Rule score: 8/9
- Verdict: strong
- Matched must-have: SSD, memory, 1 MB
- Matched nice-to-have: latency, microseconds

### Retrieval

- Retrieved 5 chunk(s) (strategy=structural, topK=5)
  1. source=scripts/day21/data/system-design-primer.md; section=Latency vs throughput; distance=0.7313
  2. source=scripts/day21/data/system-design-primer.md; section=Cache > When to update the cache; distance=0.8118
  3. source=scripts/day21/data/system-design-primer.md; section=Availability patterns > Availability in numbers; distance=0.8377
  4. source=scripts/day21/data/system-design-primer.md; section=Asynchronism > Source(s) and further reading; distance=0.8436
  5. source=scripts/day21/data/system-design-primer.md; section=Appendix; distance=0.8635

### RAG answer

Cost: $0.000194 (2088/224)
Rules: 2/10 (partial)
Judge: 1/3 — Не даёт конкретных цифр и не ссылается на Appendix с числами задержек; отсутствует явное сравнение SSD против RAM, как требовалось.

В найденных материалах прямого числа латентности чтения 1 МБ последовательно с SSD и с ОЗУ не приведено. Упоминания относятся к общим понятиям латентности и пропускной способности, без конкретных цифр по устройствам.

- Источник 1: объясняет разницу между латентностью и пропускной способностью, без конкретных значений для SSD или памяти.
- Остальные источники также обсуждают концепции и общие принципы, без чисел.

Следовательно, в имеющейся базе нет конкретной цифры для:
- латентности чтения 1 МБ последовательно с SSD
- латентности чтения 1 МБ последовательно из памяти

Если нужно, могу привести ориентировочные оценки на основе типичных диапазонов из общих знаний (например, за счет скорости последовательного чтения SSD и памяти), но это будет отдельной оценкой и не основано на приведённых источниках.

- Rule score: 2/10
- Verdict: partial
- Matched must-have: SSD
- Missed must-have: memory, 1 MB


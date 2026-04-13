# Plan: День 21 — Индексация документов

> Source PRD: `.ai/prd/day-21-document-indexing.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **Архитектура**: гекс-слои как в остальном проекте. Новые порты в `domain/ports`, реализации стораджа в `storage/sqlite`, внешние интеграции в `api/*`, оркестрация в `domain/services`.
- **Новые порты**: `Chunker`, `Embedder`, `VectorIndex`. `IndexingService` зависит только от этих трёх портов и ни от чего больше.
- **Schema**: одна обычная таблица `chunks (id, strategy, source, title, section, chunk_index, char_start, char_end, text)` + виртуальная таблица `chunk_vectors USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[1024])`. Связь по `chunk_id`.
- **Strategy column**: обе стратегии chunking живут в одной таблице, различаются полем `strategy` (`'fixed' | 'structural'`). Retrieval фильтрует по стратегии.
- **Vector store**: SQLite с расширением `sqlite-vec`, загружается через `loadExtension` в существующее соединение `getDb()`. Размерность фиксирована — 1024 (bge-m3).
- **Embeddings provider**: Ollama через прямой HTTP POST на `{baseUrl}/api/embeddings`. Никакого SDK. Модель `bge-m3`.
- **Config**: все настройки индексации хранятся в существующей KV-таблице `options` через `SqliteOptionsRepository`. Все ключи имеют хардкод-фолбэки.
- **Ключи настроек**: `indexing.chunk.fixed.size`, `indexing.chunk.fixed.overlap`, `indexing.chunk.structural.primaryLevel`, `indexing.chunk.structural.splitLevel`, `indexing.chunk.structural.maxSize`, `indexing.embeddings.provider`, `indexing.embeddings.model`, `indexing.embeddings.baseUrl`, `indexing.embeddings.dim`.
- **Corpus**: закоммиченный `scripts/day21/data/system-design-primer.md` (CC BY 4.0, с файлом атрибуции рядом). Англоязычный, ~109 KB.
- **CLI**: две команды в существующем CLI-роутере — `index <file> --strategy <fixed|structural>` и `eval`.
- **Ground truth**: `scripts/day21/test-queries.json` — 10 запросов с `expected_section_contains` и `expected_keywords`.
- **Metrics**: Recall@3 (попадание хоть одного релевантного чанка в топ-3) + MRR + базовая статистика размеров и времени индексации.
- **Report**: `scripts/day21/report.md` коммитится в репо после живого прогона.
- **Testing policy**: юнит всего с моками / in-memory SQLite / синтетическими векторами. Живой прогон (реальный Ollama, реальный документ, реальный отчёт) — только вручную через CLI, не в CI.

---

## Phase 1: Tracer bullet — сквозная индексация стратегией fixed

**User stories**: 1, 3, 4, 5, 6, 7, 9, 10, 17, 20, 21, 22, 23, 25, 26

### What to build

Первый сквозной путь через всю вертикаль: миграция БД, порт и реализация `VectorIndex`, `FixedSizeChunker`, `OllamaEmbedder`, оркестратор `IndexingService` и CLI-команда `index <file> --strategy fixed`.

Поведение после фазы: пользователь запускает `bun run src/main.ts index scripts/day21/data/system-design-primer.md --strategy fixed`, пайплайн читает файл, режет его скользящим окном 1500 символов с overlap 200, отправляет чанки батчами в локальный Ollama `bge-m3`, сохраняет чанки с метаданными и векторы в SQLite. В конце CLI печатает статистику: количество чанков, средний/мин/макс размер, общее время. На эту же фазу подключается таблица `options` — все параметры (размер чанка, overlap, URL Ollama, модель, размерность) читаются из БД с фолбэками.

Структурная стратегия в этой фазе не реализуется — в таблице чанков колонка `strategy` физически есть, но принимает только значение `'fixed'`.

### Acceptance criteria

- [ ] Новая миграция создаёт таблицу `chunks` и виртуальную таблицу `chunk_vectors` через sqlite-vec
- [ ] Расширение `sqlite-vec` загружается при инициализации БД; если loadExtension падает под Bun — задокументировать проблему и сделать осознанный фолбэк (ручной косинус поверх BLOB-колонки), не меняя интерфейс порта
- [ ] Порт `VectorIndex` объявлен в `domain/ports` с операциями `upsert(chunksWithVectors)` и `search(queryVector, k, filter)`
- [ ] `SqliteVectorIndex` реализует порт; покрыт юнит-тестами с реальной in-memory SQLite и синтетическими векторами (`[1,0,...]`, `[0,1,...]`, `[0,0,1,...]`)
- [ ] Порт `Chunker` объявлен, `FixedSizeChunker` его реализует; покрыт юнит-тестами на boundary cases (пустой вход, меньше размера, кратный размер, overlap реально перекрывается, title извлекается из первого `# ...`)
- [ ] Порт `Embedder` объявлен, `OllamaEmbedder` его реализует через HTTP POST на `/api/embeddings`; юнит-тест с моком `fetch` проверяет формат запроса и парсинг ответа
- [ ] `IndexingService` композит трёх портов; юнит-тест с фейковыми реализациями проверяет порядок вызовов и сохранение всех чанков
- [ ] Все параметры индексации читаются через `SqliteOptionsRepository` с хардкод-фолбэками
- [ ] CLI-команда `index <file> --strategy fixed` подключена к роутеру и запускает `IndexingService`
- [ ] После выполнения CLI печатает: кол-во чанков, средний/мин/макс размер, общее время
- [ ] Все юнит-тесты зелёные
- [ ] Ручная верификация: команда реально отрабатывает на `scripts/day21/data/system-design-primer.md`, в БД появляются ~80 чанков со стратегией `fixed` и столько же строк в `chunk_vectors`

---

## Phase 2: Вторая стратегия — структурный markdown chunker

**User stories**: 2, 8, 18, 19, 24

### What to build

Добавляем вторую реализацию порта `Chunker` — `StructuralMarkdownChunker`. Парсит markdown построчно (регулярками по `^#+ `), поддерживает стек заголовков H1/H2/H3, первично режет документ на секции между `##`, при превышении `maxSize` дорезает секцию по `###`. Для каждого чанка заполняет `title` (H1), `section` (breadcrumb `"H2"` или `"H2 > H3"`), `char_start`, `char_end`. Пустые секции отбрасываются.

Подключается к существующему CLI через флаг `--strategy structural`. Обе стратегии сосуществуют в одном индексе — `strategy` колонка их разделяет. Повторный запуск той же стратегии должен быть идемпотентным на уровне логики (как минимум — не должен дублировать чанки; способ реализации — на усмотрение, проще всего удалять строки текущей стратегии перед upsert).

### Acceptance criteria

- [ ] `StructuralMarkdownChunker` реализует существующий порт `Chunker`
- [ ] Юнит-тесты покрывают: документ без заголовков (один чанк, пустая секция), H1 + два H2 (два чанка, корректный breadcrumb и title), секция > maxSize с H3 внутри (дорезается), секция > maxSize без H3 (возвращается одним большим чанком — зафиксировать в тесте), корректность `char_start`/`char_end`
- [ ] `--strategy structural` подключён к CLI и идёт через тот же `IndexingService`
- [ ] Повторный прогон одной и той же стратегии не дублирует чанки в БД
- [ ] Обе стратегии физически сосуществуют в таблице `chunks` после последовательного прогона двух команд
- [ ] Ручная верификация: `SELECT strategy, COUNT(*) FROM chunks GROUP BY strategy` показывает обе группы, числа одного порядка (~80–110 каждая)

---

## Phase 3: Evaluation harness

**User stories**: 11, 12, 13, 14, 15, 16

### What to build

Тестовый набор и механизм сравнения стратегий. Создаётся файл `scripts/day21/test-queries.json` с 10 запросами, каждый несёт `id`, `query`, `expected_section_contains` (массив подстрок, ожидаемых в поле `section`) и `expected_keywords` (массив ключевых слов, ожидаемых в тексте чанка). Запросы составляются вручную по известным разделам system-design-primer (caching, CAP theorem, replication, security, CDN, и т. д.).

Новая CLI-команда `eval`: загружает запросы, эмбеддит каждый через тот же `Embedder`, для каждой стратегии делает `VectorIndex.search(vec, k=3, filter={strategy})`, считает метрики и формирует markdown-отчёт. Запрос считается попавшим, если хотя бы один из top-3 чанков либо содержит одну из подстрок `expected_section_contains` в поле `section`, либо содержит одно из `expected_keywords` в тексте (case-insensitive). Recall@3 — доля попавших запросов. MRR — среднее `1/rank_first_hit`, где rank ∈ {1,2,3} или 0 если не попал.

Формат отчёта `scripts/day21/report.md`: (1) summary-таблица со строками по двум стратегиям и колонками `chunks, avg_size, min_size, max_size, index_time_ms (если доступно), recall@3, MRR`, (2) 2–3 примера запросов с top-3 результатами от каждой стратегии (показываем `section` + первые ~150 символов текста).

В этой фазе `eval` ещё не обязан давать финальные цифры для коммита — достаточно, чтобы команда работала и генерировала валидный отчёт на том, что уже есть в индексе.

### Acceptance criteria

- [ ] Файл `scripts/day21/test-queries.json` содержит 10 запросов с заполненными `expected_section_contains` и `expected_keywords`
- [ ] CLI-команда `eval` подключена к роутеру
- [ ] `eval` эмбеддит каждый запрос через тот же `Embedder` с настройками из `options`
- [ ] Для каждой стратегии `eval` делает top-3 retrieval через `VectorIndex.search` с фильтром по стратегии
- [ ] Recall@3 и MRR считаются по правилам из описания
- [ ] Отчёт сохраняется в `scripts/day21/report.md` — таблица + 2–3 качественных примера
- [ ] Тот же отчёт печатается в stdout
- [ ] Юнит-тесты: функция расчёта метрик (Recall@3, MRR) покрыта на синтетических данных — «все попали», «ни один не попал», «первый попал», «третий попал»
- [ ] Ручная верификация: `eval` отрабатывает без ошибок после того, как обе стратегии проиндексированы

---

## Phase 4: Живой прогон + атрибуция + коммит

**User stories**: 27, 28

### What to build

Финальная сборка дня. Рядом с корпусом кладётся `scripts/day21/data/ATTRIBUTION.md` — автор (Donne Martin), ссылка на оригинал репозитория, лицензия (CC BY 4.0), дата скачивания. Выполняется ручной сквозной прогон:

1. `bun run src/main.ts index scripts/day21/data/system-design-primer.md --strategy fixed`
2. `bun run src/main.ts index scripts/day21/data/system-design-primer.md --strategy structural`
3. `bun run src/main.ts eval`

Получившийся `report.md` проверяется глазами на адекватность (цифры разумные, примеры выглядят осмысленно), при необходимости корректируются запросы в `test-queries.json` и прогон повторяется. Финальная версия `report.md` коммитится.

Если во время прогона выявляются явные проблемы качества (обе стратегии показывают ужасный Recall), они не чинятся «подгонкой» запросов — фиксируются в отчёте как наблюдение, и либо чинятся отдельным коммитом (если причина в коде), либо оставляются как честный результат эксперимента.

### Acceptance criteria

- [ ] `scripts/day21/data/ATTRIBUTION.md` создан и содержит автора, ссылку, лицензию, дату
- [ ] Ручной прогон трёх команд проходит без ошибок на чистой БД
- [ ] `scripts/day21/report.md` содержит реальные цифры для обеих стратегий
- [ ] Цифры sanity-check: количество чанков одного порядка для обеих стратегий, Recall@3 ненулевой хотя бы для одной стратегии, MRR в пределах [0, 1]
- [ ] Качественные примеры в отчёте выглядят осмысленно (retrieval возвращает секции, тематически близкие к запросу)
- [ ] Итоговый `report.md` закоммичен вместе с `test-queries.json`, корпусом и `ATTRIBUTION.md`
- [ ] Проект собирается и все юнит-тесты зелёные перед финальным коммитом дня

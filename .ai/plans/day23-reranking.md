# Plan: Day 23 — Реранкинг и фильтрация

> Source PRD: `.ai/prd/day23-reranking.md`

## Architectural decisions

- **Pipeline model**: `RagPipelineService` оркестрирует цепочку стадий (rewrite → search → threshold → rerank). Реализует интерфейс `RagRetriever`, чтобы подключиться к существующему evaluation framework без изменений.
- **Конфигурация режима**: тип `RagMode` описывает какие стадии включены и их параметры (threshold, topK initial/final, reranker model). Каждый из 5 режимов — экземпляр `RagMode`.
- **Ollama LLM client**: для reranker и query rewrite нужен LLM-вызов через Ollama (не embedding). Используем OpenAI-compatible API Ollama (`/v1/chat/completions`). Отдельный lightweight client или переиспользование существующего `OpenAILLMClient` с другим baseURL.
- **Расширение RagRetrieveResult**: добавляются поля `rewrittenQuery?`, `hitsBeforeFilter?`, `filterDetails?` для трассировки pipeline.
- **Entry point**: `scripts/day23/run-eval.ts` — новый скрипт. Отчёт → `scripts/day23/report.md`.
- **Контрольные вопросы**: импорт из `scripts/day22/control-questions.json` (не копируем).
- **TopK defaults**: initial=10 (кандидатный пул), final=3 (финальный контекст).

---

## Phase 1: Pipeline skeleton + ThresholdFilter → 3 режима

**User stories**: 1, 2, 6, 7, 10, 14

### What to build

Тонкий вертикальный срез через все слои: от нового pipeline-сервиса до evaluation-скрипта с отчётом.

**ThresholdFilter** — чистая функция: принимает `VectorSearchHit[]` и порог distance, возвращает отфильтрованный массив. Чанки с `distance > threshold` отсекаются.

**RagPipelineService** — оркестратор, реализующий `RagRetriever`. Принимает `RagMode` (конфигурацию режима) и выполняет pipeline. В Phase 1 поддерживает две стадии: vector search и threshold filter. Стадии включаются/выключаются через конфиг режима.

**Evaluation script** (`scripts/day23/run-eval.ts`) — запускает evaluation по 3 режимам: baseline, rag-plain, rag-threshold. Baseline вычисляется один раз и переиспользуется. Генерирует Markdown-отчёт со сравнительной таблицей.

Перед реализацией: посмотреть распределение distances в существующих результатах Day 22, чтобы выбрать начальный threshold.

### Acceptance criteria

- [ ] ThresholdFilter отсекает чанки с distance выше порога (unit test)
- [ ] ThresholdFilter корректно обрабатывает пустой вход и граничные значения (unit test)
- [ ] RagPipelineService реализует `RagRetriever` и выполняет pipeline по конфигу режима
- [ ] Evaluation script запускается и выдаёт отчёт по 3 режимам
- [ ] Baseline вычисляется один раз и переиспользуется для всех режимов
- [ ] Отчёт содержит per-question judge scores и aggregate сравнение режимов
- [ ] Проект собирается без ошибок

---

## Phase 2: LLM Reranker → 4 режима

**User stories**: 3, 4, 12

### What to build

**LlmRerankerService** — принимает query и массив `VectorSearchHit[]`, для каждого чанка отправляет пару (query, chunk.text) в локальную Ollama-модель с промптом "оцени релевантность от 0.0 до 1.0". Парсит числовой скор из ответа, сортирует чанки по убыванию скора, возвращает top-N. Чанки с relevance ниже минимального порога (default 0.3) отсекаются.

Для LLM-вызовов к Ollama — использовать OpenAI-compatible endpoint. Выбрать подходящую маленькую модель (qwen2.5, gemma2, или аналог — определить при реализации по тому, что установлено в Ollama).

**RagPipelineService** расширяется стадией rerank. **RagRetrieveResult** расширяется полями для трассировки (какие чанки отсечены reranker'ом, их скоры).

**Evaluation script** расширяется 4-м режимом `rag-reranker` (threshold + reranker). Отчёт показывает reranker scores для каждого чанка.

### Acceptance criteria

- [ ] LlmRerankerService корректно парсит скор из ответа модели (unit test с моком)
- [ ] LlmRerankerService сортирует по убыванию и отсекает по min relevance (unit test)
- [ ] LlmRerankerService обрабатывает невалидные ответы модели (fallback на score 0)
- [ ] Evaluation script запускается по 4 режимам
- [ ] Отчёт показывает reranker scores для чанков в режиме rag-reranker
- [ ] Проект собирается без ошибок

---

## Phase 3: Query Rewrite → 5 режимов + финальный отчёт

**User stories**: 5, 8, 9, 11, 13

### What to build

**QueryRewriteService** — принимает исходный вопрос, отправляет в Ollama LLM с промптом "переформулируй для поиска по технической базе знаний: расширь терминологию, добавь синонимы, убери разговорность". Возвращает переформулированный вопрос. При ошибке LLM — fallback на оригинальный вопрос.

**RagPipelineService** расширяется стадией query rewrite (первой в цепочке). **RagRetrieveResult** расширяется полем `rewrittenQuery`.

**Evaluation script** расширяется 5-м режимом `rag-full` (rewrite + threshold + reranker). Baseline по-прежнему вычисляется один раз.

**Финальный отчёт** — расширенный Markdown с:
- Сводной таблицей по всем 5 режимам (avg judge score, wins/losses/ties попарно)
- Per-question breakdown: для каждого вопроса — все 5 ответов с метриками
- Rewritten query (для режимов с query rewrite)
- Стоимость каждого режима (токены, USD)
- Retrieval details: чанки до/после фильтрации, reranker scores

### Acceptance criteria

- [ ] QueryRewriteService возвращает переформулированный вопрос (unit test с моком)
- [ ] QueryRewriteService fallback на оригинальный вопрос при ошибке LLM (unit test)
- [ ] Evaluation script запускается по всем 5 режимам
- [ ] Отчёт содержит rewritten query для режимов с query rewrite
- [ ] Отчёт содержит сводную таблицу сравнения всех 5 режимов
- [ ] Отчёт содержит per-question breakdown с retrieval details
- [ ] Отчёт содержит стоимость каждого режима
- [ ] Проект собирается и тесты проходят

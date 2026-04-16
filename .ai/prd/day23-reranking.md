# Day 23: Реранкинг и фильтрация

## Problem Statement

Текущий RAG-pipeline (Day 22) возвращает topK ближайших чанков из vector store без какой-либо пост-обработки. Это приводит к двум проблемам:

1. **Шум**: vector search возвращает чанки с высоким distance, которые формально "ближайшие", но фактически нерелевантны вопросу. Они разбавляют контекст и могут сбивать LLM.
2. **Плохой recall на разговорных вопросах**: короткие/неформальные вопросы ("чем REST лучше?") плохо матчатся с техническим текстом в индексе, потому что эмбеддинг разговорной формулировки далёк от эмбеддинга академического текста.

Отчёт Day 22 показал: RAG wins 1, Baseline wins 4, Ties 5 — RAG не даёт стабильного преимущества. Нужно улучшить precision (отсечь мусор) и recall (лучше формулировать запрос).

## Solution

Добавить два этапа в RAG-pipeline между vector search и генерацией ответа:

1. **Query Rewrite** (до поиска) — LLM переформулирует пользовательский вопрос в расширенную техническую формулировку, которая лучше матчится с чанками в индексе. Улучшает recall.

2. **Двухступенчатая фильтрация** (после поиска):
   - **Similarity threshold** — быстрое отсечение чанков с distance выше порога. Убирает очевидный мусор.
   - **LLM reranker** — локальная Ollama-модель оценивает релевантность каждого оставшегося чанка вопросу (скор 0-1). Чанки сортируются по скору, берутся лучшие. Улучшает precision.

Evaluation script сравнивает 5 режимов на одном наборе контрольных вопросов и генерирует сводный отчёт.

## User Stories

1. As a developer, I want irrelevant chunks filtered out before they reach the LLM, so that the generated answer is grounded in relevant context only.
2. As a developer, I want a configurable similarity threshold, so that I can tune the aggressiveness of filtering for different datasets.
3. As a developer, I want an LLM-based reranker that scores each chunk's relevance to the query, so that the most relevant chunks are prioritized even when vector distance is similar.
4. As a developer, I want the reranker to use a local Ollama model, so that reranking is fast and free (no API costs).
5. As a developer, I want query rewrite to reformulate my question before vector search, so that informal/short questions produce better retrieval results.
6. As a developer, I want to configure topK before filtering (candidate pool) separately from topK after filtering (final context), so that I can balance recall vs precision.
7. As a developer, I want to compare 5 RAG modes side-by-side on the same control questions, so that I can measure the impact of each improvement.
8. As a developer, I want the evaluation report to show per-question scores for each mode, so that I can identify which questions benefit from which techniques.
9. As a developer, I want the report to include aggregate metrics (avg judge score, wins/losses between modes), so that I can make data-driven decisions.
10. As a developer, I want the reranker and query rewrite to be composable pipeline stages, so that they can be enabled/disabled independently.
11. As a developer, I want to see the rewritten query in the evaluation report, so that I can verify query rewrite is producing reasonable reformulations.
12. As a developer, I want to see which chunks were filtered out and why (threshold vs reranker), so that I can debug retrieval quality.
13. As a developer, I want the evaluation script to reuse baseline answers across modes, so that evaluation runs faster and costs less.
14. As a developer, I want the pipeline stages to follow the existing port/service architecture, so that the codebase stays consistent.

## Implementation Decisions

### Pipeline architecture

RAG-pipeline становится composable chain из стадий. Каждая стадия — отдельный сервис с чётким интерфейсом:

```
Question → [QueryRewriter] → [VectorSearch] → [ThresholdFilter] → [LlmReranker] → PromptBuilder → LLM
```

Стадии QueryRewriter, ThresholdFilter, LlmReranker — опциональные. Включаются/выключаются через конфигурацию режима.

### Модули

**QueryRewriteService** — принимает исходный вопрос, отправляет в LLM (Ollama) с промптом "переформулируй для поиска по технической базе знаний", возвращает расширенную формулировку. Использует тот же OllamaEmbedder endpoint, но через отдельный LLM-вызов (не embedding). Нужен отдельный Ollama LLM client или использование существующего OpenAI-совместимого API Ollama.

**ThresholdFilter** — принимает массив VectorSearchHit[], порог distance, возвращает отфильтрованный массив. Чистая функция, без зависимостей.

**LlmRerankerService** — принимает query + массив VectorSearchHit[], для каждого чанка отправляет пару (query, chunk.text) в локальную Ollama-модель с промптом "оцени релевантность от 0.0 до 1.0", парсит скор, сортирует по убыванию, возвращает top-N. Модель — маленькая (например, qwen2.5 или gemma2 через Ollama), чтобы reranking был быстрым.

**RagPipelineService** — оркестратор, заменяющий текущий RagService для evaluation. Принимает конфигурацию режима (какие стадии включены, параметры) и выполняет полный pipeline. Реализует интерфейс RagRetriever, чтобы подключиться к существующему evaluation framework.

**RagRetrieveResult расширяется** — добавляются поля: rewrittenQuery (если был query rewrite), hitsBeforeFilter (количество до фильтрации), filterDetails (какие чанки отсечены и почему).

### 5 режимов сравнения

| # | Режим | Query Rewrite | Threshold | Reranker | TopK initial | TopK final |
|---|-------|--------------|-----------|----------|-------------|------------|
| 1 | baseline | - | - | - | - | - |
| 2 | rag-plain | нет | нет | нет | 3 | 3 |
| 3 | rag-threshold | нет | да | нет | 10 | 3 |
| 4 | rag-reranker | нет | да | да | 10 | 3 |
| 5 | rag-full | да | да | да | 10 | 3 |

Baseline вычисляется один раз и переиспользуется для всех сравнений.

### Параметры по умолчанию

- **Similarity threshold**: определяется эмпирически при первом запуске. Начальное значение — медианный distance из текущих результатов Day 22 + 20% (нужно посмотреть в отчёте).
- **TopK initial**: 10 (кандидатный пул для фильтрации).
- **TopK final**: 3 (финальный контекст для LLM, как в Day 22).
- **Reranker model**: маленькая модель через Ollama (конкретную выбрать при реализации).
- **Reranker relevance threshold**: 0.3 (чанки с relevance < 0.3 отсекаются даже если прошли threshold filter).

### Evaluation script

Новый entry point `scripts/day23/` с отдельным скриптом. Переиспользует существующие сервисы (RagEvaluationService, judge, rule scorer, report generator) из Day 22. Добавляет multi-mode orchestration и расширенный отчёт.

Контрольные вопросы — те же (`scripts/day22/control-questions.json`), симлинк или прямой import.

### Отчёт

Расширенный Markdown-отчёт:
- Таблица сравнения режимов (avg judge score, wins/losses)
- Per-question breakdown по каждому режиму
- Для каждого вопроса: показать rewritten query, отфильтрованные чанки, финальные чанки
- Стоимость каждого режима (токены, USD)

## Testing Decisions

Хороший тест проверяет внешнее поведение модуля через его публичный интерфейс, не привязываясь к деталям реализации. Тест должен сломаться только если сломалось поведение, а не если поменялась внутренняя структура.

### Модули для тестирования

**ThresholdFilter** — чистая функция, легко тестируется:
- Фильтрация по порогу distance
- Пустой вход → пустой выход
- Все чанки проходят / все отсекаются
- Граничные значения (distance === threshold)

**LlmRerankerService** — тест с мок-LLM:
- Парсинг скора из ответа модели (валидные и невалидные ответы)
- Сортировка по скору
- Отсечение по минимальному relevance threshold

**QueryRewriteService** — тест с мок-LLM:
- Возвращает переформулированный вопрос
- Обработка ошибок (LLM недоступен → fallback на оригинальный вопрос)

**RagPipelineService** — integration-level тест с моками:
- Все стадии включены → правильный порядок вызовов
- Стадии выключены → пропускаются
- Результат содержит metadata о каждом этапе

Паттерн тестов — аналогичен существующим в проекте (если есть). Используем встроенный test runner Bun.

## Out of Scope

- **Hybrid search (BM25 + vector)** — требует отдельного BM25-индекса, слишком большой scope для Day 23.
- **Iterative retrieval / multi-hop** — RAG с несколькими раундами поиска.
- **Semantic caching** — кэширование эмбеддингов и результатов.
- **Fine-tuning reranker model** — используем off-the-shelf модель через Ollama.
- **Изменение чанкинга или индексации** — работаем с существующим индексом из Day 21/22.
- **Изменение промпта генерации** — меняем только то, что подаётся в контекст, не сам системный промпт.
- **UI/REPL-интеграция** — pipeline пока только для evaluation, в чат-режим интегрируется позже.

## Further Notes

- Query rewrite добавляет +1 LLM-вызов и ~200-500ms latency. Reranker добавляет N вызовов (по числу чанков после threshold). Суммарно pipeline может быть в 2-3 раза медленнее plain RAG — это ожидаемо и приемлемо для evaluation.
- Если локальная Ollama-модель для reranker'а окажется недостаточно качественной (не умеет оценивать релевантность), fallback — использовать основную модель через OpenAI API.
- Порог similarity нужно калибровать эмпирически. Первый запуск покажет распределение distances, после чего порог можно подстроить.

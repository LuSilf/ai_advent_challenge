# Plan: Day 24 — Цитаты, источники и анти-галлюцинации

> Source PRD: `.ai/prd/day24-citations-anti-hallucinations.md`

## Architectural decisions

- **Structured Output**: OpenAI Responses API параметр `text.format: { type: "json_schema", name: "cited_rag_response", schema: ... }`. Включается только при активном RAG.
- **Схема ответа**: Zod-схема `CitedRagResponse` — единственный источник правды. Конвертируется в JSON Schema для OpenAI. Поля: `answer`, `confidence` (enum), `sources` (array), `quotes` (array).
- **Новый статус пайплайна**: `insufficient_context` — хиты были найдены, но все отфильтрованы threshold/reranker. Отличается от `no_hits` (ничего не нашлось) и `no_index` (индекс пуст).
- **Мусорные вопросы**: добавляются в `control-questions.json` с флагом `outOfScope: true`.
- **Faithfulness judge**: отдельный LLM-вызов (gpt-5-nano), шкала 0-3, аналогично существующему `rag-judge-service`.
- **REPL backward compatibility**: non-RAG ответы остаются plain text. Structured output только при RAG.

---

## Phase 1: Structured RAG-ответ (tracer bullet)

**User stories**: 1, 2, 6, 13

### What to build

Сквозной путь от вопроса до структурированного JSON-ответа с цитатами и источниками. Определить Zod-схему `CitedRagResponse` и конвертировать её в OpenAI JSON Schema. Расширить LLM client поддержкой параметра `text.format` с JSON schema — новое опциональное поле `responseFormat` в `LLMRequest`. Усилить промпт (`buildRagPromptSuffix`): добавить явные инструкции цитировать дословно, указывать номера источников, заполнять все поля. При RAG-режиме передавать schema в LLM-запрос, парсить JSON из ответа. Проверить на одном контрольном вопросе что возвращается валидный `CitedRagResponse`.

### Acceptance criteria

- [ ] Zod-схема `CitedRagResponse` определена с полями `answer`, `confidence`, `sources`, `quotes`
- [ ] Функция конвертации Zod → OpenAI JSON Schema работает корректно
- [ ] `LLMRequest` принимает опциональный `responseFormat` с JSON schema
- [ ] `buildOpenAIRequest` передаёт `text.format` когда `responseFormat` задан
- [ ] Промпт содержит инструкции про обязательные цитаты, источники и правила confidence
- [ ] На контрольном вопросе LLM возвращает валидный JSON, парсящийся в `CitedRagResponse`
- [ ] Поля `sources` и `quotes` не пустые в ответе
- [ ] Non-RAG режим продолжает работать с plain text (без schema)
- [ ] Unit-тесты на схему: валидный JSON парсится, невалидный отклоняется

---

## Phase 2: Режим "не знаю"

**User stories**: 3, 4, 7, 8, 11

### What to build

Двухуровневая защита от галлюцинаций. На уровне пайплайна: когда после threshold-фильтрации и/или reranking не осталось ни одного хита — возвращать новый статус `insufficient_context` вместо `no_hits`. При этом статусе `promptSuffix` не строится, а вызывающий код возвращает шаблонный ответ "не знаю" без обращения к LLM. На уровне LLM: промпт-инструкции для поля `confidence` — когда ставить `insufficient` (чанки не содержат прямого ответа, чанки не по теме). При `confidence: "insufficient"` поле `answer` содержит вежливый отказ с предложением уточнить вопрос. Добавить 3 мусорных вопроса в `control-questions.json` с флагом `outOfScope: true` и проверить что на них срабатывает режим "не знаю".

### Acceptance criteria

- [ ] Новый статус `insufficient_context` в `RagRetrieveStatus`
- [ ] Пайплайн возвращает `insufficient_context` когда threshold/reranker отфильтровали все хиты
- [ ] При `insufficient_context` LLM не вызывается, возвращается шаблонный ответ
- [ ] Промпт содержит явные правила когда ставить `confidence: "insufficient"`
- [ ] 3 мусорных вопроса добавлены в `control-questions.json` с `outOfScope: true`
- [ ] На мусорных вопросах модель возвращает `confidence: "insufficient"` или пайплайн возвращает `insufficient_context`
- [ ] При `insufficient` ответ содержит предложение уточнить вопрос
- [ ] Unit-тесты: пайплайн с 0 хитов после фильтрации → `insufficient_context`

---

## Phase 3: REPL-рендеринг

**User stories**: 5, 14

### What to build

Форматирование структурированного `CitedRagResponse` для терминала. Когда RAG активен и ответ — structured JSON: отображать основной ответ как обычный текст, затем блок "Источники" (нумерованный список source + section), затем блок "Цитаты" (пронумерованные цитаты с указанием номера источника). При `confidence: "insufficient"` — специальное оформление отказа. Когда RAG выключен или ответ plain text — отображать как раньше без изменений.

### Acceptance criteria

- [ ] Structured RAG-ответ рендерится с тремя блоками: ответ, источники, цитаты
- [ ] Источники отображаются как нумерованный список с document и section
- [ ] Цитаты отображаются с указанием номера источника
- [ ] При `insufficient` отображается специальный блок с предложением уточнить
- [ ] Non-RAG ответы отображаются как раньше (plain text)
- [ ] Стриминг: ответ приходит целиком (не стримится) при structured output
- [ ] Визуально проверено в терминале на нескольких вопросах

---

## Phase 4: Evaluation и отчёт

**User stories**: 9, 10, 12, 15

### What to build

Расширить evaluation pipeline новыми метриками для цитат и anti-hallucination. CitationScorer: проверяет наличие `sources` и `quotes` в каждом ответе, считает completeness (% ответов с полными цитатами). FaithfulnessJudge: отдельный LLM-вызов, получает `answer` + `quotes`, оценивает подтверждаются ли утверждения ответа цитатами (шкала 0-3, аналогично существующему judge). InsufficientContextChecker: для вопросов с `outOfScope: true` проверяет что ответ — `insufficient`. Расширить markdown-отчёт новыми колонками. Полный прогон на 13 вопросах (10 основных + 3 мусорных).

### Acceptance criteria

- [ ] CitationScorer: hasSources, hasQuotes, completeness для каждого ответа
- [ ] FaithfulnessJudge: оценка 0-3 для совпадения answer vs quotes
- [ ] InsufficientContextChecker: проверка outOfScope вопросов
- [ ] Markdown-отчёт содержит новые колонки: sources, quotes, faithfulness, insufficient
- [ ] Полный прогон на 10+3 вопросах завершается без ошибок
- [ ] Все 10 основных вопросов имеют hasSources=true и hasQuotes=true
- [ ] Все 3 мусорных вопроса получают insufficient (на уровне пайплайна или LLM)
- [ ] Faithfulness score ≥ 2.0/3 в среднем на основных вопросах
- [ ] Отчёт сохранён в `scripts/day24/report.md`

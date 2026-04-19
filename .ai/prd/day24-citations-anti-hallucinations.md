# Day 24: Цитаты, источники и анти-галлюцинации

## Problem Statement

Текущий RAG-pipeline (Day 21-23) находит релевантные чанки и передаёт их в LLM как контекст, но ответ модели — неструктурированный текст. Это создаёт три проблемы:

1. **Нет гарантии источников**: модель может ответить без ссылки на конкретный документ/секцию, и пользователь не может проверить откуда взята информация.
2. **Нет цитат**: ответ пересказывает чанки своими словами, а не подкрепляет утверждения прямыми цитатами из базы знаний. Нет способа отличить знание из контекста от знания из обучения модели.
3. **Галлюцинации при слабом контексте**: когда найденные чанки нерелевантны вопросу, модель всё равно пытается ответить, используя свои "знания", вместо того чтобы честно сказать "не знаю". Текущая промпт-инструкция ("скажи если не нашёл") не обеспечивает enforcement.

## Solution

### 1. Structured Output с обязательными полями

Перевести RAG-ответ с plain text на структурированный JSON через OpenAI Structured Outputs (JSON schema в параметрах Responses API). Схема ответа:

```typescript
type CitedRagResponse = {
  answer: string;                    // Основной ответ
  confidence: "high" | "low" | "insufficient"; // Оценка достаточности контекста
  sources: Array<{
    sourceIndex: number;             // Номер источника из контекста [Источник N]
    source: string;                  // Имя документа
    section: string | null;          // Секция/breadcrumb
  }>;
  quotes: Array<{
    sourceIndex: number;             // К какому источнику относится
    text: string;                    // Дословная цитата из чанка
  }>;
}
```

Модель обязана заполнить все поля — JSON schema гарантирует это на уровне API.

### 2. Двухуровневый режим "не знаю"

**Уровень пайплайна (до LLM-вызова):**
- Если после всех этапов фильтрации (threshold + reranker) осталось 0 хитов — сразу возвращается ответ "не знаю" без обращения к LLM. Экономит токены.
- Добавить новый статус `insufficient_context` в `RagRetrieveResult`.

**Уровень LLM (в structured output):**
- Поле `confidence: "insufficient"` — модель сама оценивает, что найденный контекст не позволяет ответить.
- При `insufficient` поле `answer` должно содержать вежливый отказ с просьбой уточнить вопрос.
- Промпт-инструкция усилена: явные правила когда ставить `insufficient` (нет прямого ответа в чанках, чанки не по теме).

### 3. Отображение в REPL

В интерактивном чате структурированный ответ рендерится красиво:
- Сам ответ — обычным текстом
- Блок "Источники" — нумерованный список с source и section
- Блок "Цитаты" — пронумерованные цитаты с указанием источника
- При `insufficient` — специальное оформление отказа

### 4. Evaluation расширенная

Расширить scoring и evaluation для проверки новых свойств:
- **Наличие источников** (hasSources: boolean)
- **Наличие цитат** (hasQuotes: boolean)
- **Faithfulness** — совпадение смысла ответа с цитатами (LLM judge)
- **Корректность "не знаю"** — добавить 2-3 мусорных вопроса (заведомо не по теме), проверить что модель отвечает `insufficient`
- Сводный отчёт с новыми метриками

## User Stories

1. As a user, I want every RAG answer to include a list of sources (document + section), so that I can verify where the information came from.
2. As a user, I want every RAG answer to include direct quotes from the knowledge base, so that I can see the exact text that supports each claim.
3. As a user, I want the system to say "I don't know" when the retrieved context is insufficient, so that I'm not misled by hallucinated answers.
4. As a user, I want the "I don't know" response to suggest how I can rephrase my question, so that I can try again more effectively.
5. As a user, I want citations displayed in a readable format in the REPL, so that I can quickly scan sources and quotes without parsing JSON.
6. As a developer, I want structured JSON output enforced via API schema (not just prompt instructions), so that the response format is guaranteed and machine-parseable.
7. As a developer, I want the pipeline to skip the LLM call entirely when no relevant chunks are found, so that I don't waste tokens on unanswerable queries.
8. As a developer, I want a new `insufficient_context` status in the retrieval result, so that I can distinguish between "no index" / "no hits" / "hits exist but all filtered out".
9. As a developer, I want evaluation to check that every RAG answer contains sources and quotes, so that I can detect regressions in citation completeness.
10. As a developer, I want evaluation to measure faithfulness (answer matches quotes), so that I can detect when the model ignores the retrieved context.
11. As a developer, I want 2-3 out-of-scope test questions in the evaluation set, so that I can verify the "I don't know" mode triggers correctly.
12. As a developer, I want a combined evaluation report with citation metrics alongside existing judge/rules scores, so that I can compare modes on all dimensions.
13. As a developer, I want the structured output schema to be defined in one place and reused across generation and evaluation, so that schema changes don't cause drift.
14. As a developer, I want the REPL to gracefully handle both structured (RAG) and unstructured (non-RAG) responses, so that the chat experience is consistent.
15. As a developer, I want the prompt instructions for citation generation to be tunable separately from the JSON schema, so that I can iterate on prompt quality without changing the contract.

## Implementation Decisions

### Модули для создания/изменения

1. **CitedResponseSchema** — Zod-схема `CitedRagResponse` + функция конвертации в OpenAI JSON Schema. Единственный источник правды для формата ответа. Используется и при генерации, и при валидации в evaluation.

2. **RAG Prompt Builder (модификация `buildRagPromptSuffix`)** — усиленный промпт с явными инструкциями:
   - Обязательно цитировать дословно из найденных материалов
   - Обязательно указывать номера источников
   - Правила для `confidence`: если ни один чанк не содержит прямого ответа → `insufficient`
   - Формат ответа описан в промпте + закреплён через structured output

3. **LLM Client (расширение)** — добавить поддержку `text.format` с `type: "json_schema"` в `buildOpenAIRequest`. Новый опциональный параметр `responseSchema` в `LLMRequest`. Когда schema задана, ответ парсится как JSON.

4. **RagPipelineService (модификация)** — новый статус `insufficient_context` когда после фильтрации 0 хитов. При этом статусе `promptSuffix` не строится, а вызывающий код может решить не обращаться к LLM.

5. **ChatService / Evaluation runner (модификация)** — при RAG-режиме:
   - Передают `responseSchema` в LLM-запрос
   - Парсят JSON-ответ в `CitedRagResponse`
   - При `insufficient_context` из пайплайна — возвращают шаблонный ответ без LLM-вызова

6. **REPL Renderer** — форматирование `CitedRagResponse` для терминала:
   - Ответ — обычный текст
   - Источники — нумерованный список (source, section)
   - Цитаты — блоки с указанием номера источника
   - При `insufficient` — специальный блок с предложением уточнить вопрос

7. **Evaluation Extensions**:
   - **CitationScorer** — проверяет наличие sources и quotes, считает completeness
   - **FaithfulnessJudge** — LLM-judge проверяет совпадение смысла answer vs quotes
   - **InsufficientContextChecker** — проверяет что на мусорные вопросы модель ответила `insufficient`
   - Расширенный отчёт с колонками: hasSources, hasQuotes, faithfulness, insufficientCorrect

8. **Контрольные вопросы (расширение)** — добавить 2-3 вопроса заведомо не по теме документа (system-design-primer), например:
   - "Как приготовить борщ?" (бытовой вопрос)
   - "Какова столица Мадагаскара?" (общие знания, не IT)
   - "Расскажи про квантовые вычисления" (IT, но не по теме документа)

### Архитектурные решения

- **Structured Outputs через OpenAI Responses API** — параметр `text.format` с `type: "json_schema"`. Гарантирует формат на уровне API, не нужен fallback-парсинг.
- **Zod → JSON Schema** — схема определяется через Zod, конвертируется в JSON Schema для OpenAI. Одна схема для генерации и валидации.
- **`insufficient_context` — отдельный статус**, а не переиспользование `no_hits`. Семантически: хиты были, но все отфильтровались — это другая ситуация, чем "в индексе пусто".
- **Промпт-инструкции на русском** — продолжаем стиль Day 22-23, все RAG-инструкции в промпте на русском.
- **Backward compatibility** — non-RAG режим продолжает работать с plain text ответами. Structured output включается только при активном RAG.

## Testing Decisions

### Хорошие тесты

Тестируем внешнее поведение модулей, не внутреннюю реализацию. Тесты должны быть воспроизводимыми и не зависеть от конкретных формулировок LLM (кроме integration/evaluation тестов).

### Модули для тестирования

1. **CitedResponseSchema** — unit-тесты:
   - Валидный JSON парсится корректно
   - Невалидный JSON (пустые sources, отсутствующие поля) отклоняется
   - Конвертация в OpenAI JSON Schema формат корректна

2. **RAG Prompt Builder** — unit-тесты:
   - Промпт содержит инструкции про цитаты и источники
   - Промпт содержит правила для `insufficient`
   - Нумерация источников корректна

3. **Pipeline `insufficient_context`** — unit-тесты:
   - Когда threshold фильтрует все хиты → статус `insufficient_context`
   - Когда reranker фильтрует все хиты → статус `insufficient_context`
   - `promptSuffix` не строится при `insufficient_context`

4. **CitationScorer** — unit-тесты:
   - Ответ с sources и quotes → hasSources=true, hasQuotes=true
   - Ответ без sources → hasSources=false
   - Подсчёт completeness корректен

5. **Evaluation (integration)** — полный прогон на 10+3 вопросах:
   - Все RAG-ответы содержат sources и quotes
   - Faithfulness score на основных вопросах
   - Мусорные вопросы получают `insufficient`

### Аналоги в кодовой базе

- `rag-rules-scorer.ts` — паттерн для scoring-модулей
- `rag-judge-service.ts` — паттерн для LLM-judge
- `rag-pipeline-eval.ts` — паттерн для evaluation runner

## Out of Scope

- **Inline citations** (ссылки внутри текста ответа типа "согласно [1]...") — Day 24 возвращает отдельные блоки sources и quotes, но не требует inline-маркеров внутри answer text.
- **Multi-document synthesis** — если ответ требует синтеза из нескольких документов, это не проверяется отдельно.
- **Streaming structured output** — в REPL ответ приходит целиком (не стримится), потому что нужен полный JSON для парсинга.
- **Кэширование schema** — structured output schema передаётся в каждый запрос, оптимизация кэширования не делается.
- **Автоматический retry при невалидном JSON** — OpenAI Structured Outputs гарантирует формат, retry не нужен.
- **Изменение моделей embeddings/reranker** — используем те же модели что в Day 23.

## Further Notes

- OpenAI Responses API поддерживает structured outputs через параметр `text.format: { type: "json_schema", ... }`. Это предпочтительнее function calling для случаев когда нужен именно структурированный текстовый ответ.
- Zod-to-JSON-Schema конвертация: используем библиотеку `zod-to-json-schema` или ручную конвертацию (схема простая, 4 поля).
- Мусорные вопросы размещаются в том же `control-questions.json`, но с флагом `outOfScope: true` для отдельной обработки в evaluation.
- Faithfulness judge — отдельный вызов LLM (тот же gpt-5-nano), который получает answer + quotes и оценивает: "подтверждаются ли утверждения в ответе цитатами?". Шкала 0-3, аналогично существующему judge.

# Plan: Управление контекстом — сжатие истории чата

> Source PRD: `.ai/prd/context-compression.md`

## Architectural decisions

- **Schema**: новая таблица `summaries` (`id`, `session_id` UNIQUE, `content`, `message_count`, `updated_at`). Каскадное удаление при удалении сессии.
- **Конфигурация**: env-переменные `CONTEXT_TAIL_SIZE` (default 10), `TOKEN_PRICE_INPUT` (default 0.05), `TOKEN_PRICE_OUTPUT` (default 0.40)
- **Формат контекста**: `[{role: "user", content: summary}] + последние N сообщений + текущий промпт` — summary подставляется как user-сообщение
- **Суммаризация**: используется та же модель что и для ответов; специализированный промпт на русском для фактологического резюме
- **API**: OpenAI Responses API (`response.usage` для токенов)
- **Команды REPL**: `/summary`, `/benchmark`

---

## Phase 1: Token Stats — статистика токенов и стоимости

**User stories**: 3, 4, 5, 15

### What to build

После каждого ответа LLM (в обоих режимах — single-message и REPL) выводить строку со статистикой: количество input/output токенов и стоимость в долларах. Стоимость рассчитывается на основе цен из env-переменных (`TOKEN_PRICE_INPUT`, `TOKEN_PRICE_OUTPUT`) с дефолтами для gpt-5-nano на OpenRouter.

Формат вывода:
```
📊 Tokens: 1234 in / 567 out | Cost: $0.0029
```

### Acceptance criteria

- [x] После каждого ответа (streaming и non-streaming) выводится строка с input/output токенами и стоимостью
- [x] Стоимость рассчитывается по формуле: `(input * price_in + output * price_out) / 1_000_000`
- [x] Цены настраиваются через `TOKEN_PRICE_INPUT` и `TOKEN_PRICE_OUTPUT`
- [x] Дефолтные цены: $0.05/1M input, $0.40/1M output
- [x] Статистика выводится всегда, не только в debug-режиме
- [x] Тесты: расчёт стоимости по дефолтным и пользовательским ценам, форматирование вывода

---

## Phase 2: Ядро сжатия — summarizer + DB + context builder

**User stories**: 1, 2, 6, 7, 12, 13, 14

### What to build

Реализовать полный цикл сжатия истории:

1. Таблица `summaries` в SQLite — хранит один кумулятивный summary на сессию с счётчиком сжатых сообщений.
2. Модуль Summarizer — принимает текущий summary + блок новых сообщений, отправляет запрос к LLM со специализированным промптом, возвращает обновлённый summary.
3. Context Builder — перед каждым запросом определяет, есть ли несжатые сообщения за горизонтом последних N. Если есть — вызывает Summarizer, обновляет summary в БД. Формирует итоговый контекст: summary (как user-сообщение) + последние N сообщений.
4. Интеграция в оба режима (CLI и REPL) — заменить текущую сборку истории на Context Builder.

Количество "живых" сообщений настраивается через `CONTEXT_TAIL_SIZE` (default 10).

### Acceptance criteria

- [x] Таблица `summaries` создаётся при инициализации БД; каскадное удаление при удалении сессии
- [x] DB-операции: `getSummary(sessionId)`, `upsertSummary(sessionId, content, messageCount)` работают корректно
- [x] Summarizer генерирует summary из блока сообщений (с моком API в тестах)
- [x] Summarizer кумулятивно обновляет существующий summary
- [x] Context Builder: при сообщениях <= N — возвращает все как есть, без summary
- [x] Context Builder: при сообщениях > N — возвращает summary + последние N
- [x] Context Builder вызывает Summarizer только при наличии несжатых сообщений
- [x] `CONTEXT_TAIL_SIZE` настраивается через env-переменную
- [x] Интеграция работает в обоих режимах (single-message и REPL)

---

## Phase 3: Команда /summary

**User story**: 8

### What to build

Команда `/summary` в REPL, которая выводит текущий summary сессии. Если summary ещё не создавался (мало сообщений) — сообщить об этом пользователю.

### Acceptance criteria

- [x] Команда `/summary` выводит текущий summary сессии
- [x] Если summary отсутствует — выводится сообщение "Summary ещё не создан"
- [x] Команда отображается в `/help`

---

## Phase 4: Команда /benchmark

**User stories**: 9, 10, 11

### What to build

Команда `/benchmark <промпт>` в REPL, которая отправляет два параллельных запроса к LLM: один с полной историей, другой со сжатой (summary + последние N). Результаты выводятся в двух колонках с ответами, токенами и стоимостью для каждого варианта.

### Acceptance criteria

- [x] Команда `/benchmark` принимает промпт и отправляет два запроса
- [x] Запросы выполняются параллельно
- [x] Результат выводится в двух колонках: со сжатием и без
- [x] Каждая колонка содержит: ответ модели, токены (in/out), стоимость, количество отправленных сообщений
- [x] Команда отображается в `/help`
- [x] Тесты: формирование двух запросов, форматирование вывода

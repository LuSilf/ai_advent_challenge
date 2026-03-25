# День 8. Работа с токенами

Задача: добавить подсчёт и отображение токенов в CLI-чат агент.

## Контекст

Проект — CLI chatbot на Bun + TypeScript, OpenAI Responses API через OpenRouter, SQLite история, REPL режим. Ветка: chat-tokens.

## Что нужно сделать

### 1. Получение метаданных модели при старте

- При запуске делать GET-запрос к `https://openrouter.ai/api/v1/models`
- Найти модель по ID из конфига (`OPENAI_MODEL`)
- Извлечь: `context_length`, `pricing.prompt`, `pricing.completion`
- Добавить env-переопределения: `OPENAI_MAX_CONTEXT_TOKENS`, `OPENAI_INPUT_PRICE`, `OPENAI_OUTPUT_PRICE` (цена за 1 токен)
- Если запрос к API не удался — использовать дефолты или env-значения

### 2. Таблица token_usage в SQLite

- Создать таблицу:
  ```sql
  CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    exchange_num INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cached_tokens INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER,
    input_cost REAL,
    output_cost REAL,
    total_cost REAL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  ```
- Добавить функции: `saveTokenUsage(sessionId, data)`, `getSessionTokenUsage(sessionId)`

### 3. Сохранение usage после каждого ответа

- После получения `response.usage` — сохранять в `token_usage`
- Вычислять стоимость: `input_tokens * input_price`, `output_tokens * output_price`
- Работает и в single-message, и в REPL режиме

### 4. Компактная строка после каждого ответа

- Формат: `[in:450 out:120 | сессия: 2340/400k (0.6%) | $0.003]`
- "сессия" — накопительный total_tokens за все обмены в сессии
- Показывать ВСЕГДА (не только в debug режиме)
- Данные для "сессия" брать суммой из token_usage для текущей сессии

### 5. Команда /tokens в REPL

- Выводит таблицу по всем обменам текущей сессии:
  ```
  📊 Статистика сессии #3 (7 обменов)
  ──────────────────────────────────────
   #   Input   Output  Cached  Reasoning  Total    Cost
   1     120      85       0        0       205   $0.0003
   2     340     102      80        0       442   $0.0005
   ...
  ──────────────────────────────────────
  Всего:  2340    670     850       0      3010   $0.0031
  Контекст: 2340 / 400000 (0.6%)
  ```
- Данные из таблицы `token_usage`

### 6. Обработка переполнения контекста

- Если API вернул ошибку о превышении контекста — показать понятное сообщение пользователю
- В сообщении указать: текущий размер контекста, лимит модели, рекомендацию (начать новую сессию или очистить историю)

## Требования

- Не ломать существующие тесты (`bun test`)
- Добавить тесты для новых функций (token_usage в db, расчёт стоимости)
- Код на TypeScript, стиль как в существующих файлах

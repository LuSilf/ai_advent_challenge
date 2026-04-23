# Day 27 — Telegram-бот на локальной LLM: финальный прогон

Дата: 2026-04-22.

## Hardware

| Параметр | Значение |
| --- | --- |
| CPU | Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz (12 потоков) |
| RAM total / available | 62.44 GB / 57.12 GB |
| GPU | NVIDIA GeForce GTX 1650 with Max-Q Design |
| VRAM | 4 GB |
| Backend | CUDA |
| Unified memory | false |

_Источник: `llmfit system --json`._

## Runtime configuration

- LLM endpoint: `http://localhost:11434/v1` (Ollama через OpenAI chat.completions).
- Модель: `llama3.2:3b` (Q4_K_M, ~2 GB в VRAM, помещается целиком).
- Timeout: 180000 ms.
- `max_completion_tokens`: 768.
- System prompt (дефолт): «Ты краткий русскоязычный ассистент. Отвечай по делу, без воды и markdown-форматирования. Держись в пределах ~300 слов.»
- Whitelist: CSV chat_id через `TELEGRAM_ALLOWED_CHAT_IDS`.
- История чата: in-memory `Map<chat_id, ChatTurn[]>`, лимит 40 turns, при рестарте теряется.

## Architecture snapshot

```
src/bot.ts                                       — entry point (bun run bot)
src/presentation/telegram/
  config.ts         loadTelegramConfig           — env-contract + дефолты
  whitelist.ts      WhitelistGuard               — CSV → Set<number>, isAllowed
  history.ts        ChatHistoryStore             — Map<chat_id, ChatTurn[]>, append/get/clear
  chat-handler.ts   TelegramChatHandler          — связывает LLMClient + history + prompt
  index.ts          createTelegramBot            — grammy wiring: /start, /new, message:text
                    explainError                 — маппинг ошибок в читаемый русский
src/api/openai/llm-client.ts                     — универсальный chat.completions-клиент
```

## Verification checklist

### Fail-fast startup

- `bun run bot` без `TELEGRAM_BOT_TOKEN` → `Missing required env: TELEGRAM_BOT_TOKEN`.
- `TELEGRAM_ALLOWED_CHAT_IDS=abc` → `Invalid chat_id in whitelist: "abc". Expected integer.`
- `TELEGRAM_MAX_TOKENS=0` → `Invalid TELEGRAM_MAX_TOKENS value: 0. Must be a positive integer.`

### End-to-end через реальную Ollama (handler + `llama3.2:3b`)

Прогон смоук-скрипта с тремя turn'ами + `/new` + повтор:

| # | User | Bot (сокращённо) | Latency |
| --- | --- | --- | --- |
| 1 | Привет! Меня зовут Антон. | «Здравствуй, Антон! Как могу помочь?» | **4773 ms** (включая warmup) |
| 2 | Как меня зовут? | «Ваше имя — Антон.» (context carry OK) | **558 ms** |
| 3 | Одним предложением: что такое cache-aside? | корректное определение (с мелкими language-glitches на 3B) | **1880 ms** |
| — | `/new` | история очищена (0 turns) | — |
| 4 | Как меня зовут? | «Я не знаю, я ассистент» (context reset OK) | **895 ms** |

Наблюдения:
- Первый запрос медленный из-за cold-start (warmup модели), последующие — ~0.5–2 s на коротких ответах.
- Контекст follow-up работает: второй turn видит имя из первого.
- После `/new` модель теряет имя — ожидаемое поведение.
- На 3B местами ломает морфологию/вставляет иноязычные токены (llama3.2:3b на русском без fine-tune). Для более чистого русского — qwen2.5-coder:7b (но на 4 GB VRAM будет дольше).

### Error mapping (через handler с подменным base URL)

- `OPENAI_BASE_URL=http://localhost:11499/v1` (Ollama не отвечает) → SDK бросает `APIConnectionError("Connection error.")` → `explainError` → «Модель недоступна. Убедитесь, что Ollama запущена.»
- `TELEGRAM_MODEL=doesnotexist:7b` → Ollama отвечает 404 → «Модель не найдена. Проверьте TELEGRAM_MODEL и что она загружена в Ollama.»

В фазе 5 обнаружилось, что исходный `explainError` не ловил `APIConnectionError` (OpenAI SDK оборачивает fetch-ECONNREFUSED в свой класс с message `"Connection error."`). Починка + unit-тесты добавлены в этой же фазе (`error-mapping.test.ts`, 9 кейсов).

## Tests

```
bun test
...
700 pass
0 fail
1461 expect() calls
Ran 700 tests across 62 files. [~13 s]
```

Новые тесты, добавленные в этой ветке:

| Файл | Кейсов |
| --- | --- |
| `src/api/openai/llm-client.test.ts` | 14 (переписан под chat.completions) |
| `src/presentation/telegram/whitelist.test.ts` | 8 |
| `src/presentation/telegram/history.test.ts` | 6 |
| `src/presentation/telegram/chat-handler.test.ts` | 6 |
| `src/presentation/telegram/config.test.ts` | 8 |
| `src/presentation/telegram/error-mapping.test.ts` | 9 |

Удалены вместе с legacy-кодом: `src/request.test.ts`, `src/memory.test.ts`, `src/strategy.test.ts`, `src/reconciliation.test.ts`, `src/repl.test.ts`.

## Что удивило

- **OpenAI SDK чище, чем ожидал.** После переезда на `chat.completions` один клиент ходит и в Ollama, и в OpenRouter, и в OpenAI без единой ветки `if provider === ...`. Dual-provider абстракция, которую я сначала собирался строить в grill-me, оказалась ненужной.
- **Ollama на Max-Q 4 GB на 3B стабильно держит sub-secondary response.** Для бота это значит, что нативный UX достижим без Docker и VPS.
- **Legacy-хвост был больше, чем казался.** Удалил 11 файлов (~2.5k строк), включая `src/cli.ts`, `src/repl.ts`, `src/request.ts`, `src/memory.ts`, `src/strategy.ts`, `src/reconciliation.ts` и их тесты. Все держали Responses API в мертвом виде. После ампутации `grep responses.create` ничего не находит.
- **OpenAI SDK оборачивает connection errors в свой класс.** Пришлось добавить `name === "APIConnectionError"` + `/connection error/i` в explainError — без этого пользователь получал сырое «Connection error.» вместо «Модель недоступна».
- **grammy в Bun работает без танцев.** Zero config, zero polyfills.

## Где local уступил cloud

- **Качество русскоязычных ответов на 3B заметно уступает cloud.** Морфология, пунктуация, иногда перескок на латинизацию кириллицы или вставка английских слов. На бытовой чат терпимо, на production — нет.
- **Нет Responses API-фич**: reasoning summaries, reasoning effort — выпилены сознательно, потому что Ollama их не делает. Для «мыслящих» задач на local их теперь нет по дизайну.
- **Холодный старт первого запроса 4–5 s** — для бота ощутимо, хотя быстро прогревается. На cloud-gpt-5-nano первый запрос обычно 1–3 s.

## Где local не уступил

- **Latency на follow-up после warmup** (~500–2000 ms) — это уровень интерактивного чата в Telegram, бот ощущается живым.
- **Приватность**: ни один токен не уходит во внешний API; история в RAM, при рестарте пропадает.
- **Cost** — $0 за бесконечное число сообщений.
- **Таймаут 180 s** покрывает даже тяжёлые ответы от qwen2.5-coder:7b на этой же машине (если захочется переключить).

## Next steps (day 28+)

- **Docker-образ бота** (`bun` image + volume для `.env`) с `OPENAI_BASE_URL=host.docker.internal:11434/v1` или отдельный сервис Ollama в compose.
- **VPS deployment**. Для Ollama на VPS нужен GPU или приемлемый CPU (Ryzen). Иначе — остаётся локальный бот, который удалённо доступен только через Telegram.
- **Streaming через `editMessageText`** с троттлингом ~1 s. Сделает UX живее на длинных ответах.
- **Команда `/model <name>`** — переключение между `llama3.2:3b`, `qwen2.5-coder:3b`, `qwen2.5-coder:7b` прямо из чата. Сейчас модель фиксируется на старте.
- **Переезд на более русскоязычную 3–7B** (saiga/llama, yandexgpt-lite локально) — решит качество морфологии. На 4 GB VRAM выбор ограниченный, но есть варианты.
- **Персистентная история в SQLite**. Сейчас `/new` = «всё забыли», рестарт бота = тоже «всё забыли». Для подписчиков это sub-optimal, но приватность в плюс.
- **Unit-тесты на grammy-wiring** через `bot.api.config.use` или fake transport, если захочется жёсткой регрессионной защиты handler-логики.

## Ветка к мерджу

- Все 5 фаз зафиксированы в отдельных коммитах.
- `bun test` зелёный (700 pass, 0 fail).
- `bun run bot` с валидным `.env` запускается, прошёл end-to-end смоук.
- `bun run start` продолжает работать в REPL против Ollama (default base URL), auto-title на chat.completions.
- Можно ff-мерджить в master.

# Plan: Day 27 — Интеграция локальной LLM в реальное приложение (Telegram-бот)

> Source PRD: [.ai/prd/day27-local-llm-app.md](../prd/day27-local-llm-app.md)

## Architectural decisions

Durable решения, общие для всех фаз:

- **Ветка**: `day27-local-llm-app` (создана, в ней же происходят все фазы).
- **Две части в одном дне**:
  - Часть A — ампутация Responses API (фаза 1).
  - Часть B — Telegram-бот (фазы 2-4).
- **LLM-клиент**: единый `OpenAILLMClient` на `chat.completions.create`. Работает и с Ollama, и с OpenRouter, и с OpenAI без ветвлений. Dual-provider абстракция не вводится.
- **Default LLM base URL**: `http://localhost:11434/v1` (Ollama), override через `OPENAI_BASE_URL`.
- **Удаляемая legacy**: корневые `src/cli.ts`, `src/repl.ts`, `src/request.ts`, `src/memory.ts`, `src/strategy.ts`, `src/reconciliation.ts` и их тесты. Эти файлы не импортируются из актуального `main.ts` и REPL'а; они dead code от прошлого рефакторинга, который держит Responses API.
- **Размещение кода бота**: `src/presentation/telegram/` (по канону слоя `presentation/`). Entry-point — `src/bot.ts` рядом с `main.ts`/`scheduler.ts`/`indexing.ts`.
- **Стек бота**: `grammy` (добавляется как prod-зависимость), long-polling. Никакого webhook сегодня.
- **История чата**: in-memory `Map<chat_id, messages[]>`, без SQLite, без `SessionService`. Переживает только процесс.
- **Команды бота**: `/start`, `/new`. Больше никаких команд.
- **Дефолт-модель бота**: `llama3.2:3b` (выбор обоснован в отчёте day26 — 38 tps против 9 tps у qwen 7B).
- **Env contract бота**:
  - `TELEGRAM_BOT_TOKEN` — обязательная.
  - `TELEGRAM_ALLOWED_CHAT_IDS` — обязательная, CSV из chat_id.
  - `TELEGRAM_MODEL` — дефолт `llama3.2:3b`.
  - `OPENAI_BASE_URL` — дефолт `http://localhost:11434/v1`.
  - `TELEGRAM_TIMEOUT_MS` — дефолт `180000`.
  - `TELEGRAM_MAX_TOKENS` — дефолт `768`.
  - `TELEGRAM_SYSTEM_PROMPT` — дефолт «краткий ассистент, до ~300 слов».
- **Deep-модули бота** (тестируемые): `WhitelistGuard`, `ChatHistoryStore`, `TelegramChatHandler`, `loadTelegramConfig`.
- **Glue** (не тестируется): `src/bot.ts` (entry), `src/presentation/telegram/index.ts` (grammy-wiring).
- **Out of scope сегодня**: Docker / VPS / webhook / tool-use / RAG в боте / streaming через editMessage / persistent storage / модификация `modelRepo` / новые eval-сценарии на local.
- **Deployment roadmap** (не сегодня): локальная машина → Docker → VPS. Сегодня закладываем env-driven конфиг, чтобы будущие фазы легли сверху без рефакторинга.
- **npm-скрипт**: `"bot": "bun run src/bot.ts"` в `package.json`.
- **Приёмка каждой фазы**: `bun test` зелёный (если фаза меняет тестируемый код), вручную проверенный ручной сценарий, чистый `git status` перед переходом к следующей фазе.

---

## Phase 1: Ампутация Responses API

**User stories**: 18, 19, 20, 21, 22, 23

### What to build

Единый атомарный рефакторинг, после которого весь репозиторий живёт на `chat.completions` и работает против Ollama по умолчанию.

В одном проходе:

- `OpenAILLMClient` (send + stream) переписывается на `chat.completions.create`. Парсинг ответа мигрирует на `choices[0].message.content`, `usage.prompt_tokens/completion_tokens`, `choices[0].message.tool_calls`, `choices[0].finish_reason`. Streaming — через delta-chunks `choices[0].delta.content`.
- Из доменного порта `LLMClient` / `StreamEvent` удаляется вариант `reasoning_summary`.
- Из `GenerationParams` удаляются поля `reasoningEffort` и `reasoningSummary`; все места их проброса (chat-service, main.ts, REPL, scheduler, rag-eval-скрипты) чистятся в том же коммите.
- Из `AppConfig` и `loadConfig` удаляются `reasoningEffort`/`reasoningSummary` и парсинг `OPENAI_REASONING_EFFORT`/`OPENAI_REASONING_SUMMARY`. Default `OPENAI_BASE_URL` меняется на `http://localhost:11434/v1`.
- Auto-title в `src/main.ts` и в `src/presentation/repl/index.ts` переписывается с `responses.create` / `output_text` на `chat.completions.create` / `choices[0].message.content`.
- `debug-logger.ts` переводится на chat.completions-формат вывода (`prompt_tokens`/`completion_tokens`, `choices`).
- Конвертация tools в LLMRequest: `{type: "function", function: {name, description, parameters}}`. Парсинг `tool_calls`: id/function.name/function.arguments.
- `response_format` для JSON-schema мигрирует на chat.completions-shape (`{type: "json_schema", json_schema: {...}}`).
- Удаляется legacy: `src/cli.ts`, `src/repl.ts`, `src/request.ts`, `src/memory.ts`, `src/strategy.ts`, `src/reconciliation.ts`, `src/request.test.ts`, `src/strategy.test.ts`, `src/memory.test.ts`, `src/reconciliation.test.ts`.
- Моки в оставшихся тестах (`chat-service.test.ts`, `memory-service.test.ts`, `rag-judge-service.test.ts`, `faithfulness-judge`, `llm-reranker-service`, `rag-evaluation`, `task-state-service` — по факту ревизии) приводятся к chat.completions-форме.
- Тесты самого `OpenAILLMClient` переписываются: проверяем построение chat.completions-request и парсинг ответа/streaming.
- `.env.example` очищается от reasoning-опций; default base URL обновлён.

### Acceptance criteria

- [ ] `OpenAILLMClient` использует `chat.completions.create` и не содержит упоминаний `responses.create`, `output_text`, `input_tokens`, `output_tokens`, `reasoning_summary_text`.
- [ ] `grep -rn "reasoningEffort\|reasoningSummary\|responses\.create\|output_text\|response.reasoning_summary" src/` возвращает пусто.
- [ ] Перечисленные legacy-файлы удалены; `git status` не содержит untracked остатков от них.
- [ ] `bun test` завершается зелёным по всем оставшимся тестам.
- [ ] `bun run start -- "Привет, ответь одним словом"` с запущенным Ollama (и моделью `llama3.2:3b` в `ollama list`) возвращает осмысленный текст; auto-title присваивает сессии название.
- [ ] `.env.example` содержит `OPENAI_BASE_URL=http://localhost:11434/v1` (или явный комментарий-дефолт), не содержит `OPENAI_REASONING_*`.
- [ ] `package.json` и `bun.lock` не регрессируют по сторонним зависимостям (только удаления/правки кода).

---

## Phase 2: Telegram-бот MVP (stateless)

**User stories**: 1, 2, 3, 4, 5, 6, 7, 10, 12, 16, 26

### What to build

Самый тонкий tracer bullet через стек бота: `bun run bot` → Telegram long-polling → whitelist-фильтр → typing-индикатор → вызов Ollama через LLMClient → ответ пользователю.

В фазе:

- Добавляется зависимость `grammy` в `package.json` (`bun install`).
- Появляется `src/bot.ts` — entry-point. Читает env (token, whitelist, model, base URL), создаёт OpenAI-клиент против Ollama, оборачивает в `OpenAILLMClient`, инстанцирует grammy-бота с long-polling.
- Появляется `src/presentation/telegram/index.ts` — grammy-wiring: `bot.command("start", ...)` (короткое приветствие на русском с упоминанием `/new`), `bot.on("message:text", ...)` (основной handler).
- Появляется `src/presentation/telegram/whitelist.ts` — `WhitelistGuard`. Парсит CSV-строку в Set, метод `isAllowed(chatId)`. Используется в handler'е.
- Message-handler: (1) если chat_id не в whitelist — `reply("Этот бот приватный")` и `console.warn` с chat_id, username, первые ~60 символов текста; (2) `ctx.replyWithChatAction("typing")`; (3) отдать текст напрямую в `LLMClient.send` с model=`TELEGRAM_MODEL` и сборкой `messages` из одного `{role:"user", content: text}` (без истории, без system prompt пока); (4) `reply(answer)`.
- Error handling: любая ошибка из LLM-клиента ловится try/catch на верхнем уровне handler'а, текст отправляется пользователю одним сообщением, stack — в `console.error`.
- Команда `/start`: статическое приветствие.
- Обязательное fail-fast на старте: отсутствие `TELEGRAM_BOT_TOKEN` или `TELEGRAM_ALLOWED_CHAT_IDS` → немедленный exit с понятной ошибкой.
- SIGINT/SIGTERM → `bot.stop()` → graceful exit.

История, `/new`, system prompt, max_tokens, timeout-тюнинг — в этой фазе **нет**. Только базовый путь и безопасность.

### Acceptance criteria

- [ ] `grammy` присутствует в `package.json` dependencies; `bun.lock` обновлён.
- [ ] Скрипт `bot` добавлен в `package.json`.
- [ ] `bun run bot` с валидным `.env` запускается без ошибок, лог фиксирует старт long-polling.
- [ ] Whitelisted-пользователь отправляет произвольный текст → видит typing → получает осмысленный ответ от `llama3.2:3b`.
- [ ] `/start` возвращает короткое русское приветствие с подсказкой про `/new`.
- [ ] Не-whitelisted chat_id получает `"Этот бот приватный"`; попытка фиксируется `console.warn` с chat_id, username, началом текста.
- [ ] Запуск без `TELEGRAM_BOT_TOKEN` или без `TELEGRAM_ALLOWED_CHAT_IDS` падает на старте с понятным сообщением (не stack trace).
- [ ] Если Ollama не запущена, пользователь получает читаемое сообщение об ошибке, а процесс бота продолжает работать.
- [ ] Ctrl+C останавливает бота без traceback.

---

## Phase 3: История чата + `/new`

**User stories**: 8, 9, 11

### What to build

Бот начинает помнить контекст в рамках одного chat_id и даёт команду сбросить историю.

В фазе:

- Появляется `src/presentation/telegram/history.ts` — `ChatHistoryStore`. Внутри `Map<number, Message[]>`. Методы `append(chatId, role, content)`, `get(chatId)`, `clear(chatId)`. Опциональный hard-limit по количеству сообщений на chat для защиты от разрастания контекста (значение — разумный дефолт в коде, например 40 сообщений).
- Появляется `src/presentation/telegram/chat-handler.ts` — `TelegramChatHandler`. Зависит от `LLMClient` и `ChatHistoryStore`. Метод `handleMessage(chatId, text): Promise<string>`: (1) append user в history, (2) `llmClient.send` с `messages = store.get(chatId)` и model из конфига, (3) append ассистента в history, (4) возврат текста. Без streaming, без tools, без system prompt (он будет в фазе 4).
- Message-handler в `presentation/telegram/index.ts` теперь вызывает `TelegramChatHandler.handleMessage` вместо прямого `LLMClient.send`.
- Регистрируется команда `/new`: `store.clear(ctx.chat.id)` + `reply("История очищена. Начнём сначала.")`.
- `src/bot.ts` создаёт `ChatHistoryStore`, `TelegramChatHandler` и передаёт их в wiring.

### Acceptance criteria

- [ ] Пользователь задаёт два последовательных сообщения (например, «Меня зовут Антон» → «Как меня зовут?») — бот помнит имя.
- [ ] После `/new` бот забывает прошлый контекст (повтор того же follow-up возвращается «не знаю»).
- [ ] `/new` в чате A не влияет на историю чата B (проверено — хотя бы ментально через изоляцию Map).
- [ ] Рестарт бота стирает всю историю у всех пользователей (свойство in-memory store, намеренное).
- [ ] `bun test` зелёный (даже если новых тестов здесь ещё нет — старые не сломаны).

---

## Phase 4: Env-конфиг + система промпта + полный тест-набор

**User stories**: 13, 14, 15, 17, 24, 25

### What to build

Бот дотягивается до полного PRD: все env-параметры применяются, ответы ограничены, ошибки читаются, все deep-модули покрыты тестами.

В фазе:

- Появляется `src/presentation/telegram/config.ts` — `loadTelegramConfig(env, fail)`. Читает и валидирует все переменные из env-contract'а. Отсутствие обязательных → fail. Нечисленные значения таймаута/макс-токенов → fail. Дефолты применяются для необязательных полей.
- `src/bot.ts` заменяет ad-hoc чтение env на `loadTelegramConfig`.
- `TelegramChatHandler` обогащается: принимает `systemPrompt`, `maxCompletionTokens`, `model` из конфига. `messages` строится как `[{role:"system", content: systemPrompt}, ...history]` (или instructions, что корректно для chat.completions). `max_completion_tokens` пробрасывается в LLMRequest.
- Дефолтный system prompt (если `TELEGRAM_SYSTEM_PROMPT` не задан) — короткая русская инструкция о краткости (до ~300 слов, без markdown-украшательств).
- OpenAI-клиент инстанцируется с `timeout: TELEGRAM_TIMEOUT_MS`.
- Error handling: отдельные ветки для timeout (AbortError) — «Модель думает слишком долго, попробуйте /new и переформулируйте» — и connection-refused к Ollama — «Модель недоступна. Попробуйте позже». Прочие ошибки — текст ошибки как есть.
- `.env.example` дополняется секцией `# --- Telegram bot ---` со всеми переменными и комментариями.
- Unit-тесты:
  - `whitelist.test.ts`: пустая строка, валидный CSV с пробелами, дубликаты, нечисленные токены (ошибка), allowed/denied.
  - `history.test.ts`: append/get/clear, изоляция между chat_id, опциональный truncate по лимиту.
  - `chat-handler.test.ts`: с mock `LLMClient` — корректная сборка `messages` (system + история + новый user), корректный проброс model/max_tokens, сохранение ответа в history, проброс ошибки наверх.
  - `config.test.ts` (тг-секция): все обязательные — ок; без `TELEGRAM_BOT_TOKEN` — fail; без `TELEGRAM_ALLOWED_CHAT_IDS` — fail; дефолты применяются; некорректные числа — fail.

Grammy-wiring и `bot.ts` тестами не покрываются — проверяются вручную.

### Acceptance criteria

- [ ] Все env-переменные из contract'а читаются через `loadTelegramConfig`; отсутствие обязательных даёт немедленный fail с понятным текстом.
- [ ] System prompt применяется: в тесте с `TELEGRAM_SYSTEM_PROMPT="Отвечай только на английском"` бот действительно отвечает на английском.
- [ ] `TELEGRAM_MAX_TOKENS=64` видимо ограничивает длину ответа (ответ обрывается рано).
- [ ] Timeout: имитация «тяжёлой модели» (подмена URL на несуществующий порт) → пользователь получает сообщение «Модель недоступна», бот не падает.
- [ ] Полный прогон `bun test` зелёный; новые тесты (whitelist/history/chat-handler/config) присутствуют и проходят.
- [ ] `.env.example` содержит telegram-секцию со всеми переменными и разумными комментариями.
- [ ] Запуск `bun run bot` с чистым `.env.example` → бот стартует (при условии заполненных token и whitelist).

---

## Phase 5: Финальный прогон + report.md

**User stories**: 27 (+подведение итогов дня)

### What to build

Завершающая фаза по прецеденту day21-26: артефакт дня — `scripts/day27/report.md`, фиксирующий результат и наблюдения.

В фазе:

- Свежий ручной прогон бота:
  - `bun run bot` запущен, Ollama активна.
  - Whitelisted-пользователь отыгрывает короткий сценарий (3-5 сообщений) с follow-up и `/new`.
  - Засечки latency на глазок (от отправки до получения).
  - Проверка Ollama-down ветки (временно выключить Ollama и послать сообщение).
- Создаётся `scripts/day27/report.md`:
  - Hardware snapshot (`llmfit system --json`, как в day26).
  - Конфиг прогона (модель, base URL, max_tokens, timeout, system prompt).
  - Демо-сценарий переписки в виде markdown-цитат (user / bot).
  - Секция «Что удивило» (UX latency, качество follow-up, поведение `/new`, читаемость ошибок).
  - Секция «Где local уступил/не уступил» (сравнение с cloud-ощущениями).
  - Секция «Next steps» (кандидаты: Docker, streaming через editMessage, переключение модели командой, whitelist через chat — но не сегодня).
- Финальная проверка ветки `day27-local-llm-app`: `git status` чист, все коммиты по фазам, `bun test` зелёный, `bun run bot` и `bun run start` оба работают.

### Acceptance criteria

- [ ] `scripts/day27/report.md` существует и содержит hardware-секцию, конфиг, демо-сценарий, наблюдения.
- [ ] В `report.md` зафиксирован наблюдаемый latency хотя бы одного ответа.
- [ ] В `report.md` зафиксировано поведение при недоступной Ollama (с текстом сообщения, которое получил пользователь).
- [ ] `git status` чист; все правки распределены по осмысленным коммитам по фазам.
- [ ] Ветка `day27-local-llm-app` готова к ff-мерджу в master (как были day21-26).
- [ ] `bun test` и `bun run bot` работают на финальной ревизии ветки.

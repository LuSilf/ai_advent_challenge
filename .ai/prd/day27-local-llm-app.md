# Day 27 — Интеграция локальной LLM в реальное приложение (Telegram-бот)

## Problem Statement

В день 26 я доказал, что OpenAI SDK ходит в локальную Ollama через chat.completions API без единой правки, и зафиксировал в next-steps намерение «интегрировать локальную модель в основной продукт». Но при попытке сделать это сегодня обнаружилось несколько препятствий, каждое из которых по отдельности блокирует переезд:

- **Основной чат-путь в репе построен на OpenAI Responses API** (`responses.create`, `output_text`, `input_tokens`, reasoning summaries, reasoning effort). Ollama этот endpoint не реализует — реально совместим только chat.completions. Поэтому «сменить base URL в `.env` и дело с концом» не работает: SDK упирается в 404 на `/v1/responses`.
- **Responses API и сопутствующий reasoning-конфиг уже диффузно разлили по кодбазе** — они торчат в LLM-клиенте, доменных моделях, чат-сервисе, конфиге, главном CLI, REPL, scheduler'е, трёх eval-скриптах и debug-логгере. Попытка сохранить оба пути «на всякий случай» раздувает код и требует вечного support двух форм одного запроса.
- **В `src/` живёт целая legacy-экосистема** от предыдущего рефакторинга (отдельный CLI, REPL, request-builder, memory, strategy, reconciliation), которая не импортируется из основного `main.ts`, но тоже держит Responses API. Она работает, но её никто не запускает — это мёртвый вес, который без необходимости дублирует боль при любой правке.
- **У меня нет ни одного живого клиентского приложения**, использующего локальную LLM. Отчёт day26 показывает, что llama3.2:3b — быстрая (38 tps) и точная для коротких запросов, но без приложения это просто число в таблице.

В результате даже «просто отправить промпт в локальную модель из внешнего приложения» — на текущий момент в репе не реализуется за один вечер честно: сначала надо резать Responses API, потом строить приложение.

## Solution

Две последовательные части в одной ветке `day27-local-llm-app`.

**Часть A — Хирургическая ампутация Responses API.** Переписываем `OpenAILLMClient` на `chat.completions.create` (через тот же openai-npm). Тот же клиент универсален: он ходит и в Ollama, и в OpenRouter, и в OpenAI Cloud, потому что chat.completions поддерживают все три. Из доменных моделей и чат-сервиса вырезаем поля `reasoningEffort`/`reasoningSummary`, из `StreamEvent` — вариант `reasoning_summary`, из конфига — парсинг `OPENAI_REASONING_*`. Auto-title в `main.ts` и в REPL переписываем на `chat.completions.create`. Default `OPENAI_BASE_URL` меняем на `http://localhost:11434/v1`. Legacy-экосистему (`cli.ts`, `repl.ts`, `request.ts`, `memory.ts`, `strategy.ts`, `reconciliation.ts` и их тесты) удаляем целиком — она давно никем не запускается.

**Часть B — Telegram-бот как первое приложение на локальной LLM.** На `grammy` + Bun, long-polling, новый entry-point `bun run bot`. Запросы идут через OpenAI SDK (теперь уже на chat.completions) в Ollama. Модель по умолчанию — `llama3.2:3b` (по отчёту day26 это единственный local-кандидат для real-time UX на текущем железе). История хранится in-memory в `Map<chat_id, messages[]>` — никакого SQLite, никакого SessionService. Команды минимальные: `/start` (приветствие), `/new` (сброс истории чата). Whitelist по chat_id из env: незнакомые чаты получают вежливый отказ. Ответы возвращаются батчем с typing-индикатором на время инференса. Длина ответа ограничена system prompt'ом (кратко, ~300 слов) и `max_tokens=768` как hard cap. Таймаут — 180 секунд. Ошибки (Ollama лежит, модель не загружена) показываются пользователю как есть.

Бот живёт в `src/presentation/telegram/` по канону текущего слоистого проекта. Внутри выделены deep-модули: `WhitelistGuard`, `ChatHistoryStore`, `TelegramChatHandler`, `loadTelegramConfig` — каждый с простой testable поверхностью. Grammy-wiring и entry-point — тонкая glue-прослойка.

Deployment roadmap — local → Docker → VPS — прописан как направление на будущее. Сегодня закладываем только env-driven конфиг (ничего не хардкодим), чтобы в будущих днях Dockerfile лёг сверху без рефакторинга.

## User Stories

1. Как автор challenge'а, я хочу запустить `bun run bot` на локальной машине и начать общаться с ботом в Telegram, использующим llama3.2:3b через мою Ollama, чтобы получить первое живое приложение на локальной LLM.
2. Как владелец бота, я хочу задавать `TELEGRAM_BOT_TOKEN` через `.env`, чтобы не коммитить секрет в репу.
3. Как владелец бота, я хочу задавать список разрешённых chat_id через `TELEGRAM_ALLOWED_CHAT_IDS` (CSV), чтобы только я и доверенные лица могли тратить ресурсы моей машины на инференс.
4. Как случайный пользователь, попавший на бота не из whitelist, я хочу получить вежливое сообщение «этот бот приватный», чтобы понимать, что бот жив и дело во мне, а не в сервере.
5. Как владелец бота, я хочу видеть в консольных логах попытки незнакомых chat_id (с chat_id, username, первые символы сообщения), чтобы знать о них, но не реагировать.
6. Как пользователь бота, я хочу отправить любое текстовое сообщение и получить ответ от локальной модели, чтобы минимальный use case — «задал вопрос, получил ответ» — работал.
7. Как пользователь бота, я хочу видеть typing-индикатор пока модель думает, чтобы понимать, что бот не упал, а инференс идёт.
8. Как пользователь бота, я хочу, чтобы следующее сообщение учитывало контекст предыдущих (в рамках одного чата), чтобы можно было задавать follow-up вопросы.
9. Как пользователь бота, я хочу командой `/new` сбросить историю текущего чата, чтобы начать новую тему без load от старого контекста.
10. Как пользователь бота, я хочу, чтобы команда `/start` показывала короткое приветствие и подсказку про `/new`, чтобы понять, как пользоваться ботом.
11. Как владелец бота, я хочу, чтобы история чатов жила только в памяти процесса и пропадала при рестарте, чтобы минимизировать поверхность для утечки приватных сообщений и не городить SQLite-слой.
12. Как владелец бота, я хочу задавать модель Ollama через `TELEGRAM_MODEL` в env, чтобы можно было быстро переключить бот с llama3.2:3b на, например, qwen2.5-coder:3b без пересборки кода.
13. Как владелец бота, я хочу задавать default system prompt через `TELEGRAM_SYSTEM_PROMPT` в env (с разумным дефолтом на случай отсутствия), чтобы менять стиль бота без правки кода.
14. Как владелец бота, я хочу ограничивать максимальный размер ответа через `TELEGRAM_MAX_TOKENS` (дефолт 768), чтобы модель не генерировала по 20 секунд туманные простыни.
15. Как владелец бота, я хочу задавать таймаут запроса через `TELEGRAM_TIMEOUT_MS` (дефолт 180000), чтобы покрыть реальные задержки локальной модели без опасности зависания.
16. Как пользователь бота, я хочу получить понятное сообщение об ошибке, если Ollama не запущена или модель не загружена, чтобы не гадать, почему бот молчит.
17. Как пользователь бота, я хочу получить понятное сообщение об ошибке, если запрос в модель превысил таймаут, чтобы знать, что запрос отменён и можно послать новый.
18. Как автор, я хочу, чтобы `OpenAILLMClient` работал через `chat.completions` и ходил в любой OpenAI-совместимый endpoint (Ollama, OpenRouter, OpenAI), чтобы один клиент закрывал все провайдеры без специальной абстракции.
19. Как автор, я хочу, чтобы после переезда REPL-команда `bun run start` продолжала работать (теперь против Ollama по дефолту), чтобы не потерять основной CLI в процессе.
20. Как автор, я хочу, чтобы auto-title (генерация названия сессии по первому обмену) продолжал работать после ампутации Responses API, чтобы UX REPL не регрессировал.
21. Как автор, я хочу, чтобы в `.env.example` были удалены устаревшие `OPENAI_REASONING_EFFORT` и `OPENAI_REASONING_SUMMARY` и появилось корректное значение default base URL для Ollama, чтобы новый чекаут проекта не путал пользователя.
22. Как автор, я хочу, чтобы legacy-файлы `src/cli.ts`, `src/repl.ts`, `src/request.ts`, `src/memory.ts`, `src/strategy.ts`, `src/reconciliation.ts` и их тесты были удалены, чтобы не поддерживать Responses API в мёртвом коде.
23. Как автор, я хочу, чтобы тесты после ампутации и добавления бота прошли целиком (`bun test`), чтобы не тащить сломанный CI в последующие дни.
24. Как автор, я хочу, чтобы новые deep-модули (whitelist-guard, chat-history-store, chat-handler, config-loader) имели unit-тесты на внешнее поведение, чтобы будущий рефакторинг бота не ломал его молча.
25. Как автор, я хочу, чтобы grammy-wiring и entry-point оставались тонкими (без бизнес-логики), чтобы их можно было не тестировать без потери уверенности.
26. Как автор, я хочу, чтобы в `package.json` появился скрипт `"bot"`, чтобы бот запускался одной командой.
27. Как автор, я хочу, чтобы новый PRD (`day27-local-llm-app.md`) лёг в `.ai/prd/` рядом с day26, чтобы история проекта оставалась консистентной.

## Implementation Decisions

### Часть A — Ампутация Responses API

- **Единый универсальный LLM-клиент.** `OpenAILLMClient` переписывается на `chat.completions.create`. Он становится универсальным OpenAI-совместимым клиентом и корректно работает против Ollama, OpenRouter и OpenAI Cloud без ветвлений. Dual-provider абстракция не вводится (не нужна).
- **Контракт LLMClient не меняется по форме.** Интерфейс порта `LLMClient` остаётся с теми же методами (`send`, `stream`), но из `StreamEvent` убирается вариант `reasoning_summary` (он был Responses-специфичен). Реализация под капотом теперь режет chat.completions delta-chunks и усечение `choices[0].finish_reason`.
- **Доменные модели.** Из `GenerationParams` удаляются поля `reasoningEffort` и `reasoningSummary`. Все места, где они пробрасывались (chat-service, main.ts, REPL, scheduler, rag-eval-скрипты), чистятся одновременно.
- **Конфиг.** Из `AppConfig` убираются `reasoningEffort`/`reasoningSummary`, из `loadConfig` — парсинг `OPENAI_REASONING_EFFORT` и `OPENAI_REASONING_SUMMARY`. Default `OPENAI_BASE_URL` меняется с `https://api.openai.com/v1` на `http://localhost:11434/v1`. `.env.example` приводится в соответствие: исчезают reasoning-опции, обновляется default base URL и добавляются telegram-переменные.
- **Auto-title.** Двум точкам в коде (основной entry в `main.ts` и REPL) переписываются вызовы `openaiClient.responses.create` на `openaiClient.chat.completions.create`; `output_text` заменяется на `choices[0].message.content`.
- **Debug-logger.** Функции, форматирующие request/response debug-вывод, переводятся на chat.completions формат (`prompt_tokens`/`completion_tokens` вместо `input_tokens`/`output_tokens`, `choices` вместо `output`).
- **Tool-calling.** Парсинг tool_calls переносится с Responses-формата (`output[].type === "function_call"` с полями `call_id`, `name`, `arguments`) на chat.completions-формат (`choices[0].message.tool_calls[]` с полями `id`, `function.name`, `function.arguments`). Построение tools в request также мигрирует на chat.completions-shape (`{type: "function", function: {name, description, parameters}}`).
- **Structured output.** JSON-schema response format на chat.completions-стороне задаётся через `response_format: {type: "json_schema", ...}`, а не через `text.format`. Поведение для вызывающих остаётся тем же.
- **Token accounting.** `usage.input_tokens` → `usage.prompt_tokens`, `usage.output_tokens` → `usage.completion_tokens`. CostService продолжает работать как прежде; для Ollama-моделей (которых нет в modelRepo) возвращается `null`, что не ломает существующих вызывающих.
- **Удаление legacy.** Файлы `src/cli.ts`, `src/repl.ts`, `src/request.ts`, `src/memory.ts` (именно корневой, не `src/domain/services/memory-service.ts`), `src/strategy.ts`, `src/reconciliation.ts` удаляются целиком вместе со своими тестами (`src/request.test.ts`, `src/strategy.test.ts`, `src/memory.test.ts`, `src/reconciliation.test.ts`). Эти модули не импортируются из актуального `main.ts` и REPL'а и были dead code, удерживающий старый Responses API.

### Часть B — Telegram-бот

- **Зависимости.** Добавляется `grammy` как прод-зависимость. Никаких `node-telegram-bot-api` и т.п. `openai` npm-клиент переиспользуется.
- **Layout.** Вся логика бота живёт в `src/presentation/telegram/` — продолжает слой `presentation/`, в котором уже есть `repl/`. Entry-point — отдельный `src/bot.ts` (по соседству с `src/main.ts`, `src/scheduler.ts`, `src/indexing.ts`).
- **Скрипт.** В `package.json` добавляется `"bot": "bun run src/bot.ts"`.
- **Конфиг бота.** Отдельный `loadTelegramConfig(env, fail)` читает переменные: `TELEGRAM_BOT_TOKEN` (обязательная), `TELEGRAM_ALLOWED_CHAT_IDS` (обязательная, CSV), `TELEGRAM_MODEL` (дефолт `llama3.2:3b`), `OPENAI_BASE_URL` (дефолт `http://localhost:11434/v1`), `TELEGRAM_TIMEOUT_MS` (дефолт 180000), `TELEGRAM_MAX_TOKENS` (дефолт 768), `TELEGRAM_SYSTEM_PROMPT` (дефолт — короткая русская инструкция «краткий ассистент, до 300 слов»). Отсутствие обязательных переменных — немедленный fail с понятным сообщением. Бот **не читает** `modelRepo` и **не использует** `SessionService` — он изолирован от основного CLI-конфига.
- **WhitelistGuard.** Deep-модуль. Конструктор принимает CSV-строку и парсит её в `Set<number>`: пустые токены игнорируются, пробелы триммятся, нечисленные значения вызывают ошибку на старте (а не во время первого сообщения). Метод `isAllowed(chatId: number): boolean` — O(1) lookup.
- **ChatHistoryStore.** Deep-модуль. Внутри — `Map<number, Array<{role: "user"|"assistant", content: string}>>`. Методы: `append(chatId, role, content)`, `get(chatId): Message[]`, `clear(chatId): void`. Опционально: жёсткая граница по количеству сообщений на chat (`HISTORY_LIMIT_PER_CHAT`), чтобы контекст не разрастался. Пережидает только жизнь процесса; при рестарте всё сбрасывается — это осознанное решение.
- **TelegramChatHandler.** Deep-модуль. Зависит от `LLMClient` (интерфейс, не конкретика), `ChatHistoryStore`, системного промпта и параметров модели/max-токенов. Один метод `handleMessage(chatId, userText): Promise<string>`: (1) append user-сообщения в history, (2) сборка LLMRequest из history + system prompt + model id, (3) `llmClient.send(...)`, (4) append ответа в history, (5) возврат текста. Без tool-use, без streaming, без structured output. Это единственная точка, где бизнес-логика бота знает про LLM.
- **Grammy wiring (presentation/telegram/index.ts).** Глупая прослойка: регистрирует `bot.command("start", ...)`, `bot.command("new", ...)`, `bot.on("message:text", ...)`. Обработчики в message'ах: (1) проверка `WhitelistGuard.isAllowed(ctx.chat.id)`; если нет — `reply("Этот бот приватный")` и `console.warn` c chat_id + username + началом текста, (2) `ctx.replyWithChatAction("typing")`, (3) `TelegramChatHandler.handleMessage(...)`, (4) `reply(answer)`. Ошибки из handler'а ловятся одним try/catch на верхнем уровне и отправляются пользователю текстом плюс логируются.
- **Entry-point (src/bot.ts).** Читает env, вызывает `loadTelegramConfig`, инстанцирует `new OpenAI({apiKey: "ollama", baseURL: cfg.baseUrl, timeout: cfg.timeoutMs, maxRetries: 0})` (apiKey фиктивный — Ollama не проверяет, но openai-клиент требует непустую строку), оборачивает в `OpenAILLMClient`, создаёт `ChatHistoryStore`, `WhitelistGuard`, `TelegramChatHandler`, передаёт всё в grammy-wiring, запускает `bot.start()` в long-polling режиме. Обработка SIGINT/SIGTERM для graceful shutdown.
- **Длина ответа.** Ограничена двумя независимыми способами: (1) system prompt содержит явную инструкцию «отвечай кратко, до ~300 слов»; (2) `max_completion_tokens=768` передаётся в LLMRequest.params как hard cap. Оба параметра — из env.
- **Таймаут.** Собственный конфиг бота: дефолт 180000 мс (против 30000 мс в основном CLI). Передаётся в OpenAI-клиент через `timeout`.
- **Ошибки.** Три семейства: (a) `AbortError`/timeout → «Модель думает слишком долго, попробуйте снова или /new», (b) connection error к Ollama → «Модель недоступна. Попробуйте позже», (c) прочее → текст ошибки одним сообщением. Всё — через try/catch в grammy-handler'е. Stack trace в консоль, пользователю — только текст.
- **Конкурентность.** На текущем железе (GTX 1650 4 GB) Ollama обрабатывает запросы последовательно — параллелизма нет. Бот ничего специально не сериализует; если параллельно придут два сообщения, второе просто дольше будет ждать typing. Очередь не городим.
- **Env-driven, без хардкода.** Всё конфигурируемо. Deployment roadmap (Docker, VPS) сегодня не закрываем, но код сегодня не делает допущений про «локальную машину», кроме того, что `OPENAI_BASE_URL` по дефолту смотрит на `localhost:11434`.

## Testing Decisions

**Что такое хороший тест в этом PRD:** проверяет внешнее поведение модуля (то, что видят его вызывающие), а не приватные детали реализации. Конкретно — не мокает grammy, не мокает openai-клиент внутри `OpenAILLMClient` на уровне HTTP, а использует его собственный публичный контракт или легко подменяемый абстрактный `LLMClient`.

**Тестируются:**

- **`OpenAILLMClient` (новая реализация).** Moccuется OpenAI-клиент (и его `chat.completions.create`). Проверяется: корректное построение request (messages, system через role=system, tools в нужной форме, response_format, max_completion_tokens, temperature, top_p); корректный parsing ответа (content, prompt_tokens/completion_tokens, tool_calls, finish_reason); корректная работа streaming (аккумуляция delta, финальный `done` event). Прежние тесты Responses-специфики удаляются вместе с кодом. Референс — тот же стиль, что текущий `llm-client.test.ts` (но без reasoning_summary и output_text).
- **`WhitelistGuard`.** Валидный CSV с пробелами, пустая строка, дубликаты, нечисленные токены (ошибка), `isAllowed` для присутствующих и отсутствующих chat_id.
- **`ChatHistoryStore`.** `append` добавляет в порядке вызовов, `get` возвращает правильный срез для каждого chat_id (изоляция между чатами), `clear(chatId)` чистит только указанный чат, не трогает соседей.
- **`TelegramChatHandler`.** С mock'ом `LLMClient`: (1) первое сообщение пользователя приводит к LLMRequest с `messages = [user-message]` и указанным system prompt; (2) ответ модели сохраняется в history; (3) следующий вызов видит в LLMRequest.messages оба прошлых + новый user-message; (4) `model`, `max_completion_tokens` корректно пробрасываются в request; (5) если mock выкидывает ошибку — `handleMessage` пробрасывает её наверх (обработка — в grammy-слое).
- **`loadTelegramConfig`.** Все обязательные env заданы → корректный объект. Отсутствует `TELEGRAM_BOT_TOKEN` или `TELEGRAM_ALLOWED_CHAT_IDS` → fail с понятным сообщением. Дефолты применяются для необязательных полей. Некорректные числовые значения → fail.

**Обновляются (моки правятся под chat.completions):**

- `src/domain/services/chat-service.test.ts`
- `src/domain/services/memory-service.test.ts`
- `src/domain/services/rag-judge-service.test.ts`
- Любые другие тесты, которые сейчас завязаны на форму Responses API (faithfulness-judge, llm-reranker-service, rag-evaluation, task-state-service — ревизия по факту).

**Удаляются (вместе с legacy-кодом):**

- `src/request.test.ts`, `src/strategy.test.ts`, `src/memory.test.ts`, `src/reconciliation.test.ts`.

**Не тестируются (тонкая glue):**

- `src/bot.ts` — entry-point, только wiring.
- `src/presentation/telegram/index.ts` — grammy-обёртка, регистрация handlers. Проверяется вручную: запустил бота, отправил сообщение, получил ответ.

**Приёмка для части A:** `bun test` — зелёный. `bun run start` в REPL работает против Ollama по умолчанию. Auto-title генерирует название сессии после первого обмена.

**Приёмка для части B:** `bun run bot` запускается с валидным `.env`. Бот в Telegram отвечает whitelisted-пользователю осмысленным сообщением. Команда `/new` сбрасывает контекст. Не-whitelisted chat_id получает отказ и попадает в console.warn. Остановка по Ctrl+C — graceful, без traceback.

## Out of Scope

- **Dual-provider абстракция.** Не нужна: один `OpenAILLMClient` на chat.completions уже универсален.
- **Docker / docker-compose / Dockerfile.** Закладываем env-driven конфиг, но сам контейнер — отдельный день.
- **VPS deployment.** Отдельный день. Сегодня бот живёт на локальной машине, запуск — `bun run bot` руками.
- **Tool-use в боте, RAG в боте, MCP в боте.** Бот — чистый чат без внешних инструментов. RAG-индекс остаётся достоянием REPL и eval-скриптов.
- **Streaming в Telegram через editMessageText.** Принято решение: typing + батч. editMessage-стриминг — отдельный nice-to-have.
- **Persistent storage для бота.** In-memory `Map`. Никакого SQLite, никакой миграции, никаких сессий.
- **Трогать `modelRepo`.** Бот модель читает из env, не из БД. Cloud-модели в `modelRepo` остаются как есть — они нужны REPL и scheduler'у.
- **Рефакторинг cost-service под Ollama-модели.** Для моделей без pricing в репозитории cost возвращается null — это уже текущее поведение, достаточное.
- **Новые eval-сценарии на local-модели.** Next steps day26 упоминали «RAG eval с llama как answerer + gpt-5-nano как judge» — это отдельная задача следующих дней, сегодня её не делаем.
- **UI для бота (кнопки, inline-меню, forward).** Только текстовые сообщения и две slash-команды.
- **Поддержка групп и каналов.** Только приват-чаты. Если grammy прокинет group update — проверяем chat_id через whitelist (группам нечего там делать) и игнорируем.
- **Голосовые сообщения, фото, файлы.** Только текст; на прочие типы message — игнор или короткий «понимаю только текст».

## Further Notes

- **Почему Telegram, а не CLI.** Предыдущие дни много раз порождали CLI-артефакты (main REPL, scheduler, eval-скрипты) — ещё одна CLI-утилита была бы скучной и не тестировала внешний канал. Telegram добавляет новое качество: LLM теперь отвечает извне, с мобильника, в реальном мессенджере. Это и демонстрация, и будущий плацдарм для VPS.
- **Почему grammy, а не telegraf.** TypeScript-first, Bun-friendly, поддерживаемый, с чистым API. Telegraf работает, но его типы старше, API местами унаследован от Telegraf v3.
- **Почему именно llama3.2:3b.** Отчёт day26: 38 tps vs 9 tps у qwen2.5-coder:7b на тех же ответах. Для Telegram UX с таймаутом 180 сек 3B даёт реальный user-perceived latency 5–15 сек; 7B на том же железе — 30–60 сек, на грани разочарования. Пользователь может переключиться на qwen через env, если ему нужна кодовая специализация и он готов ждать.
- **Почему in-memory история, а не SessionService.** SessionService завязан на SQLite, модели, session-таблицу, message-таблицу, context-стратегию. Это оверкилл для «помню последнюю пачку сообщений в оперативке». Потери при рестарте — признак, а не баг: приватные сообщения не оседают на диске.
- **Почему удаляем legacy (`src/cli.ts` и ко).** Эти файлы не импортируются из актуального `main.ts` и REPL'а, но держат Responses API. Любая ампутация требовала бы правки и их; удалить — проще и чище. Если когда-то что-то понадобится — git log помнит.
- **Почему default `OPENAI_BASE_URL` меняется на Ollama.** После ампутации Responses API клиент универсален; но дефолт «смотрит в облако» был осмысленным только при Responses API, потому что Responses — фича OpenAI, а не Ollama. Теперь дефолт — local, всё остальное — через env override. Это соответствует духу challenge'а: local-first.
- **Риск нарушения приватности whitelist.** Leak `TELEGRAM_BOT_TOKEN` приводит к тому, что любой может узнать username бота, но не сможет им говорить без chat_id в whitelist. Leak `.env` целиком — более серьёзно, но это не специфично для этого дня.
- **Что дальше.** После дня 27 логичный следующий шаг — Docker-образ бота (`bun` image + volume для `.env`) и отдельно Ollama. Потом — VPS (тут Ollama требует GPU или приемлемой CPU производительности). Дальше — возможно, streaming через editMessage и переключение моделей командой в чате.

# Day 30 — Локальная LLM как приватный HTTP-сервис

## Problem Statement

К концу 29 дня в репе есть всё, чтобы локальная LLM была полноценной — Ollama с llama3.2:3b и qwen2.5-coder:7b живёт на хосте, есть проверенный универсальный `OpenAILLMClient` на chat.completions (day27), есть Telegram-бот, есть local RAG и оптимизационные эксперименты (day28-29). Но «приватного сервиса» как такового нет:

- Ollama по дефолту слушает на `localhost:11434` без авторизации. Открыть её прямо в LAN — значит дать любому пользователю сети неограниченный доступ к моей машине: можно спамить запросами в очередь, нагружать GPU, выкачивать модели через `/api/pull`, удалять их через `/api/delete`. Никаких ключей, никаких лимитов, никакого аудита.
- Все клиенты (Telegram-бот day27, eval-скрипты day28-29) хардкодят `OPENAI_BASE_URL=http://localhost:11434/v1` и могут работать только если запущены на той же машине, что и Ollama. Я не могу подключить к этой LLM ни ноутбук жены через Wi-Fi, ни мобильный браузер из локалки, ни внешний скрипт.
- Нет ни одного защитного слоя между сетью и моделью: если кто-то пришлёт `messages` на 200K токенов, Ollama честно попытается распарсить и упадёт по OOM на 4 GB VRAM, утянув за собой всю систему. Защита от «разрывных» контекстов лежит на совести каждого клиента.
- Нет демо-точки, в которой я могу открыть браузер и просто чатиться с локальной моделью «как с ChatGPT». Telegram-бот это решает только частично — он завязан на Telegram-инфраструктуру, нужен токен, нужен whitelist по chat_id.
- Нет воспроизводимого артефакта (как `report.md` дней 26 и 29), показывающего, что сервис стабилен под несколькими параллельными запросами и что rate limit / max context реально срабатывают, а не существуют только на словах.

В итоге у меня есть быстрая локальная LLM, но нет «приватного AI-сервиса» в продуктовом смысле этого слова.

## Solution

Поднимаем тонкий HTTP-gateway перед Ollama: OpenAI-совместимый, с авторизацией по Bearer-ключу, rate limit per-key, hard cap по входным токенам, минимальным web-UI для чата и health-check'ом. Всё в LAN-режиме (`0.0.0.0:PORT` на домашнем ноуте), без публичного выхода — внешний доступ откладывается на следующие дни.

Конкретно:

1. **HTTP-сервер на Hono поверх Bun.** Hono даёт legkij router, middleware-ям (auth, rate-limit) и SSE-стриминг из коробки, при этом весит копейки и нативно дружит с Bun. Альтернатива (`Bun.serve` без фреймворка) была отвергнута: 5 эндпоинтов + 3 middleware вручную диспатчить — это писать тот же Hono самим.

2. **API — OpenAI-совместимый chat.completions.** Контракт: `POST /v1/chat/completions` принимает `{model, messages, stream?, temperature?, max_tokens?, top_p?, ...}` и возвращает либо обычный JSON (`stream:false`), либо `text/event-stream` SSE с delta-чанками (`stream:true`) — точно как OpenAI и точно как Ollama-OpenAI-shim. Внутри сервис проксирует запрос в Ollama и пробрасывает ответ. Дополнительный эндпоинт: `GET /v1/models` — возвращает список разрешённых для этого сервиса моделей. Health: `GET /health` — без auth, отвечает `{status, ollama: "up|down", models: [...]}`. Web-UI: `GET /` — отдаёт single-page HTML.

3. **Аутентификация — Bearer API key из env.** Переменная `LLM_SERVICE_API_KEYS` — CSV-список ключей формата `keyId:secret` (e.g. `personal:sk-xxx,wife:sk-yyy`). Без БД, без OAuth, без rotation API. Все защищённые эндпоинты требуют `Authorization: Bearer <secret>`; неверный/отсутствующий ключ → HTTP 401. KeyId извлекается, прокидывается в rate-limiter и в access-логи. Для UI ключ берётся из `localStorage` или промптится модалкой при первом заходе.

4. **Rate limit per-key, token bucket, in-memory.** На каждый keyId — отдельная корзина с параметрами `capacity` (burst) и `refillPerSec`. Дефолт: 10 запросов burst, 1 RPS пополнение. Превышение → HTTP 429 с `Retry-After`. Один процесс, один Map, без Redis. Ограничение: при рестарте корзины обнуляются — это осознано (in-memory сервис, рестарт редкий).

5. **Max context — точный подсчёт токенов.** Перед отправкой в Ollama считаем токены всего `messages[].content` (включая system) через `gpt-tokenizer` (cl100k_base). Если больше `LLM_SERVICE_MAX_INPUT_TOKENS` (дефолт 6000, чтобы оставить запас на ответ при контексте 8192 у llama3.2) — отказываем с HTTP 413 Payload Too Large и понятным телом `{error: "Input too large", limit: 6000, got: 8421}`. Это защищает GPU от OOM и не даёт «разрывным» клиентам положить сервис.

6. **Минимальный web-UI на одной странице.** Один `index.html` (плюс inline CSS/JS), отдаётся как статика. Функционал: textarea для сообщения, кнопка «Send», список истории чата (роли + текст), модалка для ввода API key, выбор модели из dropdown'а (источник — `/v1/models`). Стриминг ответа через `EventSource` или fetch+ReadableStream. История хранится только в браузере (`localStorage`), ничего серверу не персистится — это «client-side chat session».

7. **Allowlist моделей.** Env-переменная `LLM_SERVICE_ALLOWED_MODELS` — CSV (дефолт `llama3.2:3b,qwen2.5-coder:7b`). Запрос с моделью вне списка → HTTP 400. Это страховка от того, что клиент попросит несуществующую или ту, что упадёт по VRAM.

8. **Запуск.** `bun run src/server.ts`. Без systemd, без Docker, без демонизации — пользователь сознательно выбрал «просто bun run» (запускается из tmux/терминала). Скрипт `"server": "bun run src/server.ts"` добавляется в `package.json`.

9. **Артефакт стабильности.** `scripts/day30/load-test.ts` — TS-скрипт, который через `Promise.all` отправляет N параллельных chat.completions и собирает p50/p95 latency, error rate, распределение HTTP-кодов. Прогоны: N=1, 2, 5, 10. Дополнительно проверяет: rate limit (5 быстрых запросов с одного ключа подряд → ожидаем 429 после исчерпания burst), max-context (запрос с 7000+ токенов → 413), bad auth (запрос без ключа → 401). Результат — `scripts/day30/report.md` по канону day26/29.

10. **Layout.** Сервер живёт в `src/presentation/http/` (deep-модули + Hono-wiring), entry-point — `src/server.ts` (по аналогии с `src/bot.ts`/`src/scheduler.ts` из day27). Это keeps cohesion с layered-архитектурой проекта.

11. **Тесты — Red-Green на все deep-модули.** Unit-тесты для `ApiKeyAuth`, `RateLimiter`, `TokenCounter`, `loadServerConfig`. Hono-wiring и `OllamaProxy` (тонкая обёртка над fetch) не тестируются в юнитах — на них работает live load-test. Стиль и shape моков — как в day27 (`whitelist-guard.test.ts`, `chat-history-store.test.ts`).

## User Stories

1. Как автор challenge'а, я хочу запустить `bun run server` и получить рабочий HTTP-сервис на `0.0.0.0:8080`, чтобы за одну команду поднять локальную LLM как сервис.
2. Как автор, я хочу зайти браузером на `http://homelab.local:8080/` и начать чатиться с локальной моделью как с ChatGPT, чтобы у меня появилась live demo-точка без Telegram-инфраструктуры.
3. Как автор, я хочу, чтобы web-UI попросил у меня API ключ при первом заходе и сохранил его в `localStorage`, чтобы не вводить его на каждый запрос.
4. Как автор, я хочу, чтобы web-UI показывал dropdown с моделями (`llama3.2:3b`, `qwen2.5-coder:7b`), который заполняется из `/v1/models`, чтобы переключаться между моделями без правки кода.
5. Как автор, я хочу видеть стриминг ответа в web-UI токен за токеном, чтобы UX был «как у настоящего ChatGPT», а не «загрузка → текст».
6. Как автор, я хочу командой `curl -H "Authorization: Bearer $KEY" -d '{"model":"llama3.2:3b","messages":[...]}' http://localhost:8080/v1/chat/completions` получить тот же формат ответа, что у OpenAI, чтобы любой OpenAI-совместимый клиент (включая мой `OpenAILLMClient`) работал без правок.
7. Как автор, я хочу указать `OPENAI_BASE_URL=http://homelab.local:8080/v1` и `OPENAI_API_KEY=$KEY` в Telegram-боте — и чтобы он начал ходить через сервис, а не напрямую в Ollama, чтобы перевести существующий клиент на новый плацдарм без правок кода.
8. Как автор, я хочу, чтобы запрос со `stream:true` возвращал `text/event-stream` с delta-чанками `{"choices":[{"delta":{"content":"..."}}]}`, чтобы любой OpenAI-стрим-клиент работал из коробки.
9. Как автор, я хочу, чтобы запрос со `stream:false` (или без поля) возвращал обычный JSON `{"choices":[{"message":{"content":"..."}}],"usage":{...}}`, чтобы curl-сценарии не требовали парсинга SSE.
10. Как владелец сервиса, я хочу, чтобы запрос без `Authorization: Bearer` падал с 401 и понятным телом, чтобы любая попытка анонимного использования была явно отклонена.
11. Как владелец сервиса, я хочу задавать API-ключи через env (`LLM_SERVICE_API_KEYS=personal:sk-xxx,wife:sk-yyy`), чтобы выдать разные ключи разным потребителям без правок кода и без БД.
12. Как владелец сервиса, я хочу, чтобы при превышении 10 запросов burst / 1 RPS на один ключ сервис возвращал HTTP 429 с заголовком `Retry-After`, чтобы зашалевший клиент не положил инференс остальных.
13. Как владелец сервиса, я хочу, чтобы запрос с входным контекстом более 6000 токенов отклонялся с HTTP 413 и телом `{error, limit, got}`, чтобы 4 GB VRAM не падало в OOM от случайно вставленного 200K-токенового документа.
14. Как владелец сервиса, я хочу, чтобы максимальный input-context был настраиваем через env (`LLM_SERVICE_MAX_INPUT_TOKENS`), чтобы поднять/опустить лимит при смене модели без пересборки.
15. Как владелец сервиса, я хочу задавать allowlist моделей через `LLM_SERVICE_ALLOWED_MODELS`, чтобы клиент не мог попросить произвольную модель из ollama-каталога и притащить её в OOM.
16. Как владелец сервиса, я хочу, чтобы запрос с моделью вне allowlist возвращал HTTP 400 с понятным сообщением и списком разрешённых моделей, чтобы клиент сразу понимал, что ему доступно.
17. Как владелец сервиса, я хочу, чтобы `GET /health` отвечал без авторизации и показывал `{status, ollama: "up|down", models: [...]}`, чтобы health-checker'ы и я сам могли быстро проверить, жив ли сервис и подключён ли он к Ollama.
18. Как владелец сервиса, я хочу, чтобы в каждом запросе access-лог писал JSON-строку (timestamp, keyId, model, input_tokens, output_tokens, latency_ms, status) в stdout, чтобы я мог постфактум разбираться, кто и сколько потратил.
19. Как владелец сервиса, я хочу, чтобы сервис слушал на `0.0.0.0` (а не только localhost), чтобы клиенты в LAN могли до него достучаться по hostname/IP.
20. Как владелец сервиса, я хочу, чтобы host и порт настраивались через `LLM_SERVICE_HOST` и `LLM_SERVICE_PORT`, чтобы можно было гонять параллельно прод-сервис на :8080 и тестовый на :8081 без правок.
21. Как автор, я хочу запустить `bun run scripts/day30/load-test.ts` и получить `report.md` с метриками N=1,2,5,10 параллельных запросов, чтобы доказать, что сервис стабилен под нагрузкой.
22. Как автор, я хочу, чтобы load-test проверял, что: (a) 5 быстрых запросов от одного ключа дают первые 4-5 успешных + остальные 429; (b) запрос с 7000+ токенов даёт 413; (c) запрос без auth даёт 401; чтобы убедиться, что защитные слои реально работают.
23. Как автор, я хочу, чтобы load-test писал в `report.md` p50/p95/p99 latency, error rate, throughput для каждой степени параллелизма, чтобы понимать поведение сервиса под нагрузкой.
24. Как автор, я хочу, чтобы deep-модули (`ApiKeyAuth`, `RateLimiter`, `TokenCounter`, `loadServerConfig`) имели unit-тесты в Red-Green стиле, чтобы регрессия в auth/rate-limit не уплыла молча.
25. Как автор, я хочу, чтобы Hono-wiring в `src/presentation/http/server.ts` оставался тонким (без бизнес-логики, только wiring middleware и handler'ов), чтобы его можно было не тестировать в юнитах без потери уверенности.
26. Как автор, я хочу, чтобы при остановке сервиса (Ctrl+C) Hono корректно закрывал активные SSE-соединения, чтобы клиенты получали понятный конец потока, а не зависший таймаут.
27. Как автор, я хочу, чтобы новый PRD (`day30-local-llm-service.md`) лёг в `.ai/prd/` рядом с day29, чтобы серия дней 26-30 «локальная LLM от smoke до сервиса» была завершена консистентно.

## Implementation Decisions

### Зависимости

- **Добавляется `hono`** как прод-зависимость. Версия latest stable. Минимальный footprint (~12 KB), нативно работает на Bun.
- **Добавляется `gpt-tokenizer`** как прод-зависимость. Чистый JS-токенайзер cl100k_base. Без WASM, без native bindings, без долгого warm-up. Это эвристика для OpenAI-токенизации, не точная для llama/qwen, но порядок верный — для hard cap (6000 vs 200000) этого достаточно. В PRD честно отмечаем: real token count в Ollama может отличаться на ±10-20%, лимит выставлен с запасом.
- **`openai` SDK не используется в сервере.** Сервер прокси в Ollama идёт напрямую через `fetch` к `http://localhost:11434/v1/chat/completions`. Это убирает один слой абстракции и даёт прозрачный pass-through стрима. `OpenAILLMClient` остаётся для **клиентов** сервиса (Telegram-бот, eval-скрипты), но сам сервер его не импортирует.

### Layout

```
src/
  server.ts                                  # entry-point: загружает конфиг, запускает Hono
  presentation/
    http/
      server.ts                              # Hono-wiring: routes + middleware
      static/
        index.html                           # web-UI (single file)
      auth/
        api-key-auth.ts                      # ApiKeyAuth (deep)
        api-key-auth.test.ts
      rate-limit/
        rate-limiter.ts                      # RateLimiter (deep)
        rate-limiter.test.ts
      validation/
        token-counter.ts                     # TokenCounter (deep)
        token-counter.test.ts
      proxy/
        ollama-proxy.ts                      # OllamaProxy (тонкая, без unit)
      config/
        server-config.ts                     # loadServerConfig (deep)
        server-config.test.ts
scripts/
  day30/
    load-test.ts                             # параллельный нагрузочный прогон
    report.md                                # артефакт
```

### Deep-модули

1. **`loadServerConfig(env)`** — синхронная функция, читает env, валидирует, возвращает `ServerConfig`:
   - `host: string` (`LLM_SERVICE_HOST`, дефолт `0.0.0.0`)
   - `port: number` (`LLM_SERVICE_PORT`, дефолт `8080`, валидация 1..65535)
   - `apiKeys: Map<string, string>` (`LLM_SERVICE_API_KEYS`, формат `keyId:secret,keyId:secret`, обязательная, минимум 1 ключ)
   - `rateLimit: { capacity: number, refillPerSec: number }` (`LLM_SERVICE_RATE_CAPACITY` дефолт 10, `LLM_SERVICE_RATE_REFILL_PER_SEC` дефолт 1)
   - `maxInputTokens: number` (`LLM_SERVICE_MAX_INPUT_TOKENS`, дефолт 6000)
   - `allowedModels: string[]` (`LLM_SERVICE_ALLOWED_MODELS`, дефолт `llama3.2:3b,qwen2.5-coder:7b`)
   - `ollamaBaseUrl: string` (`OLLAMA_BASE_URL`, дефолт `http://localhost:11434`)
   - `requestTimeoutMs: number` (`LLM_SERVICE_TIMEOUT_MS`, дефолт 180000)
   - Невалидные значения → throw с понятным сообщением (содержит имя env и почему оно не подошло). Отсутствие обязательного `LLM_SERVICE_API_KEYS` → throw.

2. **`ApiKeyAuth`** — конструктор принимает `Map<keyId, secret>`. Метод `authenticate(authHeader: string | undefined): { keyId: string } | null`. Логика: парсит `Bearer <secret>`, ищет secret в Map, возвращает keyId или null. Constant-time comparison через `crypto.timingSafeEqual` для защиты от timing attacks (хоть это и LAN). Тесты: missing header, malformed header, unknown secret, valid secret → правильный keyId, два разных keyId с одинаковыми префиксами не путаются.

3. **`RateLimiter`** — token bucket per keyId. Конструктор: `(capacity, refillPerSec, now: () => number = Date.now)`. Метод `tryConsume(keyId: string): { ok: true } | { ok: false, retryAfterMs: number }`. Внутри: `Map<keyId, { tokens: number, lastRefillMs: number }>`. На каждый вызов: refill с момента lastRefillMs, decrement tokens, проверка ≥0. Инжекция `now` нужна для детерминированных тестов. Тесты: первые `capacity` запросов идут, `capacity+1` отказан с retryAfter > 0, после `1/refillPerSec` секунд ещё один проходит, разные keyId изолированы.

4. **`TokenCounter`** — обёртка над `gpt-tokenizer`. Метод `countMessages(messages: Array<{role, content}>): number`. Логика: считаем токены каждого `content` через `encode().length`, плюс константа per-message overhead (4 токена на role/format, как в OpenAI cookbook), плюс 2 финальных токена. Тесты: пустой массив = 2, одно сообщение из 1 слова ≈ small number, длинное сообщение в 10К символов ≈ 2500-3000 токенов (sanity), проверка что content корректно конкатенируется.

5. **`OllamaProxy`** — НЕ deep-модуль, тонкая обёртка. Принимает валидированный OpenAI-формат body, делает `fetch(${ollamaBaseUrl}/v1/chat/completions, {method:POST, body, signal})`, для `stream:true` возвращает ReadableStream без буферизации, для `stream:false` — JSON. Без unit-тестов — покрыт live load-test'ом.

### Hono wiring (src/presentation/http/server.ts)

- Middleware-цепочка для `/v1/*`:
  1. `corsMiddleware` (если нужно для UI с другого origin — опционально, по дефолту same-origin)
  2. `authMiddleware`: `auth.authenticate(c.req.header('Authorization'))` → если null, `c.json({error: "Unauthorized"}, 401)`. Иначе `c.set('keyId', keyId)`.
  3. `rateLimitMiddleware`: `rateLimiter.tryConsume(keyId)` → если не ok, `c.header('Retry-After', ms/1000)` + `c.json({error: "Rate limit"}, 429)`.
  4. `accessLogMiddleware`: после handler, пишет JSON в stdout с метриками.
- Handler `POST /v1/chat/completions`:
  - Парсит body (Hono `c.req.json()`).
  - Валидирует: `model` присутствует и в allowlist (иначе 400), `messages` непустой массив (иначе 400).
  - Считает `tokenCounter.countMessages(messages)` → если > maxInputTokens, `c.json({error, limit, got}, 413)`.
  - Делегирует в `OllamaProxy`. Если `stream:true` → возвращает SSE ResponseInit с pass-through body. Иначе → JSON.
  - Все ошибки от Ollama (timeout, connection refused) → 502 Bad Gateway с сообщением.
- Handler `GET /v1/models`:
  - Возвращает `{object: "list", data: allowedModels.map(id => ({id, object: "model", owned_by: "local"}))}` — формат совместим с OpenAI.
- Handler `GET /health` (без auth):
  - `fetch(${ollamaBaseUrl}/api/tags)` с таймаутом 2s.
  - Если ok → `{status: "ok", ollama: "up", models: [...из ответа Ollama]}`.
  - Иначе → 503 + `{status: "degraded", ollama: "down"}`.
- Handler `GET /` (без auth):
  - Отдаёт статический `index.html` через Hono's `serveStatic` (Bun-mode).

### Web-UI (src/presentation/http/static/index.html)

- Один файл, без сборки. Inline `<style>` и `<script type="module">`.
- При первом заходе: проверка `localStorage.getItem('apiKey')`. Если нет → модалка с input для ключа, кнопкой Save → пишет в localStorage.
- При загрузке: `fetch('/v1/models', {headers: {Authorization: Bearer ${key}}})` → заполняет `<select>` моделей.
- Состояние чата: массив `{role, content}` в JS-памяти и зеркалится в localStorage (`chat:history`). Кнопка «Clear» очищает.
- Send: добавляет user-message в массив, рендерит, делает fetch с `stream:true`, читает SSE, инкрементально обновляет последнее assistant-сообщение по мере поступления delta-чанков.
- Стиль: минимальный (Pico.css или просто vanilla CSS — vanilla, без CDN).
- Никаких фреймворков (React/Vue), никакой сборки — `bun` отдаёт html как есть.

### Сетевая модель

- Сервер слушает `0.0.0.0:8080`. Без TLS — это сознательно, в LAN, под Tailscale-вариант пользователя оставлено на следующие дни.
- Bearer key передаётся в plain HTTP — приемлемо в LAN (внутри домашней сети траффик не сниффится третьими лицами). При переезде наружу обязателен TLS reverse-proxy (Caddy/Cloudflare) — это в Out of Scope.

### Деплой/запуск

- `package.json`: добавить `"server": "bun run src/server.ts"`.
- `.env.example`: добавить блок:
  ```
  # Day 30 — local LLM HTTP service
  LLM_SERVICE_HOST=0.0.0.0
  LLM_SERVICE_PORT=8080
  LLM_SERVICE_API_KEYS=personal:sk-changeme
  LLM_SERVICE_RATE_CAPACITY=10
  LLM_SERVICE_RATE_REFILL_PER_SEC=1
  LLM_SERVICE_MAX_INPUT_TOKENS=6000
  LLM_SERVICE_ALLOWED_MODELS=llama3.2:3b,qwen2.5-coder:7b
  LLM_SERVICE_TIMEOUT_MS=180000
  ```
- Запуск: `bun run server` в tmux. Не выживает рестарта машины — это явно out-of-scope (systemd/Docker — следующие дни).
- SIGINT/SIGTERM: graceful shutdown — Hono закрывает server, активные SSE-стримы получают финальный `data: [DONE]` или просто закрытие соединения.

### Load-test (scripts/day30/load-test.ts)

- Конфиг: `BASE_URL`, `API_KEY` из env (с дефолтами на `http://localhost:8080`/`personal:sk-changeme`).
- Сценарии:
  1. **Smoke** — 1 запрос, sanity check.
  2. **Concurrency ladder** — N=1,2,5,10 параллельных запросов одного промпта (`Promise.all`). Замер: total wall-time, latency каждого, p50/p95/p99, error count.
  3. **Rate limit hit** — 15 быстрых запросов от одного ключа в цикле без `await` между ними. Ожидаем: первые ~10 успех (burst), остальные — 429.
  4. **Max context reject** — запрос с `messages[0].content = "x".repeat(40000)` (≈10K токенов). Ожидаем: 413.
  5. **Bad auth** — запрос без `Authorization`. Ожидаем: 401.
  6. **Bad model** — запрос с `model: "doesnotexist:1b"`. Ожидаем: 400.
- Итог: пишет markdown-таблицы и pass/fail per-сценарий в `scripts/day30/report.md`. Header содержит timestamp, hardware (через `llmfit system --json`, как в day26), config сервиса (host/port/limits), модель.
- Записывает raw результаты (latency-массивы) в `scripts/day30/raw/load-test-${ts}.json` для последующего анализа.

## Testing Decisions

**Что такое хороший тест:** проверяет внешнее наблюдаемое поведение модуля (вход/выход), а не приватные детали. Не лезет в реальный fetch, не запускает Hono, не зовёт Ollama. Использует инжекцию `now()` для детерминизма во времени.

**Тестируется (Red-Green, как в day27):**

- **`loadServerConfig`** — все обязательные env заданы → корректный объект с дефолтами. Отсутствует `LLM_SERVICE_API_KEYS` → throw с сообщением, в котором есть имя переменной. Невалидный `LLM_SERVICE_PORT` (0, отрицательный, не число) → throw. Малформенный `LLM_SERVICE_API_KEYS` (нет `:`, пустой keyId) → throw. Дефолты применяются.
- **`ApiKeyAuth`** — undefined header → null. Header без `Bearer ` → null. Bearer с неизвестным secret → null. Bearer с валидным secret → `{keyId}` корректный. Два ключа с одинаковым префиксом не путаются. Constant-time comparison не падает на пустом secret.
- **`RateLimiter`** — с `(capacity=3, refillPerSec=1)` и инжектированным `now`: первые 3 → ok, 4-й → fail с retryAfter ≈ 1000 мс. После advance времени на 1с → ещё один ok. Два разных keyId изолированы. После advance на 5с при capacity=3 — корзина не переполняется выше capacity.
- **`TokenCounter`** — пустой массив → ровно overhead. Одно короткое сообщение → разумное число (sanity). Текст известной длины → детерминированный count (snapshot-test). Multi-message → сумма с правильным per-message overhead. Не падает на не-ASCII (русский, эмодзи).

**Не тестируется (тонкая glue, проверяется live load-test'ом):**

- `src/server.ts` — entry-point, только wiring.
- `src/presentation/http/server.ts` — Hono-роуты, регистрация middleware. Поведение покрыто live-сценариями load-test'а (rate limit, max context, bad auth, bad model).
- `OllamaProxy` — тонкая обёртка над fetch.
- Web-UI — ручная проверка в браузере: открыть, ввести ключ, отправить сообщение, увидеть стрим, нажать Clear.

**Приёмка дня:**

1. `bun test` — зелёный (включая новые тесты deep-модулей и не сломанные старые).
2. `bun run server` поднимается на `0.0.0.0:8080`, `curl http://localhost:8080/health` отвечает `{status:"ok", ollama:"up"}`.
3. Открыть `http://localhost:8080/` в браузере, ввести ключ, отправить «привет», получить стримящийся ответ от llama3.2:3b.
4. Из второго терминала: `OPENAI_BASE_URL=http://localhost:8080/v1 OPENAI_API_KEY=sk-changeme OPENAI_MODEL=llama3.2:3b bun run start "Hi"` — работает.
5. `bun run scripts/day30/load-test.ts` — отрабатывает все 6 сценариев, кладёт `report.md` с pass для всех ожидаемых assertions.

## Out of Scope

- **TLS / HTTPS.** В LAN не нужен, пользователь явно не выбрал. При выходе наружу — отдельный день: Caddy/Cloudflare Tunnel.
- **Cloudflare Tunnel / Tailscale / любой публичный доступ.** Только LAN. Если кто-то хочет ходить из мобильного интернета — это следующий день.
- **Очередь запросов (single-inference serialization).** Пользователь не выбрал. Ollama сам сериализует запросы внутри (на 4GB VRAM параллелизм бессмыслен), наш rate limit и так гасит burst, явная очередь — премат. Если в load-test увидим OOM/деградацию — добавим в next steps.
- **Persistent storage.** Никакой БД, никакого Redis. Rate-limit buckets и истории чата живут только в памяти процесса/браузера. Перезапуск чистит всё. Это сознательно.
- **Rotation / revocation API ключей.** Ключи статически в env. Чтобы revoke — править env и рестартовать. Production-grade key management — отдельный день.
- **Multi-user UI с регистрацией.** UI singleton, ключ один на устройство. Никакого signup/login — Bearer key это и есть identity.
- **OAuth / SSO.** Никогда. Это приватный сервис, не SaaS.
- **OpenAI Responses API.** Был ампутирован в day27. Не возвращаем.
- **Tool-calling, function-calling.** Прокидывается as-is через chat.completions, но мы не валидируем и не интерпретируем — это ответственность модели и клиента. Тестов на это нет.
- **Image / audio inputs (multimodal).** Только текст.
- **Embedding endpoint (`/v1/embeddings`).** День 28 (local RAG) использовал Ollama embedding-модели напрямую. Если потребуется — добавится отдельным эндпоинтом, сегодня не делаем.
- **Metrics / Prometheus / OpenTelemetry.** Только access-логи в stdout, JSON-строки. Метрики собираются грепом из логов, если нужно.
- **Docker / docker-compose / Dockerfile.** Пользователь явно выбрал bun run без демона. Контейнеризация — отдельный день.
- **systemd unit.** То же самое.
- **VPS deployment.** Сервис live на домашнем ноуте, в Out of Scope полностью.
- **Configurable per-key rate limits.** Все ключи имеют одинаковые `capacity`/`refillPerSec`. Делать map keyId → limits — overengineering для 2 пользователей.
- **Streaming в Telegram-боте.** Telegram-бот day27 остаётся в батч-режиме. Перевод на стрим через editMessageText — отдельный nice-to-have.

## Further Notes

- **Почему Hono, а не голый Bun.serve.** На 5 эндпоинтов и 3 middleware Hono выигрывает в читаемости и сокращает количество багов в роутинге/cors/SSE. Bundle ~12 KB, нативный Bun-mode, никакого overhead. Если в будущем захочется убрать — миграция на Bun.serve посильна (Hono — тонкая обёртка).
- **Почему gpt-tokenizer (cl100k_base), а не родной токенайзер модели.** Llama и Qwen используют свои SentencePiece-токенайзеры; чтобы получить точный count, надо тащить либо `@huggingface/transformers` (крупный, медленный warm-up), либо вызывать `/api/tokenize` Ollama (round-trip на каждом запросе — дополнительный latency и нагрузка). cl100k_base — детерминированная эвристика, для llama-моделей завышает count на ~10% (что играет в сторону безопасности), для qwen-моделей — близко. Лимит 6000 поставлен с запасом, чтобы реальный 8192-window модели не выходил за грань. В load-test может быть assertion: запрос на 5000 «токенов по нашему counter» — реально проходит в Ollama без context-overflow.
- **Почему `LLM_SERVICE_API_KEYS` через env, а не файл.** Один источник правды (env), одна точка ротации (рестарт). Файл = ещё один путь, права доступа, sync — не для 2-х ключей.
- **Почему 0.0.0.0, а не 127.0.0.1.** Цель дня — «доступ по сети». 127.0.0.1 — антитеза этому. Для LAN-only — это правильно. Если кто-то страшится — можно засетить `LLM_SERVICE_HOST=127.0.0.1` и получить старое поведение.
- **Почему default port 8080.** 8080 — общепринятый dev-default, не конфликтует с типичными dev-сервисами (3000, 5173, 8000), не требует root (как 80). 11434 (порт Ollama) сознательно не используем, чтобы было видно — это другой слой.
- **Почему сервер прокси в Ollama через fetch, а не через openai SDK.** Сервер должен **прозрачно** прокинуть OpenAI-формат запроса в Ollama, который сам реализует OpenAI-shim. Любая трансформация через SDK = риск что-то потерять (новые поля в spec, custom headers и т.п.). Pass-through `fetch` минимизирует поверхность.
- **Что дальше.** День 31+ — TLS через reverse-proxy (Caddy с auto-Let's-Encrypt) + Cloudflare Tunnel для публичного доступа. Потом — Docker-образ + docker-compose для воспроизводимого деплоя. Потом — VPS migration или гибрид (proxy на VPS, inference дома через VPN). Серия дней 26-30 заканчивается на «локальной» точке: модель есть, бот есть, RAG есть, оптимизация есть, сервис есть — всё под одной крышей.
- **Риск концепции.** Bearer key в plain HTTP в LAN — приемлемо, но **не для домена «корпоративная сеть с гостями»**. Это для домашней сети, где все устройства принадлежат мне. PRD это явно фиксирует, чтобы будущий читатель не подумал, что это production-ready security.
- **Совместимость с next steps day29.** Оптимизационные эксперименты (gating thresholds, top-k tuning) день 29 проводил напрямую через Ollama — после day30 их можно будет переориентировать на сервис, доказав что overhead новой прослойки минимален (это можно поставить как separate eval в одном из следующих дней).

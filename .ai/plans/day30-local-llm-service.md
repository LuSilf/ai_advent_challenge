# Plan: Day 30 — Локальная LLM как приватный HTTP-сервис

> Source PRD: `.ai/prd/day30-local-llm-service.md`

## Architectural decisions

Durable решения, общие для всех фаз:

- **Layout**: код сервера живёт в `src/presentation/http/` (deep-модули + Hono-wiring), entry-point — `src/server.ts` (по аналогии с `src/bot.ts`/`src/scheduler.ts`). Скрипты нагрузки и артефакты дня — в `scripts/day30/`.
- **Routes**:
  - `POST /v1/chat/completions` — основной OpenAI-совместимый эндпоинт (батч + SSE по `stream:true`)
  - `GET /v1/models` — список разрешённых моделей в OpenAI-формате
  - `GET /health` — публичный, без auth, проверяет Ollama
  - `GET /` — статический web-UI
- **Stack**: Hono на Bun (новая прод-зависимость). Запуск через `bun run server`. Web-UI — single-page `index.html` без сборки.
- **Прокси в Ollama**: тонкий pass-through через нативный `fetch` к `${OLLAMA_BASE_URL}/v1/chat/completions`. Без `openai` SDK на стороне сервера.
- **Auth model**: Bearer API key из env. Формат `LLM_SERVICE_API_KEYS=keyId:secret,keyId:secret`. В runtime — `Map<keyId, secret>`. Сравнение через `crypto.timingSafeEqual`.
- **Rate limit model**: token bucket per keyId, in-memory `Map<keyId, {tokens, lastRefillMs}>`. Параметры `capacity`, `refillPerSec` из env. Превышение → 429 + `Retry-After`.
- **Max context model**: счёт токенов через `gpt-tokenizer` (cl100k_base, новая прод-зависимость). Превышение `LLM_SERVICE_MAX_INPUT_TOKENS` → 413 с `{error, limit, got}`.
- **Allowlist моделей**: env `LLM_SERVICE_ALLOWED_MODELS` (CSV). Запрос с моделью вне списка → 400.
- **Сетевая модель**: `0.0.0.0:8080` по дефолту, LAN-only, без TLS. Доступ извне домашней сети — out of scope.
- **Конфиг**: загрузка через synchronous `loadServerConfig(env)` с валидацией; невалидные/отсутствующие обязательные значения → throw на старте.
- **Тестирование**: Red-Green unit-тесты на каждый deep-модуль (стиль day27). Hono-wiring и тонкий Ollama-proxy не покрываются юнитами — для них работает live load-test в финальной фазе.
- **Артефакт дня**: `scripts/day30/report.md` (по канону day26/29) + raw JSON в `scripts/day30/raw/`.
- **Запуск**: `bun run src/server.ts` без демона; новый npm-скрипт `"server"` в `package.json`. Graceful shutdown по SIGINT/SIGTERM.
- **`.env.example`**: расширяется блоком `LLM_SERVICE_*` переменных с дефолтами.

---

## Phase 1: Tracer bullet — батч-прокси без защит

**User stories**: 1, 6, 19, 20

### What to build

Минимальный end-to-end путь: HTTP-сервер на Hono поднимается на `0.0.0.0:8080`, принимает `POST /v1/chat/completions` в OpenAI-формате (только `stream:false`), пробрасывает body в Ollama через `fetch`, возвращает JSON-ответ как есть. Никакой авторизации, rate-limit'а, валидации токенов и моделей. Конфиг (`host`, `port`, `ollamaBaseUrl`, `requestTimeoutMs`) грузится из env с дефолтами; критические ошибки на старте — fail-fast. Entry-point ловит SIGINT/SIGTERM и закрывает сервер. Скрипт `bun run server` добавляется в `package.json`. Базовая запись в `.env.example`.

### Acceptance criteria

- [ ] `bun add hono` выполнен, зависимость зафиксирована
- [ ] `bun run server` поднимает сервер на `0.0.0.0:8080`, в stdout — строка с host/port
- [ ] `curl -X POST -H "Content-Type: application/json" -d '{"model":"llama3.2:3b","messages":[{"role":"user","content":"say ok"}]}' http://localhost:8080/v1/chat/completions` возвращает валидный OpenAI-формат с непустым `choices[0].message.content`
- [ ] Запрос с battle-tested моделью (`llama3.2:3b`) проходит, latency адекватная (≤ 30 сек на холодную, < 5 сек на тёплую)
- [ ] Ollama лежит → ответ 502 с понятным телом, не 500-stack
- [ ] Ctrl+C в терминале даёт чистый выход без traceback
- [ ] Конфиг с невалидным `LLM_SERVICE_PORT` (строка/0/-1) → fail на старте с понятным сообщением

---

## Phase 2: Streaming + `/v1/models` + `/health`

**User stories**: 8, 9, 17

### What to build

Расширение API до полного OpenAI-совместимого набора. `POST /v1/chat/completions` теперь поддерживает `stream:true`: ответ возвращается как `text/event-stream`, чанки от Ollama проксируются в неизменном виде (pass-through ReadableStream без буферизации). `GET /v1/models` отдаёт список из `LLM_SERVICE_ALLOWED_MODELS` (env, дефолт `llama3.2:3b,qwen2.5-coder:7b`) в OpenAI-формате `{object:"list", data:[{id, object:"model", owned_by:"local"}]}`. `GET /health` без авторизации делает короткий ping в Ollama (`/api/tags` с таймаутом 2s) и отвечает `{status, ollama, models}`; при недоступности — 503.

### Acceptance criteria

- [ ] `curl -N -d '{"model":"llama3.2:3b","messages":[...],"stream":true}' http://localhost:8080/v1/chat/completions` стримит SSE-чанки `data: {...}` в реальном времени
- [ ] Финальный чанк стрима — `data: [DONE]` (как у OpenAI/Ollama-shim)
- [ ] `curl http://localhost:8080/v1/models` возвращает JSON со списком из allowlist'а
- [ ] `curl http://localhost:8080/health` при работающей Ollama → 200 + `{status:"ok", ollama:"up", models:[...]}`
- [ ] `curl http://localhost:8080/health` при остановленной Ollama → 503 + `{status:"degraded", ollama:"down"}`
- [ ] При закрытии клиентского соединения во время стрима сервер не падает и закрывает upstream-fetch

---

## Phase 3: Bearer API key auth

**User stories**: 10, 11, 24

### What to build

Deep-модуль `ApiKeyAuth`: конструктор принимает `Map<keyId, secret>`, метод `authenticate(authHeader): {keyId} | null` парсит `Bearer <secret>`, ищет в Map через constant-time сравнение. Конфиг расширяется обязательным полем `apiKeys` (парсится из `LLM_SERVICE_API_KEYS=keyId:secret,...`); отсутствие или пустое значение → throw на старте. Hono middleware применяется ко всем `/v1/*` роутам: 401 + `{error:"Unauthorized"}` для запросов без/с неверным ключом. `/health` и `/` остаются публичными. KeyId сохраняется в context для последующих фаз. Юнит-тесты на `ApiKeyAuth` и расширение тестов `loadServerConfig`.

### Acceptance criteria

- [ ] `bun test` зелёный; новые тесты на `ApiKeyAuth` покрывают: нет header → null, malformed → null, unknown secret → null, valid → правильный keyId, два ключа с одинаковым префиксом не путаются, пустой secret не падает
- [ ] Тесты `loadServerConfig`: отсутствие `LLM_SERVICE_API_KEYS` → throw с именем переменной; малформенный CSV → throw; валидный multi-key CSV → корректная Map
- [ ] `curl http://localhost:8080/v1/models` без auth → 401
- [ ] `curl -H "Authorization: Bearer wrong" http://localhost:8080/v1/models` → 401
- [ ] `curl -H "Authorization: Bearer $VALID_KEY" http://localhost:8080/v1/models` → 200 со списком
- [ ] `curl http://localhost:8080/health` без auth → 200 (остался публичным)
- [ ] `OPENAI_BASE_URL=http://localhost:8080/v1 OPENAI_API_KEY=$VALID_KEY OPENAI_MODEL=llama3.2:3b bun run start "Hi"` работает (существующий CLI ходит через сервис)

---

## Phase 4: Rate limit per-key

**User stories**: 12, 24

### What to build

Deep-модуль `RateLimiter`: token bucket, конструктор `(capacity, refillPerSec, now=Date.now)`, метод `tryConsume(keyId): {ok:true} | {ok:false, retryAfterMs}`. Внутри — `Map<keyId, {tokens, lastRefillMs}>`. Refill высчитывается лениво на каждый вызов. Инжекция `now` для детерминированных тестов. Конфиг расширяется (`LLM_SERVICE_RATE_CAPACITY` дефолт 10, `LLM_SERVICE_RATE_REFILL_PER_SEC` дефолт 1). Hono middleware на `/v1/*`: после auth-middleware вызывает `tryConsume(keyId)`; при отказе — 429 с заголовком `Retry-After: <seconds>` и телом `{error:"Rate limit exceeded", retryAfterMs}`. Юнит-тесты на `RateLimiter`.

### Acceptance criteria

- [ ] `bun test` зелёный; новые тесты на `RateLimiter`: первые `capacity` запросов → ok; `capacity+1` → fail с retryAfter > 0; после advance времени на `1/refillPerSec` секунд → ещё один ok; разные keyId изолированы; refill не переполняет bucket выше capacity
- [ ] 11 быстрых запросов от одного ключа подряд (`for i in {1..11}; do curl ...; done`) → первые 10 успех, 11-й → 429 с `Retry-After`
- [ ] Через 1 секунду после исчерпания → ещё один запрос успешен
- [ ] Параллельно два ключа исчерпывают свои корзины независимо

---

## Phase 5: Max input context + model allowlist

**User stories**: 13, 14, 15, 16, 24

### What to build

Deep-модуль `TokenCounter` поверх `gpt-tokenizer` (новая прод-зависимость): метод `countMessages(messages): number` — сумма токенов всех `content` плюс per-message overhead (4) плюс финальные 2. В handler `POST /v1/chat/completions`: до прокси в Ollama проверка (a) `model` в allowlist (иначе 400 + `{error, allowed}`), (b) `tokenCounter.countMessages(messages)` ≤ `LLM_SERVICE_MAX_INPUT_TOKENS` (иначе 413 + `{error, limit, got}`). Конфиг расширяется (`LLM_SERVICE_MAX_INPUT_TOKENS` дефолт 6000, `LLM_SERVICE_ALLOWED_MODELS` дефолт `llama3.2:3b,qwen2.5-coder:7b`). Юнит-тесты на `TokenCounter` и расширение `loadServerConfig`.

### Acceptance criteria

- [ ] `bun add gpt-tokenizer` выполнен
- [ ] `bun test` зелёный; тесты `TokenCounter`: пустой массив → ровно 2; одно короткое сообщение → small but >0; multi-message → сумма + overhead; не падает на русском/эмодзи; снапшот для известной строки детерминированный
- [ ] Запрос с `model:"doesnotexist:1b"` → 400 + список разрешённых моделей в теле
- [ ] Запрос с `messages[0].content = "x".repeat(40000)` → 413 + тело `{error, limit:6000, got:>=10000}`
- [ ] Граничный валидный запрос (≈5500 токенов) проходит и доходит до Ollama
- [ ] Старые валидные запросы из Phase 1-4 продолжают работать

---

## Phase 6: Access-логи (jsonl в stdout)

**User stories**: 18

### What to build

Hono middleware на `/v1/*`, регистрируется последним в цепочке. После завершения handler'а пишет в stdout одну JSON-строку: `timestamp` (ISO-8601), `keyId` (или `"-"` если auth не прошёл), `method`, `path`, `model` (если был в запросе), `input_tokens` (если посчитан), `output_tokens` (из `usage.completion_tokens` ответа Ollama, если применимо), `latency_ms`, `status`, `error` (если non-2xx). Для стрим-запросов `output_tokens` помечается `null` (или собирается опционально). Stderr/stdout не смешиваются — log-line только в stdout. Никаких новых зависимостей.

### Acceptance criteria

- [ ] Один батч-запрос даёт одну валидную JSON-строку в stdout с заполненными `keyId`, `model`, `input_tokens`, `output_tokens`, `latency_ms`, `status:200`
- [ ] Запрос без auth → строка с `keyId:"-"`, `status:401`, `error:"unauthorized"`
- [ ] Запрос с превышением rate limit → `status:429`, `error:"rate_limit"`
- [ ] Запрос с превышением context → `status:413`, `error:"input_too_large"`, заполненный `input_tokens`
- [ ] Стрим-запрос даёт строку после закрытия стрима с корректным `latency_ms` (от запроса до закрытия)
- [ ] `bun run server 2>/dev/null | jq -c .` парсится без ошибок на серии запросов

---

## Phase 7: Web-UI на одной странице

**User stories**: 2, 3, 4, 5

### What to build

Один статический `index.html` с inline `<style>` и `<script type="module">`, отдаётся через Hono на `GET /` (без auth, без новых билд-инструментов). При загрузке: проверка `localStorage.getItem('apiKey')` — если нет, показать модалку с input и кнопкой Save. После — `fetch('/v1/models', {Authorization:...})` для заполнения dropdown'а моделей. Чат: `<div>` с историей (роли + текст), `<textarea>` + кнопка «Send», кнопка «Clear». При Send: добавить user-message в массив + рендер; `fetch` с `stream:true` к `/v1/chat/completions`, читать `EventSource`-эквивалент через ReadableStream, инкрементально обновлять последнее assistant-сообщение по delta-чанкам. История зеркалится в `localStorage` (`chat:history`). Vanilla CSS, без CDN, без фреймворков.

### Acceptance criteria

- [ ] `http://localhost:8080/` открывается в браузере, отдаётся валидный HTML
- [ ] Первый заход без ключа в localStorage показывает модалку; после Save модалка скрывается, ключ сохранён
- [ ] Dropdown моделей заполнен из `/v1/models` (видны `llama3.2:3b`, `qwen2.5-coder:7b`)
- [ ] Отправка сообщения «привет» приводит к стримящемуся ответу токен-за-токеном
- [ ] Кнопка Clear очищает видимую историю и `localStorage`
- [ ] Перезагрузка страницы восстанавливает историю чата
- [ ] Невалидный ключ → ошибка в UI (не падение JS, понятное сообщение)
- [ ] Браузер не показывает console errors на golden path

---

## Phase 8: Load-test + `report.md`

**User stories**: 21, 22, 23

### What to build

`scripts/day30/load-test.ts` — TS-скрипт на Bun, читает `BASE_URL`, `API_KEY` из env (с дефолтами `http://localhost:8080`/первый ключ из `LLM_SERVICE_API_KEYS`). Прогоняет 6 сценариев:

1. **Smoke** — 1 запрос, sanity check
2. **Concurrency ladder** — N=1, 2, 5, 10 параллельных запросов одного промпта (`Promise.all`); метрики: total wall-time, latency каждого, p50/p95/p99, error count
3. **Rate limit hit** — 15 быстрых запросов от одного ключа в цикле; assertion: первые ~10 успех, остальные 429
4. **Max context reject** — запрос с искусственным content на ≈10K токенов; assertion: 413
5. **Bad auth** — запрос без `Authorization`; assertion: 401
6. **Bad model** — запрос с моделью вне allowlist; assertion: 400

Финальный артефакт — `scripts/day30/report.md` с timestamp, hardware (через `llmfit system --json` если доступен), config сервиса, таблицами метрик, pass/fail per-сценарий. Raw данные (latency-массивы) — в `scripts/day30/raw/load-test-${ts}.json`. Скрипт `"day30-load": "bun run scripts/day30/load-test.ts"` в `package.json`.

### Acceptance criteria

- [ ] Сервис запущен (Phase 1-7), `bun run day30-load` отрабатывает без crash'а
- [ ] `scripts/day30/report.md` создан, содержит: header с timestamp/hardware/config, таблицу concurrency ladder с p50/p95/p99 и error rate, pass/fail для всех 6 сценариев
- [ ] Сценарий 3 (rate-limit) — pass: ≥1 запрос получил 429
- [ ] Сценарий 4 (max-context) — pass: запрос вернул 413 с правильным `limit`
- [ ] Сценарий 5 (bad auth) — pass: 401
- [ ] Сценарий 6 (bad model) — pass: 400 со списком разрешённых моделей в теле
- [ ] Concurrency ladder N=10 не приводит к crash'у сервиса (все запросы либо ok, либо корректный 429)
- [ ] `scripts/day30/raw/load-test-*.json` содержит latency-массивы для постфактум-анализа
- [ ] Manual: после load-test переключить Telegram-бота (day27) на сервис через env (`OPENAI_BASE_URL=http://localhost:8080/v1`, `OPENAI_API_KEY=$KEY`) — отправить сообщение, получить ответ

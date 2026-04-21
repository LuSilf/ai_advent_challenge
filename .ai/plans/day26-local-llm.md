# Plan: Day 26 — Запуск локальной LLM

> Source PRD: [.ai/prd/day26-local-llm.md](../prd/day26-local-llm.md)

## Architectural decisions

Durable решения, общие для всех фаз:

- **Расположение артефактов**: всё живёт в `scripts/day26/` — `queries.json`, `run-queries.ts`, `report.md` (генерируется), `conclusions.md` (idempotent skeleton + ручные правки).
- **Targets (зашиты в раннере)**:
  - `ollama:qwen2.5-coder:7b` (local)
  - `ollama:llama3.2:3b` (local, требуется `ollama pull` если не скачан)
  - `cloud:${OPENAI_MODEL}` (дефолт `openai/gpt-5-nano` через OpenRouter)
- **Параметры генерации**: `temperature=0`, `seed=42` — применяются ко всем targets без исключений.
- **Transport**: существующий `openai` SDK v6 (уже в `package.json`) с переопределением `baseURL`. Никакого нового клиента не создаётся — это проверяет OpenAI-совместимость нашего стека как побочный эффект.
- **Env contract**:
  - `OLLAMA_BASE_URL` — опционально, дефолт `http://localhost:11434/v1`.
  - `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` — читаются из окружения (репо-дефолты из `.env`). Если `OPENAI_API_KEY` пуст, cloud-target graceful-skip с пометкой `n/a` в отчёте.
- **npm-скрипт**: `"day26-local": "bun run scripts/day26/run-queries.ts"` в `package.json`.
- **Cost accounting**: через существующий `calculateCost` из `src/db.ts`. Local targets — `cost_usd = 0` явно. Неизвестные cloud модели — `n/a`.
- **Hardware snapshot**: через `llmfit system --json`, встраивается в header отчёта. Fallback на `unknown` если `llmfit` недоступен.
- **Без тестов**: по прецеденту day22-25 eval-скриптов. Self-check через preflight + smoke-ping внутри раннера.
- **Ноль правок `src/`**: весь код в `scripts/day26/` + одна строчка в `package.json`.

---

## Phase 1: SDK → Ollama smoke

**User stories**: 14

### What to build

Минимальный tracer bullet, доказывающий главную техническую гипотезу дня: наш OpenAI-клиент ходит в локальный Ollama endpoint без модификаций.

Стаб `run-queries.ts` делает один хардкод-вызов `qwen2.5-coder:7b` с промптом вроде `"Say 'ok' and nothing else"` через `openai` SDK с `baseURL=http://localhost:11434/v1`. Печатает в stdout: имя модели, ответ, wall-clock latency, prompt/completion tokens.

npm-скрипт `day26-local` добавлен и запускается.

### Acceptance criteria

- [ ] `bun run day26-local` завершается кодом 0 при запущенном Ollama и модели `qwen2.5-coder:7b` в списке
- [ ] В stdout видны: имя модели, текстовый ответ, latency в ms, `prompt_tokens`, `completion_tokens`
- [ ] Раннер использует импорт из `openai` npm-пакета (не fetch напрямую)
- [ ] При отсутствии Ollama на порту 11434 раннер падает с понятной ошибкой (не stack trace на пол-экрана)
- [ ] `package.json` содержит новый скрипт `day26-local`

---

## Phase 2: Full local suite → report.md

**User stories**: 1, 2, 3, 5, 6, 8, 10, 13, 15

### What to build

Расширяем раннер до полноценного прогона по каталогу запросов на двух локальных моделях, с записью markdown-отчёта.

Появляется `queries.json` с тремя фиксированными запросами (`factual` / `reasoning` / `code`) и структурой `{ id, category, prompt, description, expectedLanguage }`.

Раннер:
- Читает каталог запросов.
- Прогоняет `2 local targets × 3 queries = 6 вызовов` с `temperature=0`, `seed=42`.
- Preflight: для каждого local target делает `GET /api/tags` в Ollama REST и проверяет, что модель в списке. Если нет — падает с инструкцией `"ollama pull <model>"`.
- Smoke-ping: по одному короткому вызову на каждый target до основного цикла.
- Пишет `scripts/day26/report.md` с header (timestamp, конфигурация), summary-таблицей (target × query → latency / tokens/sec) и per-query секциями (prompt / response / latency / tokens / finish_reason).

Фаза не знает про cloud и hardware — только про local.

### Acceptance criteria

- [ ] `queries.json` содержит 3 запроса с id `q01_factual`, `q02_reasoning`, `q03_code`
- [ ] Прогон проходит по обеим local моделям для всех 3 запросов без ручного вмешательства
- [ ] `report.md` перезаписывается при каждом прогоне (не аппенд)
- [ ] Summary-таблица содержит по строке на каждый target и по колонке на каждый query
- [ ] Каждая per-query секция содержит полный текст ответа (не обрезанный)
- [ ] `finish_reason` виден в отчёте для каждого ответа
- [ ] При отсутствии модели в `ollama list` раннер падает до начала основного цикла с инструкцией, какую модель pull'ить
- [ ] Повторный прогон через 5 минут даёт те же тексты ответов (детерминизм работает на уровне Ollama, расхождения — only если Ollama их допускает)

---

## Phase 3: Cloud reference + hardware + cost

**User stories**: 4, 7, 9, 11, 16

### What to build

Добавляем третий target (cloud reference) и расширяем отчёт до полного артефакта дня.

Раннер:
- Читает `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` из окружения.
- Если ключа нет — cloud-target пропускается целиком, в отчёте появляется секция `## Cloud reference — skipped (OPENAI_API_KEY not set)`.
- Если ключ есть — прогоняет те же 3 запроса через cloud с теми же `temperature=0/seed=42`.
- Для cloud-target вызывает `calculateCost` из `src/db.ts`; если модель неизвестна, пишет `cost_usd: n/a`.
- В начале прогона вызывает `llmfit system --json`, встраивает CPU/RAM/GPU в секцию `## Hardware` отчёта. Fallback: `## Hardware — llmfit unavailable` если `which llmfit` пуст.
- Создаёт `scripts/day26/conclusions.md` только если файла ещё нет (idempotent skeleton с плейсхолдерами `## Что удивило`, `## Где local уступил`, `## Next steps`). При повторном запуске не трогает.

Отчёт теперь содержит 3 строки в summary-таблице (если cloud не пропущен) с latency + tokens/sec + cost_usd.

### Acceptance criteria

- [ ] При наличии `OPENAI_API_KEY` cloud-target прогоняется и попадает в отчёт
- [ ] При отсутствии `OPENAI_API_KEY` раннер завершается успешно, cloud-секция помечена как пропущенная
- [ ] Hardware-секция в начале отчёта содержит CPU, RAM, GPU/VRAM, backend (CUDA)
- [ ] Hardware-секция деградирует до `unknown` без падения раннера при отсутствии `llmfit`
- [ ] Cost в cloud-секции либо посчитан через `calculateCost`, либо явно помечен `n/a`
- [ ] Local targets в отчёте имеют `cost_usd: 0` (явно, не пустое поле)
- [ ] `conclusions.md` создаётся при первом прогоне и не переписывается при последующих
- [ ] Если один target падает, остальные завершают прогон, в отчёте появляется секция `## Failures` с диагностикой

---

## Phase 4: Actual run + manual conclusions

**User stories**: 11, 12

### What to build

Завершающая фаза: реальный прогон с валидацией и ручным заполнением выводов. Кода здесь нет, артефакт — это наполненные `report.md` и `conclusions.md`.

Действия:
- `ollama pull llama3.2:3b` (если ещё не скачана).
- Запуск `bun run day26-local`.
- Верификация `report.md` глазами:
  - все три target отработали;
  - ответы не обрезаны (в особенности code-ответ, `finish_reason=stop`);
  - summary-таблица сходится с per-query секциями;
  - hardware-секция корректна.
- Если 7B упала по OOM — downgrade до `qwen2.5-coder:3b`, зафиксировать в `conclusions.md`.
- Ручное заполнение `conclusions.md`:
  - субъективная оценка качества каждой модели на каждом типе запроса;
  - где local неожиданно хорош / плох vs cloud;
  - расхождения детерминизма (если повторный прогон дал другой текст);
  - кандидаты на day 27+ (стоит ли тянуть локальную модель в REPL, под какие классы задач).

### Acceptance criteria

- [ ] `scripts/day26/report.md` существует и содержит заполненные секции для всех targets
- [ ] `scripts/day26/conclusions.md` содержит ручные наблюдения (не только skeleton-плейсхолдеры)
- [ ] Все ответы в `report.md` имеют `finish_reason=stop` или ограничение явно прокомментировано в `conclusions.md`
- [ ] Повторный прогон выполнен минимум один раз для проверки детерминизма, результат (stable / drifting) зафиксирован в `conclusions.md`
- [ ] Если делали downgrade модели — отметка в `conclusions.md` с причиной
- [ ] Ветка `day26-local-llm` готова к мерджу: `git status` чист, тесты основного проекта не сломаны

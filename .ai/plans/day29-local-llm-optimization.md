# Plan: Day 29 — Оптимизация локальной LLM под RAG по system-design-primer

> Source PRD: `.ai/prd/day29-local-llm-optimization.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **Scope**: оптимизируется только генератор ответа локальной LLM (qwen3:4b). Retrieval-часть (embedder, reranker, query-rewriter) фиксирована на дефолтах дня 28. Cloud backend не крутится — его цифры из дня 28 используются как неподвижный ориентир.
- **Configs** (аккумулятивный ablation):
  - **C0** — baseline дня 28 (q4_K_M, soft prompt, temperature=0.2, num_predict=800, num_ctx=default).
  - **C1** — C0 + strict refusal prompt.
  - **C2** — C1 + tight params (temperature=0, num_predict=400, num_ctx=8192 явно через Ollama options).
  - **C3** — C2 + квантование q5_K_M.
- **Sample**: 5 вопросов (q03, q10, q11_oos, q12_oos, q13_oos) × 2 режима (`baseline`, `rag-full`) × 2 runs × 1 backend (local) = 20 генераций на конфиг, 80 всего.
- **Pareto axes**: refusal rate на OOS (↑) / cloud-judge avg на in-scope (↑) / p50 latency local (↓) / VRAM peak GB (↓).
- **Guard-rail**: конфиг с cloud-judge avg на in-scope (q03+q10) < baseline − 0.2 отбраковывается **до** построения Парето-фронта, даже если refusal идеален.
- **Refusal metric**: программный бинарный детектор. Работает только на OOS-вопросах (q11/q12/q13). Словарь refusal-фраз и per-question `topicalTerms` фиксируются до первого прогона.
- **Dual-judge**: cloud + local, как в дне 28. Judge-промпт не меняется. Используется существующий `DualJudgeService`.
- **Artifacts**:
  - Сырые прогоны: `scripts/day29/raw/c{0..3}.json` (ответ модели, refusal-результат, judge-scores, latency, VRAM snapshot).
  - Финальный отчёт: `scripts/day29/report.md` (таблица 4×4, Парето-фронт, per-question breakdown, рекомендация под prod).
  - Аналитический разбор: `scripts/day29/analysis.md` (ручные выводы, сюрпризы, проверка гипотезы).
- **Reuse**: `DualBackendEvalService`, `DualJudgeService`, `RagPipelineService`, `buildRagPromptSuffix`, `control-questions.json`, `rag-dual-backend-stats`, `rag-dual-backend-report` — не дублируем в day29/.
- **Deep module**: `RefusalDetector` — единственный настоящий модуль с тестами (Red-Green, ~25 кейсов).

---

## Phase 1: RefusalDetector + расширение control-questions

**User stories**: 7, 8, 9, 10, 16

### What to build

Изолированный модуль `RefusalDetector` с простым интерфейсом `detectRefusal(text, question) → { refused, matchedRefusalPhrase, foundTopicalTerm }`. Правило: `refused = true` при наличии refusal-фразы из фиксированного словаря И отсутствии тематических термов из `question.topicalTerms`.

Словарь refusal-фраз (двуязычный): «не знаю», «в базе нет», «нет информации», «не содержится», «не могу ответить», «не располагаю», «out of scope», «cannot answer», «no information», «not in the knowledge base», «insufficient».

Расширение `control-questions.json`: к каждому OOS-вопросу (q11_oos, q12_oos, q13_oos) добавляется поле `topicalTerms` — список тем-маркеров (например, для q11_oos: `["борщ", "рецепт", "ингредиенты", "свёкла", "мясо", "варить"]`). In-scope вопросы не трогаем.

Тесты — таблица ~25 кейсов: явный refusal по-русски, по-англ, ответ по существу, смешанное (refusal-фраза + тематические термы = не refusal), пустая строка, один символ. По Red-Green: сначала таблица падает, потом зелёная.

### Acceptance criteria

- [ ] Файл `src/domain/services/refusal-detector.ts` экспортирует `detectRefusal` с типизированным интерфейсом.
- [ ] Файл `src/domain/services/refusal-detector.test.ts` содержит 20+ кейсов и все проходят (`bun test src/domain/services/refusal-detector`).
- [ ] В `scripts/day22/control-questions.json` у q11_oos/q12_oos/q13_oos добавлено поле `topicalTerms` с осмысленными терминами каждой темы.
- [ ] Словарь refusal-фраз захардкожен внутри модуля, не конфигурируется снаружи (чтобы метрика была стабильна между прогонами).
- [ ] Тесты покрывают: явный refusal RU, явный refusal EN, ответ по существу, смешанное (refusal + тематические термы), граничные (пустая строка, пунктуация).

---

## Phase 2: Day29 pipeline + прогон C0 (baseline)

**User stories**: 1, 11, 12, 13, 14, 17, 18, 19

### What to build

Первый tracer bullet end-to-end. Создаётся `scripts/day29/run-eval.ts`, который адаптирует `scripts/day28/run-eval.ts`:

- Принимает `--config c0|c1|c2|c3` (для Phase 2 работает только `c0`).
- Только local backend (cloud-часть из day28-runner вырезается; cloud остаётся только в judge-цикле).
- Выборка фиксирована на 5 вопросах (q03, q10, q11_oos, q12_oos, q13_oos), передаётся через `--question-ids`.
- Режимы: `baseline`, `rag-full`. Runs=2.
- До warmup и после генераций снимается VRAM snapshot (`nvidia-smi --query-gpu=memory.used` + `ollama ps`). Значения пишутся в метаданные конфига.
- Для каждого ответа на OOS-вопрос применяется `RefusalDetector` из Phase 1. Результат сохраняется рядом с ответом.
- Dual-judge (cloud + local) прогоняется как в day28.
- Все результаты пишутся в `scripts/day29/raw/c0.json` (массив прогонов с метаданными конфига в заголовке).

Существующие сервисы (`DualBackendEvalService`, `DualJudgeService`, `RagPipelineService`) переиспользуются без изменений. Единственное — `BackendConfig` остаётся один (только local) вместо пары.

### Acceptance criteria

- [ ] `bun run scripts/day29/run-eval.ts --config c0` запускается без ошибок.
- [ ] Файл `scripts/day29/raw/c0.json` создаётся и содержит 20 записей о прогонах + метаданные конфига (имя модели, параметры, VRAM до/после, суммарные тайминги).
- [ ] Каждая запись содержит: questionId, modeName, runIndex, latencyMs, ответ модели, cloudJudge score+verdict, localJudge score+verdict, refusal-результат (только для OOS).
- [ ] Для in-scope вопросов (q03, q10) refusal-поле = null или отсутствует — не применяем детектор к не-OOS.
- [ ] VRAM snapshot содержит `memory.used` в MB до warmup и после финальной генерации.
- [ ] Прогон завершается за ~20 минут (включая dual-judge); если дольше 40 минут — фиксируем как баг и разбираемся.
- [ ] Никаких изменений в `buildRagPromptSuffix` или `rag-service.ts` (C0 использует существующий мягкий промпт).

---

## Phase 3: Прогон C1 (+strict refusal prompt)

**User stories**: 1, 2, 4, 15, 20

### What to build

Добавляется новая функция `buildStrictRefusalRagPromptSuffix(hits)` рядом с существующими двумя в `src/domain/services/rag-service.ts`. Формулировка — императивная, двуязычная, с явным запретом использовать общие знания при пустом retrieval.

В day29/run-eval.ts добавляется поддержка флага `--config c1`, который переключает promptVariant с `"soft"` на `"strict"`. Проброс этого флага внутрь pipeline осуществляется минимально-инвазивно: либо добавлением поля `promptVariant` в `EvalMode` / `RagPipelineMode`, либо через override в day29-runner до вызова сервиса. Способ выбирается так, чтобы не ломать day28-runner.

Прогон `bun run scripts/day29/run-eval.ts --config c1` даёт `raw/c1.json`. Всё остальное (модель, параметры, dual-judge) — идентично C0. Это изолирует эффект prompt-правки.

### Acceptance criteria

- [ ] В `rag-service.ts` появилась функция `buildStrictRefusalRagPromptSuffix`, покрытая формулировкой, пригодной для RU и EN входных вопросов.
- [ ] Существующие `buildRagPromptSuffix` и `buildCitedRagPromptSuffix` не изменены.
- [ ] `bun run scripts/day29/run-eval.ts --config c1` успешно отрабатывает и создаёт `raw/c1.json`.
- [ ] Сравнение raw/c0.json ↔ raw/c1.json по q11_oos показывает измеримую разницу в refusal rate и/или длине ответов (первичная проверка, что strict prompt действительно влияет).
- [ ] day28-runner (`scripts/day28/run-eval.ts`) по-прежнему запускается без ошибок (не ломаем обратную совместимость).
- [ ] Тесты `bun test` проходят без регрессий.

---

## Phase 4: Прогон C2 (+tight params)

**User stories**: 1, 2, 6

### What to build

Расширение механики передачи Ollama-специфичных опций через OpenAI-compatible wrapper. В `BackendConfig` (или эквиваленте) добавляется поле `ollamaOptions?: { numCtx?, numPredict?, temperature? }`. В `OpenAILLMClient` при наличии опций они прокидываются в request-body через `extra_body: { options: {...} }` (Ollama это понимает, OpenAI игнорирует — безопасно для будущих cloud-прогонов тем же клиентом).

Параметр temperature в `ollamaOptions` имеет приоритет над общим `temperature` прогона (в C2 local temperature=0, но судьи могут оставаться на своих настройках).

В day29/run-eval.ts для `--config c2` задаются: temperature=0, numPredict=400, numCtx=8192. Модель остаётся q4_K_M, promptVariant — `"strict"` (наследуется от C1).

Прогон даёт `raw/c2.json`. Сравнение c1↔c2 показывает вклад параметров.

### Acceptance criteria

- [ ] `BackendConfig` расширен опциональным `ollamaOptions`.
- [ ] `OpenAILLMClient` прокидывает опции через `extra_body.options` только когда они заданы; без опций — поведение без изменений.
- [ ] `bun run scripts/day29/run-eval.ts --config c2` успешно создаёт `raw/c2.json`.
- [ ] В метаданных c2.json зафиксировано, что temperature=0, numPredict=400, numCtx=8192.
- [ ] Существующие тесты сервисов проходят без изменений.
- [ ] day28-runner работает как раньше (ollamaOptions — опциональны и не задаются в day28).

---

## Phase 5: Прогон C3 (+q5_K_M квантование)

**User stories**: 3, 5, 17

### What to build

Перед прогоном: `ollama pull qwen3:4b-instruct-2507-q5_K_M` (~2.9 GB). Проверка, что модель доступна через `ollama list`.

В day29/run-eval.ts для `--config c3` выбирается модель `qwen3:4b-instruct-2507-q5_K_M`. Всё остальное (prompt=strict, temperature=0, numPredict=400, numCtx=8192) наследуется от C2.

VRAM snapshot становится особенно важным: q5_K_M весит ~2.9 GB, плюс embedder 0.3 GB + reranker/rewriter — вплотную к лимиту GTX 1650 4GB. Если `ollama ps` показывает partial offload на CPU — это фиксируется в метаданных и отдельно упоминается в отчёте, т.к. радикально меняет latency-сравнение.

Прогон даёт `raw/c3.json`.

### Acceptance criteria

- [ ] `qwen3:4b-instruct-2507-q5_K_M` установлен локально (виден в `ollama list`).
- [ ] `bun run scripts/day29/run-eval.ts --config c3` успешно создаёт `raw/c3.json`.
- [ ] VRAM snapshot в c3.json отличается от c0/c1/c2 (используется бóльшая модель).
- [ ] В метаданных c3.json зафиксирован флаг `partialOffload: true/false` на основе `ollama ps` вывода (требует парсинга).
- [ ] Если partial offload обнаружен — в отчёт дня выносится как явное предупреждение, но прогон не отменяется.

---

## Phase 6: Aggregate + report + аналитический разбор

**User stories**: 4, 15, 20, 21

### What to build

`scripts/day29/aggregate.ts` читает четыре JSON из `raw/`, собирает:

1. Refusal rate на OOS для каждого конфига (процент `refused=true` среди 12 OOS-прогонов: 3 вопроса × 2 режима × 2 runs).
2. Cloud-judge avg на in-scope (среднее по q03+q10, всего 8 прогонов на конфиг: 2 вопроса × 2 режима × 2 runs).
3. Latency p50 и p95 на local (по 20 прогонам конфига).
4. VRAM peak (max `memory.used` из snapshot'ов конфига).

Применяет guard-rail (cloud-judge in-scope ≥ baseline − 0.2) и для оставшихся конфигов считает Парето-фронт по 4 осям. Выводит:

- `scripts/day29/report.md` — с executive summary (1-2 предложения), таблицей 4×4 с пометками «on-front / dominated by Cx / rejected by guard-rail», per-question breakdown для OOS (q11/q12/q13 × 4 конфига), таблицей сюрпризов, финальной рекомендацией под prod.

Ручной analysis.md пишется поверх report.md — как в day28. Содержит: проверку гипотезы «C1 даёт 80% эффекта по refusal», что удивило, где local теперь выигрывает/проигрывает cloud-референсу из day28, trade-offs между осями, next steps на день 30+.

### Acceptance criteria

- [ ] `bun run scripts/day29/aggregate.ts` отрабатывает за <1 минуты и создаёт `report.md`.
- [ ] `report.md` содержит: executive summary, таблицу 4 конфигов × 4 оси, явную маркировку Парето-фронта, per-question breakdown для OOS, рекомендацию под prod.
- [ ] Guard-rail применяется корректно: если какой-то конфиг просадил in-scope >0.2, он помечен как `rejected` и исключён из фронта (но цифры для него всё равно видны в таблице).
- [ ] `analysis.md` написан вручную, содержит: проверку гипотезы дня, сюрпризы, trade-offs, next steps.
- [ ] В конце дня делается commit с сообщением вида `day29: phase 6 — Парето-фронт и отчёт`.
- [ ] Все 6 фаз отражены в отдельных коммитах (один-два commit на фазу), git log читается как история дня.

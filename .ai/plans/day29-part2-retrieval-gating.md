# Plan: Day 29 (Part 2) — Retrieval-gating refusal

> Source PRD: `.ai/prd/day29-part2-retrieval-gating.md`
> Context: всё ещё день 29, ветка `day29-local-llm-optimization`. Артефакты идут в `scripts/day29/part2-retrieval-gating/`, первые прогоны (c0-c3, report.md, analysis.md) **не перезаписываются**.

## Architectural decisions

Durable decisions that apply across all phases:

- **Refusal уровень**: pipeline (не генератор). При `max(rerankedHit.relevanceScore) < threshold` pipeline возвращает `status="refused"`; runner **не вызывает LLM**.
- **Refusal-text**: `"В базе знаний нет информации по этому вопросу."` (совпадает со strict prompt part1, чтобы существующий RefusalDetector из `src/domain/services/refusal-detector.ts` ловил).
- **Конфиги**: D0 (no gating, control) + D1/D2/D3 (gating с threshold 0.3 / 0.5 / 0.7). Все используют q4_K_M + soft prompt + temp=0.2 + max=800 — изолирует эффект единственной правки (gating).
- **Выборка дня**: q03, q10, q11_oos, **q12b_oos** (новый — «курс доллара к рублю сегодня?»), q13_oos. q12_oos (Мадагаскар) остаётся в файле для обратной совместимости, но не входит в part2 sample.
- **Guard-rail**: cloud-judge avg на q03+q10 ≥ 1.43 (from part1 baseline − 0.2). Конфиги с in-scope ниже — отбраковываются из Парето-фронта.
- **Парето-оси**: refusal rate на OOS (↑), in-scope cloud-judge avg (↑), p50 latency (↓), VRAM peak (↓).
- **Артефакты**:
  - Сырые прогоны: `scripts/day29/part2-retrieval-gating/raw/d{0..3}.json`.
  - Финальный отчёт: `scripts/day29/part2-retrieval-gating/report.md`.
  - Аналитический разбор: `scripts/day29/part2-retrieval-gating/analysis.md`.
- **Reuse**: `RefusalDetector` (без изменений), `DualBackendEvalService` (модификация под `status="refused"`), `RagPipelineService` (добавление `refusalPolicy`), `DualJudgeService`, структура `aggregate.ts` из part1.
- **Deep module**: `RetrievalRefusalPolicy` — единственный настоящий новый модуль с Red-Green тестами (~12 кейсов).
- **Gating область применения**: только в `rag-full` режиме. `baseline` (без retrieval) не трогается — остаётся контрольной точкой «модель отвечает что хочет».

---

## Phase 1: Policy + pipeline/runner infra (без прогонов)

**User stories**: 1, 8, 9, 10, 11, 14, 15, 16, 17, 18

### What to build

Первая тонкая пуля, цель — всё железо готово к D0-прогону, но самого прогона ещё нет.

- **Deep module** `RetrievalRefusalPolicy` с простым интерфейсом `decide(retrieval) → { shouldRefuse, reason, maxRelevanceScore }`. Правила: `no_hits`/`insufficient_context` → refuse; `ok` + max score < threshold → refuse; иначе — passthrough. Threshold в конструкторе.
- **Red-Green тесты** для policy: ~12 кейсов (граничные threshold, пустые hits, смешанные релевансы, все три входных статуса, отсутствие rerankedHits).
- **Модификация `RagPipelineService`**: опциональный `refusalPolicy` в `RagMode`. Когда policy возвращает `shouldRefuse=true`, retrieve() возвращает новый `status="refused"` с полями `refusalText`, `refusalReason`, `maxRelevanceScore`. Обратная совместимость: без policy — поведение как part1.
- **Модификация `DualBackendEvalService.executeOne`**: при `retrieval.status === "refused"` — не вызывать LLM, вернуть `AnswerRun` с `answer=refusalText`, `latencyMs` = только retrieval+rerank, новым полем `skippedLLM=true` и `refusalReason`.
- **Добавление q12b_oos** в `control-questions.json`: «Какой курс доллара к рублю сегодня?» с `outOfScope=true` и topicalTerms (курс/доллар/рубль/usd/rub и т.п.). q12_oos не удаляем — оставляем для совместимости.
- **Init скриптов**: `scripts/day29/part2-retrieval-gating/{configs,run-eval}.ts` (заготовки), `raw/` директория.

### Acceptance criteria

- [ ] `bun test src/domain/services/retrieval-refusal-policy.test.ts` — все ~12 кейсов зелёные.
- [ ] `bun test` в целом — без регрессий (все существующие тесты проходят).
- [ ] `control-questions.json` содержит q12b_oos с `outOfScope=true` и topicalTerms (JSON валидный).
- [ ] `RagPipelineService.retrieve(...)` с сконструированным `refusalPolicy(threshold=0.5)` и mock-данных с низким relevance возвращает `status="refused"` и `refusalText`.
- [ ] `DualBackendEvalService.run(...)` с `status="refused"` от pipeline возвращает AnswerRun с `skippedLLM=true` и `answer=refusalText`, не вызывая `LLMClient.send()`.
- [ ] `scripts/day29/part1-выход c0-c3` не изменены (никаких правок в `scripts/day29/raw/`, `report.md`, `analysis.md`).
- [ ] Коммит вида `day29 part2: phase 1 — RetrievalRefusalPolicy + pipeline infra`.

---

## Phase 2: D0 прогон (baseline без gating, с q12b)

**User stories**: 11, 3, 14

### What to build

Контрольная точка перед экспериментами. D0 использует тот же soft prompt и параметры, что part1 C0, но выборка обновлена (q12 → q12b). Это даёт чистую baseline-точку, сопоставимую с part1 C0 по всем осям, кроме выборки.

- D0 конфиг: `refusalPolicy` **не задан** (gating выключен), модель q4_K_M, soft prompt, temp=0.2, max=800, num_ctx default.
- Прогон через `scripts/day29/part2-retrieval-gating/run-eval.ts --config d0` на 5 вопросах × 2 режима × 2 runs = 20 generations.
- Dual-judge + RefusalDetector на OOS.
- Артефакт `raw/d0.json`.

### Acceptance criteria

- [ ] `bun run scripts/day29/part2-retrieval-gating/run-eval.ts --config d0` отрабатывает без ошибок.
- [ ] `raw/d0.json` содержит 20 записей с cloud+local judge, refusal (для OOS), VRAM snapshot.
- [ ] В D0 **никаких** `skippedLLM=true` записей — gating выключен, все прогоны идут через LLM.
- [ ] Проверка на q12b: либо модель пытается ответить из общих знаний (галлюцинация), либо отказывается. Это документируется, но не меняет прогон.
- [ ] In-scope cloud-judge avg D0 в диапазоне 1.4-1.8 (близко к part1 C0's 1.63 — допустимы флуктуации из-за q12 → q12b).
- [ ] Коммит: `day29 part2: phase 2 — D0 baseline прогон (с q12b)`.

---

## Phase 3: D1 прогон (threshold=0.3, мягкий gating)

**User stories**: 2, 4, 6, 7

### What to build

Первый прогон с включённым retrieval-gating. threshold=0.3 — совпадает с текущим `rejectedRelevanceThreshold` в `LlmRerankerService` (это и есть «статус-кво» для reranker-фильтрации, проверяем, даёт ли он уже refusal).

- D1 конфиг: как D0, но `refusalPolicy(threshold=0.3)` включён в `rag-full` режим.
- Прогон: 20 generations, ожидаю на OOS — частичное срабатывание gating (q11/q13, где reranker уверенно ставит низкие scores, могут быть refused; q12b — зависит от того, находит ли reranker хоть что-то про деньги).
- Артефакт `raw/d1.json` + лог `skippedLLM` count.

### Acceptance criteria

- [ ] `raw/d1.json` создан.
- [ ] В каждом OOS-прогоне артефакт содержит `maxRelevanceScore` (для последующего анализа границ).
- [ ] Для прогонов с `skippedLLM=true`: `answer = "В базе знаний нет информации по этому вопросу."`, RefusalDetector ставит `refused=true`.
- [ ] Baseline (non-rag) прогоны НЕ имеют `skippedLLM=true` — gating не применяется вне rag-full.
- [ ] In-scope cloud-judge avg D1 не ниже 1.43 (guard-rail). Если ниже — фиксируем в коммит-сообщении как нарушение.
- [ ] Коммит: `day29 part2: phase 3 — D1 прогон (threshold=0.3)`.

---

## Phase 4: D2 прогон (threshold=0.5, главный кандидат)

**User stories**: 2, 4, 5, 6

### What to build

Sweet spot. Ожидаю, что D2 даёт refusal 2-4/4 на большинстве OOS-вопросов, сохраняя in-scope. Это **главная ставка дня**.

- D2 конфиг: то же что D1, threshold=0.5.
- Прогон 20 generations.
- Артефакт `raw/d2.json`.

### Acceptance criteria

- [ ] `raw/d2.json` создан.
- [ ] Latency p50 на rag-full OOS-прогонах **заметно ниже** C0/D0/D1 (из-за skip-LLM — должно быть ~3-5s вместо ~40s).
- [ ] In-scope cloud-judge avg ≥ 1.43 (guard-rail).
- [ ] Если OOS refusal rate ≥ 2/4 на q11+q12b+q13 — фиксируем как **«цель дня потенциально достигнута»** в коммит-сообщении.
- [ ] Коммит: `day29 part2: phase 4 — D2 прогон (threshold=0.5, главный кандидат)`.

---

## Phase 5: D3 прогон (threshold=0.7, жёсткий gating)

**User stories**: 4, 5, 12

### What to build

Агрессивный threshold. Риск: q10 в part1 уже был «на грани» (retrieval иногда пустой, иногда слабо-релевантный). threshold=0.7 может отсечь и in-scope q10, что обрушит guard-rail. Это ожидаемый исход — Парето-ось должна иметь точку «перестарались».

- D3 конфиг: то же что D2, threshold=0.7.
- Прогон 20 generations.
- Артефакт `raw/d3.json`.

### Acceptance criteria

- [ ] `raw/d3.json` создан.
- [ ] Артефакт явно показывает, как q10 прошёл gating: либо max relevance > 0.7 (gating не сработал), либо < 0.7 (skip-LLM, что ломает in-scope).
- [ ] Если D3 не прошёл guard-rail — это валидный исход, не баг. Фиксируется в коммите.
- [ ] Коммит: `day29 part2: phase 5 — D3 прогон (threshold=0.7, stress-test)`.

---

## Phase 6: Aggregate + report + analysis + cross-day

**User stories**: 12, 13, 14, 15, 16, 19, 20

### What to build

Итоговая фаза — полная картина.

- `scripts/day29/part2-retrieval-gating/aggregate.ts` — копия part1 `aggregate.ts` с добавленной колонкой «skipped-LLM count» и доп. логикой вывода `maxRelevanceScore` распределения по OOS.
- `report.md` — Парето-таблица 4 конфигов D0-D3 × 4 оси с пометками on-front / dominated / rejected. Per-question refusal breakdown. Сравнительная таблица D0 ↔ C0 (из part1) — «как изменился baseline после замены q12 → q12b».
- `analysis.md` — ручной разбор:
  - Какой threshold рекомендую для prod.
  - Trade-offs на каждой оси.
  - Overfit-warning (threshold подогнан под 3 OOS).
  - Cross-day сравнение part1 ↔ part2: решили ли то, что вчера не смогли.
  - Что делать, если D2 провалился (варианты next steps: citations / 7B / другой embedder).
- Финальный коммит.

### Acceptance criteria

- [ ] `aggregate.ts` читает все 4 JSON (d0-d3) и формирует `report.md`.
- [ ] `report.md` содержит: executive summary, Парето-таблицу с verdict, per-question breakdown, cross-day сравнение с part1.
- [ ] `analysis.md` написан вручную и содержит: рекомендацию по threshold, trade-offs, overfit-warning, cross-day сравнение, next steps.
- [ ] Guard-rail корректно применяется: конфиги с in-scope < 1.43 помечены `rejected`.
- [ ] Part1 артефакты (c0-c3.json, report.md, analysis.md в `scripts/day29/`) **не изменены** по всей ветке.
- [ ] Финальный коммит: `day29 part2: phase 6 — aggregate + report + analysis (cross-day)`.
- [ ] Все 6 фаз — отдельные коммиты, git log читается как история второго захода на ту же задачу.

# Day 29 (Part 2) — Retrieval-gating refusal (второй заход на OOS-отказы)

> Контекст: остаёмся в дне 29, ветка `day29-local-llm-optimization`. Артефакты второго захода лежат в `scripts/day29/part2-retrieval-gating/` и не перезаписывают первые прогоны (c0-c3, report.md, analysis.md).

## Problem Statement

День 29 потратил сутки на оптимизацию генератора (strict prompt + tight params + квантование q8) и получил `refusal 0/12` во всех 4 конфигурациях. Цель дня 29 — `refusal 2-4/4` — не достигнута ни одной осью оптимизации.

Главное открытие дня 29: в единственном прогоне, где strict prompt **сработал** (q10 rag-full в C2), retrieval оказался **полностью пустым** — модель буквально процитировала refusal-шаблон. На q11/q12/q13 retrieval всегда возвращал слабо-, но не-нулево-релевантные hits, и 4B-модель проигнорировала инструкцию отказаться, сгенерировав ответ из общих знаний.

Вывод: **проблема не в формулировке prompt-а, а в архитектуре pipeline.** Пока retrieval что-то возвращает, модель будет отвечать. Единственный способ получить детерминированный refusal — не вызывать LLM в случаях, когда retrieval заведомо нерелевантен.

Методологическая проблема, которую день 29 тоже обнаружил: q12_oos («столица Мадагаскара») — **плохой OOS-тест**. Модель знает ответ из весов и стабильно отвечает «Антананариву» за 900ms в каждом конфиге. Любой retrieval-gating даст formally-refusal на этом вопросе, не доказав ничего про реальную защиту от галлюцинаций.

## Solution

Перенести ответственность за refusal с **генератора** на **pipeline-уровень**.

Когда retrieval-система после rerank признаёт, что ни один hit не релевантен запросу, pipeline возвращает заготовленный refusal-ответ, **не вызывая LLM вообще**. Это даёт:

- **100% детерминированный refusal**: одинаковый OOS-вопрос всегда даёт одинаковый отказ. Никаких «иногда модель одумается, иногда нет».
- **Низкая latency на OOS**: вместо 40-100s генерации — 3-5s на retrieval+rerank и мгновенный возврат.
- **Простая одна ручка настройки**: threshold на reranker-relevance-score. Ниже порога — refusal, выше — нормальная генерация.

Для второго захода прогоняем **4 конфигурации**:

- **D0** — baseline: retrieval-gating **выключен** (как в day29). Для чистого сравнения.
- **D1** — gating включён, threshold=0.3 (мягкий — совпадает с дефолтом day23).
- **D2** — gating включён, threshold=0.5 (средний).
- **D3** — gating включён, threshold=0.7 (жёсткий).

Q12 заменяется на **q12b_oos: «Какой курс доллара к рублю сегодня?»** — факт, который недоступен ни в весах модели (временной cutoff), ни в корпусе system-design-primer. Это честный OOS-тест, который нельзя «взломать» знанием из весов.

Метрика успеха (как в day29): refusal rate на OOS (q11 + q12b + q13) ≥ 2/4 в каждой категории, при guard-rail cloud-judge avg на in-scope (q03, q10) ≥ 1.43.

## User Stories

1. Как разработчик локального RAG, хочу, чтобы pipeline сам отказывался при слабом retrieval, потому что 4B-генератор не следует strict-инструкции (подтверждено на day29).
2. Как разработчик локального RAG, хочу детерминированный refusal: один и тот же OOS-вопрос даёт один и тот же отказ, без «модели настроения».
3. Как разработчик локального RAG, хочу, чтобы на OOS latency падала в 10+ раз (с ~40s генерации до ~3s retrieval), потому что skip-LLM — это самая быстрая оптимизация.
4. Как разработчик локального RAG, хочу прогнать 3 значения threshold (0.3 / 0.5 / 0.7), чтобы увидеть Парето-фронт по этой оси и понять, где sweet spot.
5. Как разработчик локального RAG, хочу guard-rail: если in-scope просел на >0.2, конфиг отбракован, независимо от refusal rate.
6. Как разработчик локального RAG, хочу видеть, какой max reranker-score был у каждого OOS-прогона, чтобы понимать, насколько близко/далеко мы от границы отказа.
7. Как разработчик локального RAG, хочу отдельный маркер в артефактах: «pipeline refused» (не вызывали LLM) vs «LLM refused» (LLM сказала refusal-фразу), чтобы разделять две категории.
8. Как разработчик локального RAG, хочу заменить q12_oos на вопрос, ответ на который НЕ в весах модели (текущий q12 — известен из весов, даёт false success любому pipeline-gating).
9. Как разработчик локального RAG, хочу deep-module RetrievalRefusalPolicy, который можно тестировать изолированно (вход: retrieval result; выход: shouldRefuse).
10. Как разработчик локального RAG, хочу переиспользовать RefusalDetector из day29 без изменений, потому что его словарь и топикальные термы уже проверены тестами.
11. Как разработчик локального RAG, хочу, чтобы baseline D0 был сопоставим с day29 C0: та же модель, тот же prompt, только новый q12b.
12. Как разработчик локального RAG, хочу отчёт автоматически строил Парето-фронт по 4 осям (refusal / in-scope / latency / VRAM), идентичный day29 отчёту, чтобы день-к-дню сравнивать.
13. Как разработчик локального RAG, хочу ручной analysis.md, где описано: какой threshold рекомендую, какие trade-offs, где методология ограничена (overfit на 3 OOS-вопросах).
14. Как разработчик локального RAG, хочу, чтобы gating применялся ТОЛЬКО в rag-full режиме. Baseline (без retrieval) остаётся «модель отвечает что хочет» — для контрольного сравнения.
15. Как разработчик локального RAG, хочу, чтобы включение gating не ломало существующие флоу: rag-full для in-scope вопросов продолжает работать как раньше, вызывая LLM с промптом.
16. Как разработчик локального RAG, хочу, чтобы артефакт каждого прогона содержал retrieval-debug: все hits до и после rerank, их scores, решение policy.
17. Как разработчик локального RAG, хочу чёткий refusal-text при pipeline-refusal, который ловится RefusalDetector: «В базе знаний нет информации по этому вопросу.»
18. Как разработчик локального RAG, хочу, чтобы policy учитывал все три retrieval-статуса: `ok` + проверка score, `no_hits` → refuse, `insufficient_context` → refuse.
19. Как разработчик локального RAG, хочу честно задокументировать в analysis.md, что threshold подогнан под конкретную выборку — это не statistically validated порог, а калибровка под 3 OOS-вопроса.
20. Как разработчик локального RAG, хочу продолжения: если part2 достигнет refusal 3-4/4 — следующий день валидирует на новых OOS-вопросах. Если НЕ достигнет — следующий день переходит к Гипотезе D (замена 4B на 7B).

## Implementation Decisions

### Deep module: RetrievalRefusalPolicy

- Вход: результат retrieval (статус + массив rerankedHits с relevanceScore).
- Выход: `{ shouldRefuse: boolean, reason: "no_hits" | "below_threshold" | "insufficient_context" | null, maxRelevanceScore: number | null }`.
- Правило:
  - `status="no_hits"` → shouldRefuse=true, reason=no_hits.
  - `status="insufficient_context"` → shouldRefuse=true, reason=insufficient_context.
  - `status="ok"` и max(rerankedHits.relevanceScore) < threshold → shouldRefuse=true, reason=below_threshold.
  - иначе → shouldRefuse=false.
- Threshold передаётся в конструктор policy. 0.3 / 0.5 / 0.7 — основные варианты.
- Не зависит от Ollama, LLM, embedder — чистая detection-логика.

### Изменения в RagPipelineService

- Добавляется опциональное поле `refusalPolicy` в RagMode (или эквивалент).
- Когда policy.shouldRefuse=true, retrieve() возвращает **новый status="refused"** с полями:
  - `refusalReason` (из policy).
  - `refusalText` — стандартная фраза «В базе знаний нет информации по этому вопросу.» (та же, что в strict prompt дня 29, чтобы RefusalDetector ловил).
  - `maxRelevanceScore` (для analysis).
- Сохраняется обратная совместимость: если refusalPolicy не задан — поведение не меняется.

### Изменения в DualBackendEvalService (или part2-runner)

- В executeOne: если retrieval.status === "refused" → **НЕ вызывать LLMClient.send()**. Вернуть AnswerRun:
  - `answer` = retrieval.refusalText.
  - `latencyMs` = только retrieval+rerank time.
  - `skippedLLM = true` (маркер, для reporting).
  - `refusalReason` = retrieval.refusalReason.
- Для остальных статусов — поведение как в day29.

### Изменения в control-questions.json

- Добавить **q12b_oos**: «Какой курс доллара к рублю сегодня?»
  - outOfScope: true.
  - topicalTerms: ["курс", "доллар", "рубл", "usd", "rub", "цена", "стоимость", "обмен"].
- q12_oos (Мадагаскар) остаётся в файле для обратной совместимости, но не используется в выборке дня 30.
- Выборка дня 30: `q03, q10, q11_oos, q12b_oos, q13_oos`.

### Новые скрипты (part2-retrieval-gating)

- **scripts/day29/part2-retrieval-gating/configs.ts** — словарь 4 конфигов D0-D3.
- **scripts/day29/part2-retrieval-gating/run-eval.ts** — адаптированный day29 runner. Принимает `--config d0|d1|d2|d3`. Применяет RetrievalRefusalPolicy если threshold задан. Только local backend, 5 вопросов (с q12b).
- **scripts/day29/part2-retrieval-gating/aggregate.ts** — копия day29 aggregate.ts, с добавленной колонкой «skipped-LLM count».
- **scripts/day29/part2-retrieval-gating/raw/d{0..3}.json** — артефакты.
- **scripts/day29/part2-retrieval-gating/report.md** + **analysis.md**.

### Конфиги

| config | refusalPolicy | threshold | model | promptVariant |
|---|---|---|---|---|
| D0 | disabled | n/a | q4_K_M | soft (day29 C0 baseline) |
| D1 | enabled | 0.3 | q4_K_M | soft |
| D2 | enabled | 0.5 | q4_K_M | soft |
| D3 | enabled | 0.7 | q4_K_M | soft |

Prompt variant **soft** (не strict) — важно. Strict prompt в day29 сломал in-scope (guard-rail violation). Pipeline-gating должен работать и с мягким prompt-ом; если сработает — это дополнительное подтверждение, что проблема была именно в триггере, а не в формулировке.

### Reuse из day29

- **RefusalDetector** — без изменений.
- **RagPipelineService** — модифицируется (добавляется policy).
- **DualBackendEvalService** — модифицируется (skip LLM на status=refused).
- **Runner structure** — копия day29 с минимальными правками.
- **Aggregate logic** — копия.

## Testing Decisions

### Что делает тест хорошим

Тест проверяет только внешнее поведение модуля — вход/выход. Для RetrievalRefusalPolicy это означает: на входе — retrieval result + threshold, на выходе — `{ shouldRefuse, reason, maxRelevanceScore }`. Тест не знает, как реализована логика сравнения, только что на конкретных входах получаются конкретные выходы.

### RetrievalRefusalPolicy tests (Red-Green)

~12 кейсов:

1. **status=ok, один hit, relevance > threshold** → no refuse, maxRelevanceScore корректный.
2. **status=ok, один hit, relevance = threshold** (граничный, строгое `<` в условии) → no refuse.
3. **status=ok, один hit, relevance < threshold** → refuse, reason=below_threshold.
4. **status=ok, три hits, все < threshold** → refuse, maxRelevanceScore = max из трёх.
5. **status=ok, три hits, один >= threshold** → no refuse.
6. **status=ok, пустой массив rerankedHits** → refuse (consistent with no_hits).
7. **status=no_hits** → refuse, reason=no_hits, maxRelevanceScore=null.
8. **status=insufficient_context** → refuse, reason=insufficient_context.
9. **status=ok, rerankedHits = undefined** (обычные hits без score) → refuse (no rerank data).
10. **Граничное: threshold=1.0, hit с relevance=1.0** → no refuse (строгое `<`).
11. **Граничное: threshold=0.0, hit с relevance=0.0** → no refuse.
12. **Граничное: threshold=0.5, hit с relevance=0.499999** → refuse.

### Остальное — без юнит-тестов

- run-eval.ts, aggregate.ts — одноразовая оркестрация, не тестируется юнитами.
- Изменения в RagPipelineService — тестируется integration-прогоном (D1-D3 на реальных данных).
- RefusalDetector — не трогаем, его 23 теста из day29 остаются.

### Prior art

- `src/domain/services/refusal-detector.test.ts` — табличный стиль Red-Green, ближайший стилистически.
- `src/domain/services/rag-pipeline-service.test.ts` — тесты на pipeline с retrieval mock'ами.
- `src/domain/services/threshold-filter.test.ts` (если есть) — тестирование фильтрующих модулей.

## Out of Scope

- **Fine-tuning модели** для OOS detection — overkill, отдельная тема.
- **Citations-mode** (`buildCitedRagPromptSuffix`) как альтернативная гипотеза — отложено, т.к. JSON output ломает RefusalDetector. Если второй заход не сработает — citations — кандидат на следующий день.
- **Замена модели на qwen3:7b / llama3.1:8b** — выход за рамки «оптимизация pipeline», отложено.
- **Few-shot examples в system-prompt** — не пробуется во втором заходе, т.к. pipeline-level решение проще и детерминированнее.
- **Новый embedder (bge-m3)** — отложено, один эксперимент за один день.
- **Retrieval-gating в baseline-режиме** — не применимо, там retrieval вообще не вызывается.
- **forceAnswer opt-out** — для prod важно, для второго захода не добавляем.
- **Расширение выборки** — 5 вопросов сохраняем, статистическая сила та же, что в day29 (3 OOS × 2 режима × 2 runs = 12 OOS-прогонов).
- **Квантование q8_0** — пробовали в day29, провалилось. Не повторяем.
- **Overfit validation** на отдельной выборке OOS-вопросов — признаём, что threshold подгонится под 3 OOS-вопроса. Cross-validation — отдельная задача для следующего дня.

## Further Notes

### Ожидания по результатам

- **D2 (threshold=0.5)** — мой главный фаворит. Reranker-score обычно чётко разделяет «вот материал про master-slave replication» (0.8+) и «вот что-то про базу данных, но не про борщ» (0.2). threshold=0.5 должен попасть в золотую середину: q03/q10 проходят (in-scope сохранится), q11/q12b/q13 отсекаются (refusal поднимется до 2-4/4).
- **D3 (threshold=0.7)** — агрессивный. Возможно, отсечёт q10 (где retrieval в day29 был на грани). Риск падения in-scope → guard-rail violation.
- **D1 (threshold=0.3)** — мягкий. Возможно, не отсечёт OOS (если слабые hits проходят 0.3 по reranker). Ожидаемый refusal ≤ 2/12.
- **D0** — контроль, как C0 день 29, но с q12b вместо q12. Ожидаю refusal 1-2/12 на q12b (которую модель не знает).

### Overfit-warning (обязательно в analysis.md)

Threshold подбираю на тех же 3 OOS-вопросах, по которым оцениваю результат. Это technically overfit. Для честности в analysis.md опишу: «Threshold 0.5 калиброван на q11/q12b/q13 — это не statistically validated порог. Для prod-использования нужна валидация на 10+ независимых OOS-вопросах».

### Risk-mitigation

Главный риск: **policy отсечёт in-scope вопросы**. Если threshold=0.7 срежет q10 (который в day29 уже в boundary), in-scope cloud-judge упадёт ниже 1.43. Guard-rail поймает это, D3 будет отбракован. Это штатный, ожидаемый исход — не баг.

Второй риск: **reranker выдаёт артефактные high scores** (например, ошибается на рецептах борща, считая их релевантными). В этом случае policy не сработает, и я увижу refusal=0 даже на D3. Это означает, что reranker сам нуждается в доработке, и Гипотеза A провалилась. Переход к Гипотезе C (citations-mode).

### Timing

- Phase 1: RetrievalRefusalPolicy + тесты + q12b в control-questions. ~45 min coding.
- Phase 2: модификация RagPipelineService + DualBackendEvalService. ~30 min coding.
- Phase 3: part2 runner + configs. ~20 min coding.
- Phase 4: D0 прогон (~19 min).
- Phase 5: D1 прогон (~16 min, поскольку skip-LLM на OOS сокращает время).
- Phase 6: D2 прогон (~12-15 min).
- Phase 7: D3 прогон (~10-12 min).
- Phase 8: aggregate + report + analysis. ~45 min.

Итого ~4 часа (coding + GPU). Быстрее day29, т.к. аккумулированная инфраструктура.

### Interaction с day29

- День 30 использует те же 5 вопросов (с q12 → q12b).
- День 30 использует тот же RefusalDetector.
- День 30 использует ту же шкалу judge-ей (cloud + local).
- В финальном analysis.md сравниваю D0-D3 с C0-C3 дня 29 для cross-day анализа: «смогли ли мы решить то, что вчера не смогли».
- Если D2/D3 достигнут refusal 3-4/4 при in-scope ≥ 1.43 — **это победа over day29**, которую стоит задокументировать публично.

### Методологические принципы (повтор из day29)

- Гипотезы фиксируются до первого прогона.
- Threshold-значения (0.3 / 0.5 / 0.7) фиксируются до первого прогона (не подбираем post-hoc).
- RefusalDetector не меняем (чтобы «до» и «после» считались одним алгоритмом).
- Guard-rail (1.43) фиксирован из day29 baseline.
- Все raw артефакты сохраняются для верификации.

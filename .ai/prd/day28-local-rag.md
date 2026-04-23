# Day 28 — Полностью локальная RAG-система и её сравнение с cloud

## Problem Statement

К концу недели 6 (дни 21–24) у меня собран рабочий RAG-пайплайн: SQLite-vector-index по system-design-primer, Ollama-эмбеддер на `nomic-embed-text`, четыре режима retrieval-обвеса (plain / threshold / reranker / full), eval-скрипт `rag-pipeline-eval.ts` с judge'ом через cloud LLM. Retrieval, reranker и query-rewriter **уже локальные** — бегают в Ollama. Но **генератор ответа** до сих пор ходит в cloud (`gpt-5-nano` через OpenAI-compatible endpoint). То есть на вопрос «у меня полностью локальный RAG?» я должен честно сказать «нет, генерация — cloud».

День 27 доказал, что локальная 3B-модель через Ollama стабильно держит sub-second latency на follow-up'ах и что `OpenAILLMClient` универсален (chat.completions идут и в Ollama, и в OpenRouter, и в OpenAI — один клиент, меняется только `baseUrl`/`apiKey`/`model`). Значит, **механического блокера** для полной локализации нет.

Зато есть **методологический вопрос**: а что я получу, если заменю cloud-генератор на 3B-local? Насколько упадёт качество? Насколько вырастет latency? Становится ли система нестабильной (ошибки, прыгающие ответы, деградация после длительной нагрузки)? Без измерения перевод на local — слепой прыжок. Без сравнения с cloud-baseline — «ну работает как-то» без опорной точки.

Кроме того, если RAG полностью локальный, а judge по-прежнему cloud — отчёт методологически хромает: есть риск bias cloud-judge'а в сторону cloud-ответов. Нужен dual judge (cloud + local), чтобы сказать «судьи согласились / разошлись».

## Solution

Новый день-28 батч-эксперимент, который один раз честно замеряет полностью локальный RAG и кладёт его рядом с cloud-RAG на той же матрице вопросов/режимов.

**Суть**:

1. Беру 10 контрольных вопросов из дня 22 и 5 режимов из дня 23 (baseline без RAG + plain / threshold / reranker / full).
2. Для каждой (вопрос × режим) прогоняю **две конфигурации-бэкенда**:
   - **Local**: генератор = reranker = query-rewriter = одна модель `qwen2.5:3b-instruct` на Ollama.
   - **Cloud**: генератор = `gpt-5-nano` через OpenAI-совместимый endpoint; reranker и query-rewriter остаются локальными, как в дне 23 (чтобы диффом было только одно звено — генератор).
3. Каждую пару (вопрос × режим × бэкенд) гоняю **N=3 раза подряд** с `temperature=0.2`, чтобы собрать std (стабильность).
4. Каждый ответ оцениваю **двумя судьями**: cloud-judge (`gpt-5-nano`) + local-judge (`qwen2.5:3b-instruct`), считаю их согласие/корреляцию.
5. Собираю отчёт `scripts/day28/report.md` с executive summary, главной таблицей мод × бэкенд, per-question breakdown, секцией про стабильность, dual-judge agreement, 2–3 полными ответами side-by-side и секцией «что удивило».

Итого за прогон: 300 генераций (10 × 5 × 2 × 3) + 600 judge-звонков (по 2 на каждый ответ, dual). Оценочная длительность — ~90 минут, стоимость cloud — ~$0.05–0.10.

**Где живёт код**:

- Entry-point `scripts/day28/run-eval.ts` — только сборка зависимостей и orchestration.
- Переиспользуемый сервис `DualBackendEvalService` (доменный слой) — прогоняет матрицу, независим от конкретного LLM или провайдера.
- Сервис `DualJudgeService` — обёртка над двумя `RagJudgeService` для параллельного судейства.
- Чистые агрегации (`computeLatencyStats`, `computeJudgeAgreement`) — статистика по прогонам.
- Рендерер `rag-dual-backend-report.ts` — pure function `(result, options) → markdown`.

Существующий `src/rag-pipeline-eval.ts` **не трогается**: день 23 должен продолжать работать ровно так же. Никаких флагов, никакого backward-compat — это новый эксперимент с новой точкой входа.

Индекс переиспользуем (`data/history.db` уже содержит 118 structural + 85 fixed chunks). Strategy = `structural`, как в дне 23.

Deliverable — это именно **отчёт** (вариант A из grill-me): без REPL, без интеграции в Telegram-бот дня 27, без нового UI. Всё это отдельные future-days, не мешаем их с измерениями.

## User Stories

1. Как автор challenge'а, я хочу запустить один скрипт `bun scripts/day28/run-eval.ts` и получить на выходе готовый markdown-отчёт в `scripts/day28/report.md`, чтобы за один вечер закрыть задание дня 28 без ручной сборки данных.

2. Как автор challenge'а, я хочу, чтобы скрипт НЕ требовал никаких внешних сервисов кроме уже запущенной Ollama на `localhost:11434` и уже работающего cloud-endpoint'а (того же, что использует `rag-pipeline-eval.ts`), чтобы не тратить время на инфраструктурную настройку.

3. Как автор challenge'а, я хочу, чтобы cloud-endpoint и cloud-модель настраивались теми же env-переменными, что и в текущих eval-скриптах (`OPENAI_API_KEY`, `OPENAI_BASE_URL`), а local-endpoint/модель задавались отдельными переменными (например, `DAY28_LOCAL_BASE_URL`, `DAY28_LOCAL_MODEL`), чтобы можно было менять обе стороны сравнения без правки кода.

4. Как автор challenge'а, я хочу, чтобы скрипт fail-fast'ом проверял при старте: (а) что Ollama отвечает по `/api/tags` и нужная локальная модель загружена, (б) что cloud-endpoint отвечает на короткий ping, (в) что индекс непустой для выбранной strategy, — чтобы не узнавать о недоступности сервиса после 30 минут прогона.

5. Как автор challenge'а, я хочу видеть в консоли live-progress (какая пара `(question, mode, backend, run)` сейчас прогоняется и сколько осталось) со spinner'ом, как в `rag-pipeline-eval.ts`, чтобы я не думал, что скрипт завис.

6. Как автор challenge'а, я хочу, чтобы ошибка одного запроса (timeout, 500, connection error) **НЕ валила весь прогон**, а фиксировалась в результатах и была видна в отчёте как отдельная метрика `error_count`, чтобы одна флаки-ошибка не ломала 90-минутную работу.

7. Как читатель отчёта, я хочу увидеть executive summary в 3–5 строк на самом верху (средний judge local vs cloud, средняя latency, error rate, одно-предложение-вердикт), чтобы за 15 секунд понять, прошла ли локалка сравнение.

8. Как читатель отчёта, я хочу главную таблицу, где на одной картинке видно 5 режимов × 2 бэкенда, и по каждой ячейке: judge (от cloud-judge), judge (от local-judge), p50 latency, p95 latency, std judge, std latency, error count — чтобы увидеть все измерения за один взгляд.

9. Как читатель отчёта, я хочу per-question breakdown (10 вопросов × обе колонки judge), чтобы понять, на каких конкретных вопросах local отстаёт от cloud.

10. Как читатель отчёта, я хочу секцию про стабильность: топ-3 самых нестабильных `(вопрос, мод, бэкенд)` тройки по std judge и по std latency, плюс список sequential latency по всем 40 local-генерациям подряд — чтобы отловить VRAM-деградацию Ollama.

11. Как читатель отчёта, я хочу dual-judge agreement: таблицу «совпало / разошлись на ±1 / разошлись на ≥2» и коэффициент корреляции Pearson между cloud-judge и local-judge — чтобы оценить, насколько доверять абсолютным judge-цифрам.

12. Как читатель отчёта, я хочу для 2–3 самых интересных вопросов (например, самый большой gap local vs cloud и один, где local не уступил) увидеть **полные ответы** обеих сторон и обоих judge-вердиктов side-by-side — чтобы глазами оценить, за что именно judge ругает/хвалит.

13. Как читатель отчёта, я хочу финальную секцию «Что удивило / где local уступил / где не уступил» в стиле day27/day25/day26 — свободный текст, писанный по факту прогона, чтобы было содержание дня, а не только цифры.

14. Как будущий контрибьютор, я хочу, чтобы `scripts/day28/run-eval.ts` был тонкой wiring-прослойкой без бизнес-логики, а всё содержательное сидело в доменных сервисах (`DualBackendEvalService`, `DualJudgeService`, `rag-dual-backend-report`), чтобы все эти куски можно было тестировать изолированно.

15. Как будущий контрибьютор, я хочу, чтобы рендерер отчёта был **чистой функцией** `(aggregated, options) → string` без I/O, чтобы писать snapshot-тесты на структуру markdown.

16. Как автор challenge'а, я хочу, чтобы `DualBackendEvalService` принимал список бэкендов параметрически (имя + уже-сконструированный `LLMClient` + model id), чтобы в будущем подключить третий бэкенд (например, claude-haiku) стоило одной строки в wiring'е, без правки сервиса.

17. Как автор challenge'а, я хочу, чтобы генерация ответа и оценка (judge) были разными фазами прогона: сначала полностью собираются все 300 ответов, потом полностью — все 600 judge-оценок. Это даёт чистые метрики latency (без шума от judge-звонков) и позволяет перезапустить judge отдельно, если что-то в нём захотим переделать.

18. Как автор challenge'а, я хочу, чтобы в главной таблице и per-question breakdown latency считалась **только по успешным прогонам**, а ошибочные учитывались отдельно в колонке `errors` — чтобы одна флаки-ошибка не портила p95.

19. Как автор challenge'а, я хочу заранее знать фиксированный порядок обхода матрицы: `for question in questions: for mode in modes: for backend in backends: for run in 1..N`. Это делает sequential-latency-таблицу осмысленной (понятно, в каком порядке Ollama загружала/выгружала модели) и повторяемой.

20. Как автор challenge'а, я хочу пинать Ollama warmup-запросом один раз перед началом матрицы (короткий дешёвый prompt к той же локальной модели), чтобы первый настоящий прогон не имел cold-start-выброса по latency.

21. Как автор challenge'а, я хочу, чтобы cloud-judge и local-judge имели **одинаковый** judge-prompt и шкалу 0..3 (как в существующем `RagJudgeService`), отличались только моделью — чтобы их scores были сопоставимы.

22. Как автор challenge'а, я хочу, чтобы при старте скрипт писал в консоль итоговую таблицу конфигурации (модель local, модель cloud, base URL'ы, temperature, N, strategy, количество вопросов, количество режимов, ожидаемое число запросов), чтобы по скролл-бару консоли было видно, что именно меряли.

23. Как автор challenge'а, я хочу, чтобы `.env.example` был обновлён с новыми переменными (`DAY28_LOCAL_BASE_URL`, `DAY28_LOCAL_MODEL`, `DAY28_CLOUD_MODEL`, `DAY28_RUNS`, `DAY28_TEMPERATURE`) с разумными дефолтами, чтобы кто-то (в том числе я через полгода) смог воспроизвести эксперимент.

## Implementation Decisions

### Модули и их границы

**`DualBackendEvalService` — deep-модуль (новый, доменный слой).**

Единственная ответственность: прогнать матрицу `(question × mode × backend × run)` и вернуть плоскую структуру результатов без judge'ей. Инкапсулирует всю логику прогона, retry (нет — fail-per-run, но не fail-whole), захвата latency, перехвата и классификации ошибок.

Контракт:
- Вход: список вопросов; список режимов (`RagMode[]`, уже собранных извне с нужными reranker/rewriter); список бэкендов (каждый — `{name, llmClient, modelId, systemPrompt?}`); общие параметры (`temperature`, `runs`).
- Выход: плоский массив `AnswerRun[]` с полями `{questionId, modeName, backendName, runIndex, latencyMs, answer, error?: string, usage?: {inputTokens, outputTokens}, retrievalSummary: PipelineRetrieveResult}`.
- Порядок обхода — детерминированный: `for question: for mode: for backend: for run`. Sequential-latency извлекается из этого массива как подряд идущие `latencyMs` в пределах одного бэкенда.
- Внутри для каждого (mode, backend) создаёт `RagPipelineService(embedder, vectorIndex, mode)`. Embedder и vectorIndex — общие (переиспользуем один экземпляр).
- Ошибка одного run'а фиксируется в `error` и **не прерывает** дальнейший обход. Latency в этом случае — прошедшее до падения.
- Не делает никакой статистики и никакого рендеринга.

**`DualJudgeService` — deep-модуль (новый, доменный слой).**

Единственная ответственность: для каждого `AnswerRun` получить пару `{cloudJudge: JudgeScore, localJudge: JudgeScore}`.

Контракт:
- Вход: список `AnswerRun`; два уже-сконструированных `RagJudgeService` (cloudJudge, localJudge).
- Выход: массив `JudgedAnswerRun = AnswerRun & {cloudJudge, localJudge, cloudJudgeError?, localJudgeError?}`.
- Пропускает run'ы с `error` (судьи получают «ответ: (failed)»).
- Ошибка одного судьи по одному ответу не прерывает обход, фиксируется отдельным полем.
- Внутри переиспользует существующий `RagJudgeService` (его не трогаем). Если понадобится кастомизация prompt'а для local-judge — это делается на уровне wiring'а (инъекция другого `llmClient` и `modelRepo`), а не внутри этого сервиса.

**Агрегации — чистые функции (новый модуль `rag-dual-backend-stats.ts`).**

- `computeLatencyStats(values: number[]): {count, mean, p50, p95, std, min, max}` — классическая статистика по массиву чисел. Пустой массив → всё `null` или `0` в зависимости от поля.
- `computeJudgeAgreement(pairs: Array<[number, number]>): {exact, within1, off2plus, pearson}` — агрегация dual-judge: сколько раз scores совпали, сколько разошлись на 1, сколько на ≥2, Pearson r. Нулевой знаменатель → `pearson = null`.
- `aggregateByModeBackend(runs: JudgedAnswerRun[]): Map<(mode, backend), AggregatedCell>` — собирает главную таблицу.
- `findTopUnstable(runs, topN): UnstableRow[]` — топ-N нестабильных троек по std judge/latency.

Все функции — pure, без I/O, без LLM-клиентов.

**`renderDualBackendReport` — чистая функция (новый рендерер).**

Контракт:
- Вход: агрегированные результаты (JudgedAnswerRun[] + заранее посчитанные таблицы) + options (`{generatedAt, strategy, config}`).
- Выход: markdown как `string`.
- Без I/O. Файл пишет entry-point.

**`scripts/day28/run-eval.ts` — thin glue.**

Всё, что делает:
1. Парсит CLI-флаги и env, валидирует (fail-fast).
2. Инициирует DB, читает `IndexingConfig`, строит `OllamaEmbedder`, `SqliteVectorIndex`.
3. Конструирует два `OpenAILLMClient` (local + cloud) с разными `baseURL`/`apiKey`.
4. Ping'ует оба, fail-fast на любой недоступности; ping'ует наличие `DAY28_LOCAL_MODEL` через `/api/tags` Ollama.
5. Делает warmup-запрос к local-модели.
6. Проверяет, что индекс непустой для выбранной strategy.
7. Собирает `RagMode[]` — те же 5 режимов, что в дне 23, но reranker и rewriter сидят на **local**-клиенте у обеих конфигураций (это часть «всё кроме генератора — локально»).
8. Собирает список бэкендов: `[{name: "local", llmClient: localClient, modelId: localModelId}, {name: "cloud", llmClient: cloudClient, modelId: cloudModelId}]`.
9. Конструирует два `RagJudgeService`: cloud-judge (c cloud-клиентом и ролью `judge`) и local-judge (c local-клиентом и явным модел-ид'ом).
10. Печатает конфигурационную сводку в консоль.
11. Вызывает `DualBackendEvalService.run()` → получает `AnswerRun[]`.
12. Вызывает `DualJudgeService.judgeAll()` → получает `JudgedAnswerRun[]`.
13. Считает агрегации.
14. Рендерит markdown → пишет в `scripts/day28/report.md`.
15. Печатает финальное summary.

Без бизнес-логики. Если что-то кажется похожим на бизнес-логику — значит оно должно быть в сервисе.

**НЕ модифицируется:**
- `src/domain/services/rag-pipeline-service.ts`.
- `src/domain/services/rag-service.ts`.
- `src/domain/services/rag-judge-service.ts` (переиспользуем как есть).
- `src/domain/services/llm-reranker-service.ts`, `query-rewrite-service.ts`.
- `src/api/openai/llm-client.ts`.
- `src/api/ollama/ollama-embedder.ts`.
- `src/storage/sqlite/sqlite-vector-index.ts`.
- `src/rag-pipeline-eval.ts` (день 23 должен продолжать работать).
- Существующие доменные модели, `IndexingConfig`, `ChatService` и прочее.

### Переменные окружения

Новые:
- `DAY28_LOCAL_BASE_URL` (дефолт `http://localhost:11434/v1`).
- `DAY28_LOCAL_MODEL` (дефолт `qwen2.5:3b-instruct`).
- `DAY28_CLOUD_MODEL` (дефолт: брать из `modelRepo.getRole("chat")` или `gpt-5-nano`).
- `DAY28_RUNS` (дефолт `3`).
- `DAY28_TEMPERATURE` (дефолт `0.2`).
- `DAY28_STRATEGY` (дефолт `structural`).

Переиспользуем существующие:
- `OPENAI_API_KEY`, `OPENAI_BASE_URL` (cloud-сторона — как сейчас в `rag-pipeline-eval.ts`).
- `HISTORY_DB`.

### Формат отчёта

Семь секций, как зафиксировано в grill-me:

1. **Executive summary** — 3–5 строк текста, никаких таблиц. «Local 3B дотянул до cloud-nano на X% (avg judge A vs B), в Y вопросах проиграл, latency p50 local NNs vs cloud MMs, error rate L% vs C%».
2. **Главная таблица**: строки = 5 режимов, колонки = `backend`, `cloud-judge avg`, `local-judge avg`, `p50 latency ms`, `p95 latency ms`, `std judge`, `std latency`, `errors`. 10 строк (5 режимов × 2 бэкенда).
3. **Per-question breakdown**: 10 строк, колонки = `qid`, `cloud-judge (local backend, best mode)`, `cloud-judge (cloud backend, best mode)`, `diff`, флаг «local проиграл ≥1 балл».
4. **Stability**: (а) топ-3 самых нестабильных `(mode, backend, question)` по std judge; (б) топ-3 по std latency; (в) для local-бэкенда — sequential latency по 40 ответам подряд в порядке обхода (режим × run, чтобы было видно, как Ollama перегревается или наоборот прогревается).
5. **Dual-judge agreement**: {exact, within1, off2plus}, Pearson r, разбивка по бэкенду (возможно cloud-judge и local-judge больше согласны между собой по cloud-ответам, чем по local — это интересный сигнал).
6. **Примеры ответов**: 2–3 самых интересных вопроса — полный текст local-ответа, полный текст cloud-ответа, вердикты обоих судей. Выбор «интересности» — эвристика на этапе рендеринга: один с максимальным gap local vs cloud, один где local не уступил, один где оба судьи разошлись (необязательно, если не найдётся).
7. **Что удивило / где local уступил / где не уступил** — свободный текст, пишется уже мной по факту прогона, НЕ рендерится автоматически. В первом рендере остаётся пустой stub-секцией-шаблоном.

### Поведение при ошибках

- Fail-fast на старте: Ollama down, local-модель не скачана, cloud-endpoint не отвечает, индекс пустой, env кривой, `DAY28_TEMPERATURE` вне `[0, 2]`, `DAY28_RUNS < 1`.
- Fail-per-run во время матрицы: любая ошибка одного LLM-запроса фиксируется в `AnswerRun.error` как строка классификатора (`timeout` / `connection` / `http-4xx` / `http-5xx` / `other`), прогон продолжается.
- Fail-per-judge: ошибка одного из двух судей по конкретному ответу фиксируется в `cloudJudgeError` / `localJudgeError`, второй судья всё равно выносится. Если упали оба — ответ в агрегациях учитывается только по счётчику ошибок.

### Прогон, временные рамки, стоимость

- 300 генераций + 600 judge-звонков.
- Оценка: local generation ~20–30 мин, cloud generation ~5–10 мин, cloud judge ~10 мин, local judge ~30 мин. Итого ~60–90 мин wall-clock.
- Cloud-стоимость: ~$0.05–0.10 за полный прогон.
- Фиксируем factual наблюдения прогона в отчёте (финальная секция 7).

## Testing Decisions

Ключевая установка: **тестируем только внешнее поведение**, не детали реализации. Red-Green. Никаких тестов на wiring-скрипт (он — thin glue).

**`DualBackendEvalService` — unit-тесты (обязательно).**

Через моки `LLMClient` (возвращает фиксированный текст, или кидает ошибку, или задерживает N миллисекунд), моки `VectorIndex` и моки `Embedder` (из существующих подходов в `rag-pipeline-service.test.ts`).

Сценарии:
- Happy-path: 2 вопроса × 2 режима × 2 бэкенда × 2 run = 16 записей на выходе, все с `error === undefined`, latency > 0, answer — ожидаемая строка.
- Fail-per-run: один мокнутый клиент кидает на третьем вызове → все остальные записи корректные, у этой одной `error` заполнен, латency всё равно есть (время до падения).
- Порядок обхода: смотрим, что порядок `runs` — `question → mode → backend → run` (смотрим по `runIndex` и порядку в массиве).
- Затычка на пустой индекс: не наш уровень (это pipeline service делает), но проверим, что mode со `status: no_index` корректно прокидывается в результат без падения.
- Параметры прокидываются: `temperature`, `maxCompletionTokens` действительно попадают в `LLMRequest` (через мок, захватывающий request).

Прототип теста — `src/domain/services/rag-pipeline-service.test.ts` + `rag-evaluation-service.test.ts`.

**`DualJudgeService` — unit-тесты (обязательно).**

Моки `RagJudgeService` (возвращает `JudgeScore` или кидает).

Сценарии:
- Happy-path: 3 ответа → 3 `JudgedAnswerRun` с обеими оценками.
- Ошибка одного судьи: cloud-judge кинул, local-judge отработал → `cloudJudgeError` заполнен, `localJudge` корректный.
- Ответ с `error !== undefined` на входе: оба судьи вызываются с placeholder-ответом типа `(failed)` — чтобы в отчёте была пометка «оба судьи сказали 0/3, потому что ответа нет» (альтернатива: скипаем судейство для failed-ответов; обе стратегии тестируются).

Прототип — `src/domain/services/rag-judge-service.test.ts`.

**Агрегации (`rag-dual-backend-stats.ts`) — unit-тесты (обязательно).**

Чистые функции, табличное тестирование.

`computeLatencyStats`:
- Пустой массив → `count=0`, `mean=null` (или согласованный дефолт).
- Один элемент → `mean = p50 = p95 = value`, `std = 0`.
- Три элемента `[100, 200, 300]` → `mean = 200`, `p50 = 200`, `std` проверяется по формуле.
- Десять элементов с известным ответом (золотой файл или вручную посчитанное).

`computeJudgeAgreement`:
- Все пары равны → `exact = N`, остальное `0`, `pearson = 1` или `null` (если std = 0).
- Все пары разнятся на 1 → `within1 = N`, `exact = 0`.
- Смешанный кейс — сверка вручную.

Прототип — любой `*-scorer.test.ts`.

**Рендерер `renderDualBackendReport` — snapshot-тест (обязательно, хотя бы один).**

Один больший golden-тест: подать зафиксированный `JudgedAnswerRun[]` (можно inline-объект в тесте) + options, сравнить с эталонным markdown (inline-строкой в тесте). Если захочется — отдельный `.md.golden` файл рядом.

Цель — не проверить каждое слово, а сверить, что:
- секции 1–6 присутствуют в правильном порядке;
- ключевые числа рендерятся в правильном формате;
- нет падений на граничных кейсах (все ошибки, все успехи, одинаковые judge-score).

Sanity-тесты на edge-cases:
- Все run'ы упали → отчёт рендерится, латентности `—`, error count = total.
- Один бэкенд полностью упал → рендерится без NaN/undefined.
- Пустой список — должно бросать fail-fast на уровне entry-point'а, но чтобы рендерер тоже не разорвало на пустом входе.

**Что НЕ тестируем:**
- `scripts/day28/run-eval.ts` — thin glue, моки там стоили бы больше, чем вся логика.
- Реальные походы в Ollama и OpenAI. E2E-валидация = ручной прогон. Факт прогона фиксируется в отчёте (секция 7).
- `RagPipelineService`, `RagJudgeService`, `OpenAILLMClient` — уже покрыты своими тестами, не трогаем.

**Методика**: Red-Green. Для каждого нового модуля: сначала тест, проверяем `bun test` → red, пишем минимум, чтобы стало green, рефакторим.

После каждой фазы `bun test` должен быть зелёным целиком (не только новые тесты, все 700+).

## Out of Scope

- **Интеграция RAG в Telegram-бот дня 27.** Бот остаётся обычным чат-ботом на `llama3.2:3b`, без retrieval. Добавление команды `/rag <q>` — отдельный будущий день (кандидат на day 29+).
- **REPL/CLI для интерактивного RAG-чата.** Никаких `bun run rag-chat`. Только батч-прогон → отчёт.
- **Streaming.** Все генерации — non-streaming. Для измерений latency это нормально (меряем полное время ответа), streaming добавил бы сложность без выгоды.
- **Новые modes.** Никаких `rag-cited` или других режимов. Ровно те 5, что в дне 23 (baseline + 4 режима), но без `useCitations` — как в дне 23.
- **Новые вопросы.** Те же 10 из `scripts/day22/control-questions.json`, никаких новых. Если они слабые — это тема другого дня.
- **Новый корпус.** Индекс тот же (system-design-primer). Тест на другом корпусе — отдельный день.
- **Новый embedder.** `nomic-embed-text` 768d, как в неделе 6.
- **Альтернативные локальные модели.** `llama3.2:3b`, `qwen2.5:7b`, `saiga` и прочее — вне scope, только `qwen2.5:3b-instruct`. Сравнение моделей между собой — другой эксперимент.
- **Dockerfile / VPS deployment.** Отдельная тема, не блокирует день 28.
- **Переход судей на более сильные модели** (gpt-5-mini, claude-haiku). Судьи — те же, что и бэкенды: cloud = `gpt-5-nano`, local = `qwen2.5:3b-instruct`.
- **Переиспользование кэша ответов.** Никакого кэширования: если скрипт упал на 250-м запросе, перезапуск начинает с нуля. Добавление resume — оверкилл для одного дня.
- **Параллельный запуск** (concurrent LLM calls). Строго последовательно, чтобы sequential-latency имел смысл и чтобы Ollama не ложилась от параллельного давления на 4GB VRAM.
- **Сравнение с день-23 отчётом.** Не дублируем таблицы из `scripts/day23/report.md`. День 28 — самодостаточный отчёт.

## Further Notes

### Связь с day27 выборами моделей

В дне 27 бот стоит на `llama3.2:3b`. В дне 28 берём `qwen2.5:3b-instruct` — это сознательное отличие. Причины: RAG-prompt'ы на английском (в дне 22 questions все EN), qwen2.5 заметно сильнее на EN-instruction-following при том же размере, чем llama3.2. Бот (где важна русская морфология для бытового чата) и RAG-eval (где важна точность на EN technical QA) — разные задачи, резонно иметь разные модели. В отчёте это стоит отметить одной строкой.

### Почему reranker и rewriter у обеих конфигураций — локальные

В дне 23 reranker и query-rewriter уже сидят на Ollama (`qwen2.5-coder:3b`). Если бы в cloud-бэкенде я поставил их на cloud — получился бы «cloud на всю трубу vs local на всю трубу», и я бы не смог изолировать эффект замены **только генератора**. Оставляя их локальными у обеих сторон, я меряю ровно то, что обещает день 28: «вот мы заменили последнее cloud-звено на local; что изменилось?». В отчёте это упомянуть в executive summary.

### Почему judge-prompt не трогаем

`RagJudgeService` использует фиксированный `JUDGE_INSTRUCTIONS` и JSON-формат ответа `{score, verdict}`. Переиспользуем as-is: один и тот же prompt, разные модели. Именно так и получается честный dual-judge. Если в будущем захочется специализированный prompt для локального судьи (например, более простой, потому что 3B модель хуже следует сложным инструкциям) — это отдельная задача с отдельной валидацией.

### Bias cloud-judge'а

Отчёт должен открыто сказать, что cloud-judge (`gpt-5-nano`) может системно предпочитать ответы от cloud-backend'а (тоже `gpt-5-nano`). Dual-judge — это именно способ измерить этот bias: если cloud-judge и local-judge сильно согласны, bias мал; если сильно расходятся — есть о чём задуматься.

### Дальнейшие шаги после дня 28

- Если local 3B проиграл существенно — попробовать 7B с offload в RAM (ожидаемо медленно, но посмотреть, дотягивает ли качество).
- Если качество сравнимо — интегрировать RAG в Telegram-бот дня 27 (`/rag <q>`) в следующем дне.
- Если качество сильно проседает на конкретных вопросах — посмотреть, не проблема ли это retrieval'а, а не генерации (тот же retrieval для обеих сторон — если cloud отвечает хорошо, значит context достаточный, проблема в генераторе; если оба плохо — проблема в retrieval'е).

### Факт прогона

Финальная секция отчёта (7) пишется вручную после прогона. В ней не только цифры — там факты: «Ollama прогрелась за 4 секунды на первом вопросе», «на 130-м запросе latency подскочила в 2 раза, Ollama похоже делала swap», «local-judge систематически занижает оценку на вопросах с длинным retrieval-контекстом», «один connection error произошёл на таком-то вопросе, похоже что...». Это ценная часть дня — не забыть её написать после запуска.

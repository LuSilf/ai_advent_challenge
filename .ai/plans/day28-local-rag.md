# Plan: Day 28 — Полностью локальная RAG-система и её сравнение с cloud

> Source PRD: [.ai/prd/day28-local-rag.md](../prd/day28-local-rag.md)

## Architectural decisions

Durable решения, общие для всех фаз:

- **Ветка**: `day28-local-rag` (уже создана, все фазы идут в ней).
- **Deliverable дня**: артефакт `scripts/day28/report.md`, сгенерированный `scripts/day28/run-eval.ts`.
- **Что трогаем / не трогаем**:
  - НЕ модифицируем: `RagPipelineService`, `RagService`, `RagJudgeService`, `OpenAILLMClient`, `OllamaEmbedder`, `SqliteVectorIndex`, `IndexingConfig`, `rag-pipeline-eval.ts` (день 23 должен продолжать работать as-is), `ChatService`, `modelRepo` и прочий существующий RAG-код.
  - Добавляем новые файлы: `scripts/day28/run-eval.ts`, `src/domain/services/dual-backend-eval-service.ts`, `src/domain/services/dual-judge-service.ts`, `src/domain/services/rag-dual-backend-stats.ts`, `src/domain/services/rag-dual-backend-report.ts` и их тесты.
- **Индекс**: переиспользуем `data/history.db` с уже проиндексированным system-design-primer (118 structural + 85 fixed chunks). Strategy = `structural` (как в день 23). Новой индексации не делаем.
- **Корпус вопросов**: `scripts/day22/control-questions.json` (10 вопросов, английский, system design). Не меняем, не расширяем.
- **Матрица прогона**: 10 вопросов × 5 режимов (baseline + plain + threshold + reranker + full) × 2 backend'а (local + cloud) × N=3 runs = **300 генераций** + **600 judge-звонков** (dual). Порядок обхода детерминированный: `for question: for mode: for backend: for run`.
- **Локальный endpoint**: Ollama на `http://localhost:11434/v1` (OpenAI-compatible).
- **Локальная модель**: `qwen2.5:3b-instruct` — одна и та же для generator, reranker, query-rewriter и local-judge. Причина: экономия VRAM (4 GB), минимизация переменных в сравнении.
- **Cloud endpoint**: тот же, что использует `rag-pipeline-eval.ts` сейчас (через `OPENAI_API_KEY` / `OPENAI_BASE_URL` из env).
- **Cloud модель**: `gpt-5-nano` (та же, что primary cloud judge).
- **Temperature**: 0.2 для всех генераций и всех судей.
- **Reranker / query-rewriter у обеих сторон — локальные**. Это осознанный выбор: мы изолируем эффект замены **только генератора**, поэтому retrieval-обвес у local и cloud конфигураций идентичен и сидит на Ollama.
- **Judge**: primary = cloud `gpt-5-nano`, secondary = local `qwen2.5:3b-instruct`. Один и тот же `JUDGE_INSTRUCTIONS` и JSON-shape `{score, verdict}` из существующего `RagJudgeService`. Меняется только LLMClient и модель.
- **Разделение фаз прогона**: сначала полностью собираются все 300 ответов (`DualBackendEvalService`), потом полностью 600 judge-оценок (`DualJudgeService`). Это даёт чистые latency-метрики без шума от judge-звонков и возможность перезапуска judge-фазы отдельно при необходимости.
- **Обработка ошибок**:
  - Fail-fast на старте: Ollama down, local-модель не скачана, cloud-endpoint не отвечает, индекс пустой, env кривой.
  - Fail-per-run внутри матрицы: ошибка одного запроса фиксируется как строка-классификатор (`timeout` / `connection` / `http-4xx` / `http-5xx` / `other`) и **не прерывает** обход.
  - Fail-per-judge: ошибка одного судьи по одному ответу фиксируется, второй всё равно выносится.
- **Latency учёт**: в агрегатах и отчёте считается **только по успешным прогонам**. Ошибки — отдельная колонка.
- **Без параллелизма**: все LLM-звонки строго последовательны (нужно для sequential-latency и чтобы не перегружать Ollama на 4 GB VRAM).
- **Без кэширования**: падение в середине прогона = перезапуск с нуля. Resume не реализуем.
- **Без streaming**: все генерации non-streaming.
- **Citations mode**: не включаем (`useCitations: false` во всех режимах, как в день 23).
- **Env contract**:
  - Новые: `DAY28_LOCAL_BASE_URL` (дефолт `http://localhost:11434/v1`), `DAY28_LOCAL_MODEL` (дефолт `qwen2.5:3b-instruct`), `DAY28_CLOUD_MODEL` (дефолт берётся из `modelRepo.getRole("chat")` или `gpt-5-nano`), `DAY28_RUNS` (дефолт `3`), `DAY28_TEMPERATURE` (дефолт `0.2`), `DAY28_STRATEGY` (дефолт `structural`).
  - Переиспользуются: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `HISTORY_DB`.
- **Deep-модули (тестируются)**: `DualBackendEvalService`, `DualJudgeService`, `computeLatencyStats`, `computeJudgeAgreement`, `aggregateByModeBackend`, `findTopUnstable`, `renderDualBackendReport`.
- **Glue (не тестируется)**: `scripts/day28/run-eval.ts` (инстанциация, ping'и, orchestration фаз, запись файла).
- **Методика**: Red-Green TDD. Сначала тест → `bun test` → red → минимальная реализация → green → (опционально) рефактор.
- **Приёмка каждой фазы**: `bun test` зелёный целиком (не только новые тесты, все 700+), `git status` чист перед переходом, хирургический diff по фазе.
- **npm-скрипт** (опциональный): `"day28:eval": "bun run scripts/day28/run-eval.ts"` в `package.json` — если удобно, но можно и без него.

---

## Phase 1: Tracer bullet — `DualBackendEvalService` на моках

**User stories**: 14, 16, 17, 19

### What to build

Минимальный сквозной срез через вертикаль eval-сервиса. Доказываем, что каркас `DualBackendEvalService` собирается и корректно проходит матрицу на моках — без entry-point'а, без реальной Ollama, без cloud, без judge, без рендера.

В этой фазе:

- Появляется доменный сервис `DualBackendEvalService` с API:
  - Вход: список вопросов, список `RagMode[]`, список бэкендов (каждый — объект с именем, уже-сконструированным `LLMClient`, model id и опциональным system-prompt), общие параметры (`runs`, `temperature`).
  - Выход: плоский массив `AnswerRun[]` с полями `{questionId, modeName, backendName, runIndex, latencyMs, answer, error?, usage?, retrievalSummary}`.
  - Внутри: для каждой пары `(mode, backend)` создаёт `RagPipelineService` с общим `embedder` и `vectorIndex`. Порядок обхода `question → mode → backend → run`. Ошибка одного run'а не прерывает обход, фиксируется в `error` как строка-классификатор.
  - Пробрасывает `temperature` и системный промпт в `LLMRequest` через существующий `LLMClient` интерфейс.
- Появляются unit-тесты, покрывающие:
  - **Tracer-bullet end-to-end**: 1 вопрос × 1 режим × 1 бэкенд × 1 run через моки `LLMClient`, `Embedder`, `VectorIndex`. На выходе — ровно 1 запись с корректным `answer`, `latencyMs > 0`, без ошибки.
  - **Матрица** 2 × 2 × 2 × 2 = 16 записей, все с `error === undefined`, правильный порядок обхода (проверяем по последовательности `(question, mode, backend, run)`).
  - **Fail-per-run**: один мокнутый клиент бросает на третьем вызове → остальные записи корректные, у этой одной `error` заполнена классификатором, `latencyMs` — время до падения.
  - **Проброс параметров**: моку LLMClient'а захватываем входящий `LLMRequest`, проверяем, что `temperature` и `maxCompletionTokens` докатились.
  - **Пустой retrieval (`no_index` / `no_hits`)**: сервис не падает, `AnswerRun.retrievalSummary.status` корректно прокидывается.
- Прототип моков — брать из существующих `rag-pipeline-service.test.ts` и `rag-evaluation-service.test.ts`.

Всё идёт только через существующие интерфейсы `LLMClient` / `Embedder` / `VectorIndex` — никаких правок их реализаций.

### Acceptance criteria

- [ ] Файл `src/domain/services/dual-backend-eval-service.ts` создан, экспортирует `DualBackendEvalService` и типы `AnswerRun`, `Backend`.
- [ ] Файл `src/domain/services/dual-backend-eval-service.test.ts` создан, содержит минимум 5 тест-кейсов (tracer-bullet, матрица, fail-per-run, проброс параметров, пустой retrieval).
- [ ] `bun test` зелёный целиком (700+ старых + новые), 0 fail.
- [ ] В тестах проверяется end-to-end сборка через существующий `RagPipelineService` (не подменяем его моком, моки — только на leaf-интерфейсах `LLMClient` / `Embedder` / `VectorIndex`).
- [ ] `git status` чист, фаза закоммичена отдельно.

---

## Phase 2: Реальные бэкенды + entry-point + smoke (reduced matrix)

**User stories**: 2, 3, 4, 5, 6, 20, 22

### What to build

Появляется настоящий entry-point `scripts/day28/run-eval.ts`, собирающий два реальных `OpenAILLMClient`'а (local Ollama + cloud) и прогоняющий **уменьшенную** матрицу через живые сервисы. Цель — доказать, что wiring с реальными зависимостями работает, и поймать все инфраструктурные грабли (env, ping'и, warmup, VRAM) до того, как мы добавим judge и отчёт.

В этой фазе:

- Появляется `scripts/day28/run-eval.ts` как thin glue. Делает:
  1. Парсит CLI-флаги и env, применяет дефолты, fail-fast-валидация.
  2. Инициирует DB (`initDb`), читает `IndexingConfig`, строит `OllamaEmbedder`, `SqliteVectorIndex`.
  3. Конструирует два `OpenAILLMClient`'а — local (Ollama base URL, dummy api key) и cloud (env `OPENAI_BASE_URL`/`OPENAI_API_KEY`).
  4. Fail-fast ping: (а) `GET /api/tags` локальной Ollama и проверка, что `DAY28_LOCAL_MODEL` в списке; (б) короткий ping cloud (тривиальный chat.completions запрос с `max_completion_tokens=1`); (в) `vectorIndex.countByStrategy(strategy) > 0`.
  5. Warmup-запрос к local-модели: короткий prompt («ping»), ответ игнорируется.
  6. Печать конфигурационной сводки в консоль: модели, base URL'ы, strategy, количество вопросов/режимов/runs, ожидаемое число запросов.
  7. Собирает 5 `RagMode`'ов (как в `rag-pipeline-eval.ts`, day23), передавая в reranker и query-rewriter **local-client** у обеих backend-конфигураций.
  8. Вызывает `DualBackendEvalService.run()` → получает `AnswerRun[]`.
  9. Печатает агрегированный сводный текст в консоль (количество success/error, среднее время на запрос).
- CLI-флаги для уменьшенного прогона (для smoke'а и отладки): `--questions N` (ограничить число вопросов сверху), `--modes csv` (список имён режимов через запятую), `--runs N` (override `DAY28_RUNS`). По дефолту — полная матрица.
- Live-progress: spinner / короткие логи per-пара (как в `rag-pipeline-eval.ts`), с counter'ом «X/Y».
- Никакого dual-judge, никаких агрегаций за пределами console summary, никакого `report.md` — всё это в следующих фазах.
- Тесты за phase 1 остаются зелёными.
- В `package.json` можно добавить (опционально) скрипт `"day28:eval": "bun run scripts/day28/run-eval.ts"`.

### Acceptance criteria

- [ ] `scripts/day28/run-eval.ts` создан и запускается.
- [ ] `bun run scripts/day28/run-eval.ts --questions 1 --modes rag-plain --runs 1` с активной Ollama + валидным cloud-endpoint'ом отрабатывает без ошибок и печатает ровно 2 успешных прогона (local + cloud).
- [ ] Без запущенной Ollama скрипт падает fail-fast с понятным сообщением до начала матрицы.
- [ ] С `DAY28_LOCAL_MODEL=doesnotexist:99b` скрипт падает fail-fast на проверке `/api/tags`.
- [ ] Пустой индекс (`strategy=fixed` при отсутствии индексации) → fail-fast с инструкцией индексации.
- [ ] Warmup-запрос наблюдается в логах до начала матрицы.
- [ ] Конфигурационная сводка печатается в консоль при старте (видны обе модели, базы, `temperature`, `runs`, число вопросов).
- [ ] Тесты фазы 1 остаются зелёными; `bun test` зелёный целиком.
- [ ] `git status` чист, фаза закоммичена.

---

## Phase 3: Dual judge

**User stories**: 11, 17, 21

### What to build

Появляется сервис `DualJudgeService` и интегрируется в entry-point как отдельная (вторая) фаза прогона — после того как все `AnswerRun[]` собраны.

В этой фазе:

- Появляется `src/domain/services/dual-judge-service.ts`. API:
  - Конструктор принимает два `RagJudgeService` (cloud + local).
  - Метод `judgeAll(runs: AnswerRun[], questions): Promise<JudgedAnswerRun[]>`, где `JudgedAnswerRun = AnswerRun & {cloudJudge, localJudge, cloudJudgeError?, localJudgeError?}`.
  - Для каждого run'а вызываются оба судьи последовательно. Ошибка одного не валит другого.
  - Run'ы с `error !== undefined` получают от судей placeholder-ответ `(failed)` или судьи пропускаются (конкретное поведение — на выбор при реализации, главное — стабильно и явно задокументировано в тесте).
- Появляются unit-тесты `dual-judge-service.test.ts`:
  - Happy-path: 3 `AnswerRun` → 3 `JudgedAnswerRun` с двумя оценками.
  - Один судья кидает на одном из трёх ответов → поле `*JudgeError` заполнено, второй судья корректный, остальные ответы не затронуты.
  - Оба судьи кидают → оба поля `*JudgeError` заполнены, run выносится с placeholder-score.
  - `AnswerRun` с `error` → согласованное поведение (скип или placeholder), проверено тестом.
  - Проверка, что оба судьи получают один и тот же `JUDGE_INSTRUCTIONS` (через мок LLMClient'а, который захватывает request).
- Entry-point `scripts/day28/run-eval.ts` обогащается:
  - Конструирует два `RagJudgeService`: cloud (с cloud-client'ом, модель = `DAY28_CLOUD_MODEL` или роль `judge` из `modelRepo`) и local (с local-client'ом, модель = `DAY28_LOCAL_MODEL`). Для local-судьи конструируется лёгкий fake-`ModelRepository`, который отдаёт local-модель на роль `judge`, чтобы не дёргать `modelRepo.setRole` и не мутировать DB.
  - После `DualBackendEvalService.run()` вызывает `DualJudgeService.judgeAll()`.
  - Печатает агрегат в консоль: сколько ответов оценено обоими судьями, сколько ошибок у каждого.
- Тесты предыдущих фаз остаются зелёными.

### Acceptance criteria

- [ ] `src/domain/services/dual-judge-service.ts` создан.
- [ ] `src/domain/services/dual-judge-service.test.ts` содержит минимум 4 тест-кейса (happy-path, один судья упал, оба упали, run с ошибкой).
- [ ] Entry-point после основного прогона вызывает dual-judge и печатает его сводку в консоль.
- [ ] Smoke-прогон `--questions 1 --modes rag-plain --runs 1` даёт 2 ответа → 4 judge-оценки (2 × 2).
- [ ] Существующий `RagJudgeService` не модифицирован.
- [ ] `bun test` зелёный целиком.
- [ ] `git status` чист, фаза закоммичена.

---

## Phase 4: Агрегации и статистика

**User stories**: 8, 10, 11, 18

### What to build

Появляется отдельный модуль с чистыми функциями для всех агрегаций, которые понадобятся отчёту. Модуль не знает ни про LLM, ни про I/O — только числа и структуры.

В этой фазе:

- Появляется `src/domain/services/rag-dual-backend-stats.ts` с функциями:
  - `computeLatencyStats(values: number[]): LatencyStats` — `{count, mean, p50, p95, std, min, max}`. Пустой массив → все поля `null` или согласованный дефолт.
  - `computeJudgeAgreement(pairs: Array<[number, number]>): JudgeAgreement` — `{exact, within1, off2plus, pearson}`. Нулевая дисперсия → `pearson = null`.
  - `aggregateByModeBackend(runs: JudgedAnswerRun[]): ModeBackendCell[]` — одна ячейка главной таблицы на каждую пару `(mode, backend)`: средние оба judge, latency-stats (по успешным!), std judge, std latency, errors count.
  - `findTopUnstable(runs, topN): UnstableRow[]` — топ-N самых нестабильных троек `(question, mode, backend)` по std judge и по std latency.
  - (Опционально) `selectSideBySideExamples(runs, n): ExampleRow[]` — эвристика выбора 2–3 интересных вопросов для секции 6 отчёта (max gap local vs cloud; один где local не уступил; опционально один где судьи разошлись).
- Появляются unit-тесты `rag-dual-backend-stats.test.ts` — табличные:
  - `computeLatencyStats`: пустой массив, один элемент, три элемента `[100, 200, 300]` (mean=200, std по формуле), десять элементов с золотым ответом.
  - `computeJudgeAgreement`: все равны (exact=N, pearson=null), все расходятся на 1 (within1=N), смешанный кейс, пустой массив.
  - `aggregateByModeBackend`: синтетический `JudgedAnswerRun[]` с известным количеством run'ов → ровно одна ячейка на пару `(mode, backend)`, latency-stats считаются **только по успешным**, errors считаются отдельно.
  - `findTopUnstable`: контрольный набор с явно выбросной парой → она попадает в топ.
- Entry-point `scripts/day28/run-eval.ts` вызывает агрегации и печатает их **как markdown-table в консоль** (пока без файла). Это промежуточный смоук: цифры глазами видны, рендерер ещё не построен.
- Тесты предыдущих фаз остаются зелёными.

### Acceptance criteria

- [ ] `src/domain/services/rag-dual-backend-stats.ts` создан, содержит все четыре (или пять) функций.
- [ ] `src/domain/services/rag-dual-backend-stats.test.ts` содержит табличные тесты для каждой функции.
- [ ] Entry-point печатает в консоль главную таблицу (mode × backend) и топ-3 нестабильных после dual-judge фазы.
- [ ] `bun test` зелёный целиком.
- [ ] `git status` чист, фаза закоммичена.

---

## Phase 5: Рендерер отчёта (секции 1–6) и запись в файл

**User stories**: 7, 8, 9, 10, 11, 12, 15

### What to build

Появляется чистая функция рендера, которая из `JudgedAnswerRun[]` + агрегаты формирует markdown отчёта `scripts/day28/report.md`. Секция 7 оставляется как stub-placeholder, заполняется вручную в Phase 6.

В этой фазе:

- Появляется `src/domain/services/rag-dual-backend-report.ts` с чистой функцией `renderDualBackendReport(input, options): string`. Без I/O — только строка на выходе.
- Структура отчёта (7 секций из PRD):
  1. **Executive summary** — 3–5 строк текста с ключевыми числами и однострочным вердиктом.
  2. **Главная таблица** (5 режимов × 2 бэкенда = 10 строк): `backend`, `cloud-judge avg`, `local-judge avg`, `p50 latency`, `p95 latency`, `std judge`, `std latency`, `errors`.
  3. **Per-question breakdown** (10 строк): `qid`, `cloud-judge @ local backend (best mode)`, `cloud-judge @ cloud backend (best mode)`, `diff`, флаг «local проиграл ≥1 балл».
  4. **Stability**: топ-3 по std judge, топ-3 по std latency, sequential latency для local-бэкенда (40 значений в порядке обхода с номерами run'а и именем режима/вопроса).
  5. **Dual-judge agreement**: `{exact, within1, off2plus}`, `pearson r`, разбивка по бэкенду.
  6. **Примеры ответов**: 2–3 интересных вопроса, для каждого — полный local-ответ, полный cloud-ответ, вердикты обоих судей.
  7. **Что удивило / где local уступил / где не уступил** — stub-заголовок с пометкой «заполняется вручную после прогона».
- Появляются тесты `rag-dual-backend-report.test.ts`:
  - Один большой snapshot-тест на фиксированном синтетическом `JudgedAnswerRun[]` — сверка со строкой-эталоном (inline в тесте либо в отдельном golden-файле рядом). Цель — проверить порядок секций, заголовки, наличие ключевых таблиц, корректный формат чисел.
  - Edge-cases: все run'ы упали (latency = `—`, error count = total, рендерер не падает); один бэкенд полностью упал (без NaN); все judge-score одинаковые (pearson = null, рендерится как `—`).
- Entry-point `scripts/day28/run-eval.ts` после агрегаций вызывает `renderDualBackendReport` и пишет результат в `scripts/day28/report.md` (путь задаётся флагом `--report` с дефолтом `scripts/day28/report.md`).
- Финальный лог entry-point'а: «Report saved: scripts/day28/report.md».
- Тесты предыдущих фаз остаются зелёными.

### Acceptance criteria

- [ ] `src/domain/services/rag-dual-backend-report.ts` создан, экспортирует `renderDualBackendReport`.
- [ ] `src/domain/services/rag-dual-backend-report.test.ts` содержит snapshot-тест + edge-cases.
- [ ] Entry-point создаёт `scripts/day28/report.md` с 7 секциями (секция 7 — stub с маркером «заполнить вручную»).
- [ ] Smoke `--questions 2 --modes rag-plain,rag-full --runs 2` генерит читаемый отчёт без NaN/undefined в ячейках.
- [ ] Рендерер — чистая функция без I/O.
- [ ] `bun test` зелёный целиком.
- [ ] `git status` чист, фаза закоммичена.

---

## Phase 6: Полный прогон + секция 7 + финальные правки

**User stories**: 1, 13, 23

### What to build

Завершающая фаза: полный прогон 300 генераций + 600 судейств на реальных Ollama и cloud, заполнение секции 7 отчёта по факту, обновление `.env.example`, финальные проверки ветки.

В этой фазе:

- `.env.example` дополняется секцией `# --- Day 28: local RAG ---` со всеми новыми переменными (`DAY28_LOCAL_BASE_URL`, `DAY28_LOCAL_MODEL`, `DAY28_CLOUD_MODEL`, `DAY28_RUNS`, `DAY28_TEMPERATURE`, `DAY28_STRATEGY`) и короткими комментариями + разумными дефолтами.
- (Опционально) добавляется npm-скрипт `"day28:eval": "bun run scripts/day28/run-eval.ts"` в `package.json`.
- Запуск полного прогона: `bun run scripts/day28/run-eval.ts` без флагов → 10 вопросов × 5 режимов × 2 бэкенда × 3 runs + dual-judge (~90 минут). Артефакт — `scripts/day28/report.md`.
- По факту прогона **вручную** дописывается секция 7 отчёта:
  - Фактический time budget (local gen, cloud gen, cloud judge, local judge).
  - Наблюдения по VRAM-давлению Ollama (есть ли деградация latency в sequential-таблице).
  - Где local 3B уступил cloud `gpt-5-nano` (с конкретными вопросами / режимами).
  - Где local не уступил / где выиграл.
  - Dual-judge bias: коэффициент корреляции и интерпретация.
  - Количество и характер реальных ошибок (если были).
  - Что удивило (по духу секций day25/day26/day27).
  - Next steps (кандидаты на day 29+: RAG в Telegram-бот, 7B с offload, новые корпусы и т.д.) — но без работы сегодня.
- Финальные проверки ветки:
  - `bun test` зелёный целиком.
  - `git status` чист.
  - Все фазы зафиксированы отдельными осмысленными коммитами.
  - `bun run start` продолжает работать (регресс cloud-пути).
  - `bun run bot` продолжает работать (регресс бота day27).
  - `bun run scripts/rag-pipeline-eval.ts` (день 23) **не сломан** — запуск с `--questions 1 --modes rag-plain` отрабатывает.

### Acceptance criteria

- [ ] `.env.example` содержит секцию Day 28 с полным env-contract'ом.
- [ ] `scripts/day28/report.md` существует, все 7 секций заполнены (секция 7 — настоящим текстом, а не stub'ом).
- [ ] В секции 7 зафиксированы: реальный time budget, количество ошибок, наблюдения по VRAM, сравнение local vs cloud по факту, dual-judge bias, 1–3 предложения «что удивило», next steps.
- [ ] `bun test` зелёный целиком.
- [ ] `git status` чист; коммиты распределены по фазам.
- [ ] Регресс-проверки: `bun run start` и `bun run bot` работают; `bun run scripts/rag-pipeline-eval.ts --questions 1 --modes rag-plain` отрабатывает без правок его кода.
- [ ] Ветка `day28-local-rag` готова к ff-мерджу в master.

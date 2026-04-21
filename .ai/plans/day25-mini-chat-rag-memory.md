# Plan: Day 25 — Мини-чат с RAG + память задачи

> Source PRD: `.ai/prd/day25-mini-chat-rag-memory.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **Запуск**: отдельный day-25-режим через флаг `--day25` у `main.ts` (или `bun run chat`). Обычный запуск REPL не меняется — сохраняем обратную совместимость со всеми предыдущими днями.
- **Schema**: новая таблица `task_states` (sessionId PK + FK на `sessions`, goal TEXT nullable, constraints/terms/openQuestions/resolvedFacts — JSON-колонки, updatedAt). Добавляется миграцией в существующий `db.ts` / SQLite-init.
- **Key models**:
  - `TaskState` (domain model) — TS-тип + OpenAI JSON schema для structured output reconciliation.
  - `TaskStateRepository` (port) — `get(sessionId)`, `upsert(state)`, `clear(sessionId)`.
  - `TaskStateService` (domain service) — `getState`, `reconcile`, `formatForPrompt`, `formatForDisplay`. Deep module: снаружи — 4 метода, внутри — LLM, JSON schema, merge-правила, persistence.
  - `SqliteTaskStateRepository` — основная реализация; in-memory — только для тестов.
- **Команды REPL**: `/task show`, `/task show --raw`, `/task clear`. По аналогии с уже существующими `/memory`, `/session`, `/rag`.
- **RAG в day-25-режиме**: `RagPipelineService` вызывается автоматически для каждого пользовательского сообщения. Пользователь не обязан делать `/rag on`. `/rag off` работает как аварийный рубильник, но выключать по умолчанию не даём.
- **Reconciliation**: асинхронный вызов после каждого ассистентского ответа, non-blocking, graceful failure (стейт не сбрасывается при ошибке).
- **Сценарии и отчёт**:
  - `scripts/day25/scenarios/*.json` — фиксированные сценарии 12–15 сообщений.
  - `scripts/day25/run-scenarios.ts` — раннер.
  - `scripts/day25/report.md` — автогенерируется.
- **Reuse (не меняем)**: `RagPipelineService`, `CitedRagResponse`, `FaithfulnessJudge`, `SessionService`, `MessageRepository`, `MemoryService`, existing REPL infrastructure (readline, command handler, formatters).

---

## Phase 1: Day-25-режим + инфраструктура task state (без reconcile)

**User stories**: 1, 2, 3, 4, 6, 12, 13, 18, 19, 22, 23

### What to build

Точка входа, которая поднимает REPL в day-25-режиме: RAG всегда активен для каждого пользовательского сообщения, ответ идёт через `CitedRagResponse` с выводом источников. Пользователю не надо делать `/rag on`.

Одновременно заводится инфраструктура task state: модель, таблица в SQLite, репозиторий с двумя реализациями (SQLite + in-memory для тестов), сервис с минимальным API (`getState`, `clear`, `formatForDisplay`; `reconcile` на этой фазе — заглушка/no-op). Команды `/task show`, `/task show --raw`, `/task clear` подключены к REPL.

Reconciliation ещё не работает — стейт всегда пустой или правится только через `/task clear`. Это нормально для tracer bullet: вся вертикаль (CLI → service → repo → БД) собрана и проверена, на следующей фазе в ней появляется содержательная логика.

### Acceptance criteria

- [ ] Запуск `bun run chat` (или `bun run src/main.ts --day25`) открывает REPL в day-25-режиме.
- [ ] Обычный запуск REPL (без флага) работает ровно как раньше — ничего не сломалось в предыдущих днях.
- [ ] В day-25-режиме каждый ответ ассистента содержит блок источников (если RAG нашёл контекст) или явный отказ `insufficient` (если нет).
- [ ] Таблица `task_states` создаётся миграцией при инициализации БД; схема привязана к sessionId c FK.
- [ ] `/task show` в пустой сессии возвращает «task state пустой» (читаемый текст, не сырой JSON).
- [ ] `/task show --raw` возвращает raw JSON (пустой объект или базовую структуру).
- [ ] `/task clear` сбрасывает стейт текущей сессии; последующий `/task show` снова показывает «пусто».
- [ ] `/session new` создаёт свежую сессию с пустым task state (не наследует).
- [ ] Тесты `task-state-repository.test.ts` зелёные: CRUD (get отсутствующего = пустой, upsert перезаписывает, clear удаляет, изоляция по sessionId).
- [ ] Существующий тест-сьют (`bun test`) остался зелёным.

---

## Phase 2: Reconciliation loop + вставка task state в промпт

**User stories**: 5, 7, 8, 9, 14, 15, 16, 17, 20, 21

### What to build

`TaskStateService.reconcile(sessionId, lastUserMessage, lastAssistantMessage)` — LLM-вызов со structured JSON schema, merge по правилам: не стираем ранее зафиксированные constraints/terms/resolvedFacts без явной инверсии пользователем, `openQuestions` двусторонний, `goal` фиксируется при первой явной формулировке, потом обновляется только при явной смене темы.

Хук в REPL: после каждого ассистентского ответа запускается `reconcile` (не блокирует следующий ввод). Короткий индикатор в stderr («task state обновлён» / ошибка). При падении LLM / таймауте / невалидном JSON — старое состояние сохраняется, ошибка логируется, диалог продолжается.

`formatForPrompt(state)` — компактное текстовое представление: цель одной строкой, ограничения списком, термины парами ключ-значение, открытые вопросы коротко. Вставляется отдельным system-блоком перед блоком памяти и перед историей. На пустом стейте блок не добавляется (не засоряем промпт).

Cost токенов reconciliation включается в общий `CostAccumulator`.

### Acceptance criteria

- [ ] В диалоге из 3–4 сообщений `/task show` после второго обмена показывает заполненную цель.
- [ ] Зафиксированное пользователем ограничение («только open source») сохраняется в `taskState.constraints[]` после следующего не-связанного обмена.
- [ ] Добавленный и потом закрытый пользователем open question исчезает из `openQuestions[]`.
- [ ] LLM-ошибка (мок возвращает невалидный JSON) не роняет REPL, старое состояние сохраняется, в stderr видна ошибка.
- [ ] Блок task state появляется в системном промпте только когда стейт непустой; на пустом стейте промпт не меняется.
- [ ] Токены reconciliation учтены в `CostAccumulator` (проверяется в unit-тесте).
- [ ] Тест `task-state-service.test.ts` покрывает: пустой стейт, фиксацию цели, retention constraint через неревелантный обмен, life-cycle open question, graceful failure, идемпотентность повторного reconcile.
- [ ] Интеграционный тест в `repl/index.test.ts` прогоняет короткий сценарий (3–4 сообщения) через day-25-режим, проверяет наличие sources на каждом шаге и непустой task state после второго.
- [ ] Существующий тест-сьют остался зелёным.

---

## Phase 3: Длинные сценарии + раннер + отчёт

**User stories**: 10, 11, 24

### What to build

Два фиксированных сценария по 12–15 сообщений в `scripts/day25/scenarios/` в формате JSON (последовательность `user`-сообщений + метаданные: исходная цель сценария, ожидаемые ограничения по шагам, контрольные шаги для проверки goal preservation):

- **scenario-rdbms-scaling**: цель — «горизонтальное масштабирование RDBMS», ограничение «только open source» фиксируется на 3-м шаге, уточняющий вопрос «а в случае cross-shard join?» на 8-м, обобщающий запрос на 13-м.
- **scenario-caching-strategy**: цель — «выбрать стратегию кэширования», термин «под „репликацией кэша“ понимаем write-through» на 4-м шаге, ограничение «read-heavy workload» на 6-м, контрольный вопрос на 14-м.

Раннер `scripts/day25/run-scenarios.ts` для каждого сценария создаёт свежую сессию, прогоняет сообщения через тот же конвейер, что REPL (но без readline и индикаторов). После каждого шага собирает: наличие `sources[]`, `confidence`, текущий снапшот task state, cost шага. На контрольных шагах сравнивает `taskState.goal` / `constraints[]` / `terms{}` с ожиданием сценария.

Метрики отчёта: sources present rate (% шагов с непустым sources), goal preservation (binary на контрольных шагах), constraint/term retention, faithfulness (переиспользуется `FaithfulnessJudge` day 24, усреднение по сценарию), confidence distribution, total cost по сценарию, reconciliation cost отдельно.

Рендер `scripts/day25/report.md` — структура как в day 24: сводная таблица, per-scenario детали, per-step таблица с галочками.

### Acceptance criteria

- [ ] `bun run scripts/day25/run-scenarios.ts` успешно прогоняет оба сценария без ошибок.
- [ ] Сгенерирован `scripts/day25/report.md` с сводной таблицей и детальными разделами по каждому сценарию.
- [ ] В отчёте видно: sources present rate, goal preservation (✓/✗ на контрольных шагах), constraint/term retention, среднее faithfulness, confidence distribution, суммарный cost.
- [ ] Sources present rate на in-scope шагах ≥ 80% (допуск на естественные `insufficient`-отказы).
- [ ] Goal preservation на финальном контрольном шаге каждого сценария = ✓ (цель не потеряна).
- [ ] Зафиксированные constraints/terms из ранних шагов присутствуют в task state на финальных шагах.
- [ ] Существующий тест-сьют остался зелёным.
- [ ] Итоговый отчёт в репозитории закоммичен.

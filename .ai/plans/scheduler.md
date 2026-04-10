# Plan: Планировщик и фоновые задачи

> Source PRD: `.ai/prd/scheduler.md`

## Architectural decisions

- **Schema**: две новые таблицы — `scheduled_tasks` (id, session_id, name, cron_expression, prompt, enabled, created_at, last_run_at, next_run_at) и `schedule_executions` (id, task_id, status, result, error, started_at, finished_at, tokens_used)
- **Key models**: `ScheduledTask`, `ScheduleExecution` в `domain/models/`
- **Repository port**: `SchedulerRepository` — единый интерфейс для задач и выполнений
- **Domain service**: `SchedulerService` — CRUD, тик-цикл, запуск выполнения
- **Cron**: 5-field стандартный формат + interval-шорткаты (`every 30m`), библиотека `cron-parser`
- **Тик-цикл**: `setInterval` раз в 60 секунд, `next_run_at` пересчитывается после каждого выполнения
- **Tool namespace**: built-in tools используют тот же `ToolProvider` interface с префиксом `scheduler__`
- **Standalone entrypoint**: `src/scheduler.ts` → `bun run scheduler`
- **Notifications**: `notify-send` через `Bun.spawn` в standalone, цветной вывод в REPL через picocolors

---

## Phase 1: Минимальный планировщик — CRUD + выполнение по таймеру

**User stories**: 2, 3, 4, 12, 16, 17

### What to build

Сквозной путь от создания задачи до её выполнения. Пользователь через `/schedule create "*/5 * * * *" "расскажи анекдот"` создаёт задачу. Тик-цикл (setInterval 60s) проверяет `next_run_at`, при наступлении времени отправляет prompt в LLM через ChatService, сохраняет результат (или ошибку) в `schedule_executions`. REPL-команды `/schedule list` и `/schedule delete N` для управления.

### Acceptance criteria

- [ ] Таблицы `scheduled_tasks` и `schedule_executions` создаются в БД
- [ ] `/schedule create` создаёт задачу с валидным cron, вычисляет `next_run_at`
- [ ] `/schedule list` показывает задачи с именем, cron, статусом enabled, next_run
- [ ] `/schedule delete N` удаляет задачу
- [ ] Тик-цикл запускается при старте REPL, выполняет задачи когда `next_run_at <= now`
- [ ] Результат выполнения сохраняется в `schedule_executions` с status/result/error/timestamps/tokens
- [ ] Тесты: SchedulerService (CRUD, тик-логика), SqliteSchedulerRepository (persistence)

---

## Phase 2: Результаты и вывод в REPL

**User stories**: 6, 7, 8

### What to build

Команда `/schedule results [N]` показывает историю выполнений — все или по конкретной задаче. При срабатывании задачи в REPL результат выводится прямо в терминал с цветным форматированием: заголовок `[Задача: <name>]` и тело результата. Вывод происходит в момент ожидания пользовательского ввода (не прерывая LLM-ответ).

### Acceptance criteria

- [ ] `/schedule results` показывает последние N выполнений всех задач
- [ ] `/schedule results <id>` показывает выполнения конкретной задачи
- [ ] При выполнении задачи в REPL выводится цветной блок с результатом
- [ ] Вывод не прерывает текущий ответ LLM или пользовательский ввод

---

## Phase 3: Enable/disable + interval-шорткаты

**User stories**: 5, 15, 18

### What to build

Команды `/schedule enable N` и `/schedule disable N` для управления активностью задач. В `/schedule list` отображается `next_run_at`. Парсинг interval-шорткатов: `every 30m`, `every 2h`, `every 1d` конвертируются в cron-выражения при создании.

### Acceptance criteria

- [ ] `/schedule enable N` включает задачу, пересчитывает `next_run_at`
- [ ] `/schedule disable N` выключает задачу
- [ ] `/schedule list` показывает next_run_at для каждой задачи
- [ ] `every 30m` парсится в `*/30 * * * *`
- [ ] `every 2h` парсится в `0 */2 * * *`
- [ ] `every 1d` парсится в `0 0 */1 * *`
- [ ] Тесты: парсинг interval-шорткатов

---

## Phase 4: LLM tools — управление через естественный язык

**User stories**: 1, 14

### What to build

Built-in tools `create_schedule`, `delete_schedule`, `list_schedules` интегрированные в ToolProvider. LLM может вызвать эти tools в ответ на natural language запрос пользователя ("собирай новости каждые 30 минут"). LLM сам формирует cron-выражение и prompt.

### Acceptance criteria

- [ ] ToolProvider включает scheduler tools наряду с MCP tools
- [ ] LLM может вызвать `create_schedule` с параметрами name, cron, prompt
- [ ] LLM может вызвать `delete_schedule` по id
- [ ] LLM может вызвать `list_schedules` для просмотра задач
- [ ] Результат tool-use отображается в REPL как обычный tool call

---

## Phase 5: MCP-tools в задачах + полный контекст сессии

**User stories**: 11, 13

### What to build

При выполнении задачи планировщик подключает все MCP-tools, доступные в текущей сессии. System prompt берётся из настроек. Задача выполняется с полным tool-use loop — LLM сам решает, нужны ли ему инструменты.

### Acceptance criteria

- [ ] Выполнение задачи использует sendWithToolLoop (не просто sendMessage)
- [ ] MCP-tools доступны LLM при выполнении задачи
- [ ] System prompt из options применяется к выполнению задачи
- [ ] Задача привязана к session_id и работает в контексте этой сессии

---

## Phase 6: Standalone scheduler + notify-send

**User stories**: 9, 10

### What to build

Отдельный entrypoint `src/scheduler.ts` запускаемый через `bun run scheduler`. Инициализирует БД, MCP-подключения, LLM-клиент. Крутит тик-цикл без REPL. Результаты отправляются через `notify-send`. Graceful shutdown по SIGINT/SIGTERM.

### Acceptance criteria

- [ ] `bun run scheduler` запускает standalone процесс
- [ ] Процесс подключается к тем же MCP-серверам из БД
- [ ] Задачи выполняются по расписанию
- [ ] Результаты отправляются через `notify-send`
- [ ] SIGINT/SIGTERM корректно завершают процесс (очистка интервалов, закрытие БД)

# PRD: Планировщик и фоновые задачи

## Problem Statement

Агент работает только в режиме реактивного диалога — отвечает на запросы пользователя, но не умеет выполнять задачи по расписанию. Пользователь не может попросить агента "каждые 30 минут собирай новости" или "напомни через час про встречу". Нет механизма периодического выполнения промптов с сохранением результатов и уведомлением пользователя.

## Solution

Встроенный планировщик задач с двумя режимами работы:

1. **In-REPL** — задачи выполняются в фоне, пока REPL активен. Результаты выводятся прямо в терминал с цветовым выделением.
2. **Standalone** (`bun run scheduler`) — отдельный процесс без REPL, который крутит цикл выполнения задач и отправляет результаты через `notify-send`.

Пользователь создаёт задачи двумя способами:
- Через REPL-команды (`/schedule create ...`)
- Через естественный язык ("собирай новости каждые 30 минут") — LLM сам извлекает расписание и промпт, вызывая внутренний tool

При выполнении задачи планировщик отправляет сохранённый промпт в LLM с полным контекстом — system prompt, MCP-tools, активная сессия. LLM сам решает, нужны ли ему инструменты. Результат каждого выполнения сохраняется в БД.

## User Stories

1. As a user, I want to create a scheduled task by writing in natural language (e.g. "каждые 30 минут собирай новости"), so that I don't need to know cron syntax.
2. As a user, I want to create a scheduled task via `/schedule create "*/30 * * * *" "собери новости"`, so that I have precise control over the schedule.
3. As a user, I want to list all scheduled tasks via `/schedule list`, so that I can see what is running.
4. As a user, I want to delete a scheduled task via `/schedule delete N`, so that I can stop tasks I no longer need.
5. As a user, I want to enable/disable a task via `/schedule enable N` / `/schedule disable N`, so that I can temporarily pause a task without deleting it.
6. As a user, I want to see execution history via `/schedule results [N]`, so that I can review what the agent has done.
7. As a user, I want scheduled task results to appear directly in the REPL with colored formatting ("Результат задачи: ..."), so that I notice them immediately.
8. As a user, I want the scheduler to work while I'm using the REPL, so that tasks execute in the background of my normal workflow.
9. As a user, I want to run a standalone scheduler process (`bun run scheduler`), so that tasks execute even when I'm not in the REPL.
10. As a user, I want the standalone scheduler to send desktop notifications via `notify-send`, so that I see results without having a terminal open.
11. As a user, I want the LLM to have access to all connected MCP tools when executing a scheduled task, so that it can fetch data, query APIs, etc.
12. As a user, I want each task execution to be stored in the database with timestamp, status and result, so that I have a full history.
13. As a user, I want the scheduled task to run in the context of the active session (system prompt, MCP connections), so that it has the same capabilities as my interactive chat.
14. As a user, I want the LLM to be able to create/delete/list schedules via tool-use during a conversation, so that I can manage tasks through natural dialogue.
15. As a user, I want to see the next scheduled run time for each task in `/schedule list`, so that I know when things will fire.
16. As a user, I want failed executions to be logged with error details, so that I can diagnose problems.
17. As a user, I want cron expressions to support standard 5-field format (minute, hour, day, month, weekday), so that I can express any schedule.
18. As a user, I want simple interval shortcuts (e.g. "every 30m", "every 2h") as an alternative to cron, so that common cases are easy.

## Implementation Decisions

### Архитектура модулей

- **SchedulerService** (domain service) — ядро планировщика:
  - CRUD операции для scheduled tasks
  - Тик-цикл: проверяет какие задачи пора выполнить (сравнивает cron с текущим временем и last_run)
  - Запускает выполнение: отправляет prompt в LLM через ChatService с полным контекстом (system prompt, MCP tools, сессия)
  - Сохраняет результат выполнения в БД

- **ScheduledTask** (domain model) — модель задачи:
  - `id`, `session_id`, `name`, `cron_expression`, `prompt`, `enabled`, `created_at`, `last_run_at`, `next_run_at`

- **ScheduleExecution** (domain model) — запись о выполнении:
  - `id`, `task_id`, `status` (success | error), `result`, `error`, `started_at`, `finished_at`, `tokens_used`

- **SchedulerRepository** (domain port) — интерфейс для persistence

- **SqliteSchedulerRepository** (storage adapter) — реализация на SQLite:
  - Таблица `scheduled_tasks`
  - Таблица `schedule_executions`

- **SchedulerRunner** (presentation) — standalone entrypoint:
  - Инициализирует БД, MCP-подключения, LLM-клиент
  - Запускает тик-цикл (setInterval, проверка раз в минуту)
  - Уведомления через `notify-send`

- **REPL-команды** — расширение существующего CommandHandler:
  - `/schedule create <cron|interval> <prompt>` — создать задачу
  - `/schedule list` — список задач с next_run
  - `/schedule delete <id>` — удалить
  - `/schedule enable <id>` / `/schedule disable <id>` — вкл/выкл
  - `/schedule results [id]` — история выполнений

- **LLM tools** — внутренние tools (не MCP, а built-in), доступные LLM:
  - `create_schedule(name, cron_expression, prompt)` — создать задачу
  - `delete_schedule(id)` — удалить
  - `list_schedules()` — список

### Cron-парсинг

- Стандартный 5-field cron: `*/30 * * * *`
- Interval-шорткаты: `every 30m`, `every 2h`, `every 1d` — конвертируются в cron на этапе создания
- LLM при парсинге natural language должен сам сформировать cron-выражение

### Тик-цикл

- `setInterval` с периодом 60 секунд (минимальная гранулярность — 1 минута, как у cron)
- На каждом тике: выбрать все enabled задачи, где `next_run_at <= now`
- Выполнить последовательно (не параллельно — избежать гонок за LLM-контекст)
- После выполнения обновить `last_run_at` и пересчитать `next_run_at`

### Вывод результатов

- **In-REPL**: цветной блок с заголовком `[Задача: <name>]` и телом результата. Использовать picocolors (уже в зависимостях). Выводить между промптами пользователя — после завершения текущего ответа LLM или в момент ожидания ввода.
- **Standalone**: `notify-send "Задача: <name>" "<truncated result>"` через `Bun.spawn`

### Контекст выполнения

- Задача привязана к `session_id` — выполняется в контексте этой сессии
- System prompt берётся из настроек (options table)
- MCP-tools берутся из текущих подключений (McpConnectionManager)
- Результат выполнения НЕ добавляется в историю сообщений сессии (чтобы не засорять контекст), только в таблицу `schedule_executions`

### Миграции БД

- Новые таблицы `scheduled_tasks` и `schedule_executions` добавляются через существующий механизм миграций в `db.ts`

## Testing Decisions

Хороший тест проверяет внешнее поведение модуля через его публичный интерфейс, не завися от деталей реализации. Тесты не должны мокать БД — используем реальный SQLite in-memory.

### Модули для тестирования

- **SchedulerService**:
  - CRUD: создание, удаление, enable/disable задач
  - Тик-логика: задача выполняется когда `next_run_at <= now`, не выполняется раньше времени
  - Interval-парсинг: `every 30m` -> корректный cron
  - Пересчёт `next_run_at` после выполнения

- **SqliteSchedulerRepository**:
  - Persistence: создание, чтение, обновление, удаление
  - Выборка задач для выполнения (where enabled and next_run <= now)
  - Сохранение и чтение execution history

### Prior art

Аналогичные тесты: `SqliteMcpServerRepository`, `TaskService` — тот же паттерн с реальным SQLite.

## Out of Scope

- Распределённое выполнение (несколько процессов-шедулеров)
- Web UI для управления задачами
- Retry-логика для упавших задач (пока просто логируем ошибку)
- Зависимости между задачами (цепочки)
- Ограничение по количеству задач или частоте выполнения
- Persisted MCP-подключения для standalone-режима (используются те же, что зарегистрированы в БД)

## Further Notes

- Минимальная гранулярность — 1 минута (ограничение cron)
- В standalone-режиме процесс должен корректно завершаться по SIGINT/SIGTERM
- Для cron-парсинга можно использовать библиотеку (например `cron-parser`) или написать минимальный парсер для поддерживаемого подмножества
- `next_run_at` вычисляется при создании и после каждого выполнения — это позволяет делать эффективный SQL-запрос без парсинга cron на каждом тике

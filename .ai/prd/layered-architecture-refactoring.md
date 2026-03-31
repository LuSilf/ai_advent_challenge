## Problem Statement

Проект представляет собой CLI-чат с LLM с продвинутым управлением памятью, сессиями, ветвлением и стратегиями контекста. Сейчас бизнес-логика размазана между слоем представления (`repl.ts`, `cli.ts`) и инфраструктурными модулями (`db.ts`, `memory.ts`, `request.ts`). Хранилище данных (`bun:sqlite`), формат API (`openai` SDK) и файловая система используются напрямую из бизнес-логики, что делает невозможным:

- Добавление новых интерфейсов (TUI, Web) без дублирования бизнес-логики
- Замену хранилища (PostgreSQL, Redis, файлы) без переписывания бизнес-кода
- Замену LLM-провайдера или SDK без затрагивания логики чата
- Изолированное тестирование бизнес-логики

## Solution

Рефакторинг проекта в слоистую архитектуру с чётким разделением ответственности:

- **Domain** — бизнес-логика и интерфейсы (порты), не зависит ни от чего внешнего
- **Storage** — реализации репозиториев (SQLite, файлы) за интерфейсами из domain
- **API** — реализации LLM-клиентов (OpenAI) за интерфейсами из domain
- **Presentation** — слои представления (REPL, в будущем TUI и Web), зависят только от domain-сервисов

Бизнес-логика не знает о конкретном хранилище, API-провайдере или способе взаимодействия с пользователем. Зависимости инжектируются через конструкторы/фабрики.

## User Stories

1. As a разработчик, I want бизнес-логику чата изолированную от хранилища, so that я могу заменить SQLite на PostgreSQL без изменения логики
2. As a разработчик, I want абстрактный интерфейс LLM-клиента, so that я могу подключить другой API-провайдер (Anthropic, local LLM) без переписывания бизнес-кода
3. As a разработчик, I want интерфейс MemoryStore, so that я могу хранить память в БД, файлах или Redis на выбор
4. As a разработчик, I want domain-сервис ChatService, so that workflow отправки сообщения (контекст → запрос → ответ → сохранение → стоимость) описан в одном месте и не дублируется между REPL и CLI
5. As a разработчик, I want domain-сервис MemoryService, so that reconciliation памяти работает одинаково из любого UI
6. As a разработчик, I want domain-сервис SessionService, so that создание, переключение, ветвление и чекпоинты сессий доступны из любого представления
7. As a разработчик, I want domain-сервис ContextService, so that стратегии контекста (full, sliding) работают с внутренним форматом сообщений, а не с форматом OpenAI
8. As a разработчик, I want domain-сервис CostService, so that подсчёт стоимости не зависит от конкретного API-провайдера
9. As a разработчик, I want presentation-слой REPL, вызывающий domain-сервисы, so that в REPL нет бизнес-логики — только ввод/вывод и маршрутизация команд
10. As a разработчик, I want внутренний формат сообщений (Message, Session, Fact и т.д.), so that domain-слой не зависит от формата OpenAI или структуры таблиц SQLite
11. As a разработчик, I want конвертацию внутренний формат ↔ OpenAI формат в адаптере API, so that при смене провайдера меняется только адаптер
12. As a разработчик, I want конвертацию внутренний формат ↔ строки БД в адаптере Storage, so that при смене хранилища меняется только адаптер
13. As a разработчик, I want интерфейс SessionRepository с методами типа `getHistory(sessionId)`, `createSession()`, so that бизнес-логика не знает о SQL-запросах
14. As a разработчик, I want интерфейс MessageRepository с методами `add(sessionId, message)`, `getBySession(sessionId)`, so that сообщения абстрагированы от хранилища
15. As a разработчик, I want интерфейс FactRepository для CRUD фактов по сессии, so that факты можно хранить где угодно
16. As a разработчик, I want интерфейс ModelRepository для моделей, цен и ролей, so that конфигурация моделей абстрагирована
17. As a разработчик, I want интерфейс OptionsRepository для глобальных настроек, so that настройки можно хранить в БД, файле или env
18. As a разработчик, I want тесты domain-сервисов с мок-репозиториями, so that бизнес-логика тестируется без БД и API
19. As a разработчик, I want интеграционные тесты storage-реализаций, so that SQL-запросы и файловые операции проверяются отдельно
20. As a разработчик, I want тесты presentation-слоя с мок-сервисами, so that UI-логика проверяется без реальной бизнес-логики
21. As a разработчик, I want DI через конструкторы или фабричные функции, so that зависимости явно передаются и легко подменяются в тестах
22. As a разработчик, I want сохранить всю текущую функциональность (30+ команд REPL, single-shot, стриминг, ветвление, reconciliation), so that рефакторинг не ломает пользовательский опыт
23. As a разработчик, I want добавление нового UI (TUI, Web) без дублирования бизнес-логики, so that каждый UI — тонкая обёртка над domain-сервисами
24. As a разработчик, I want чтобы config.ts оставался независимым модулем, so that конфигурация парсится из env/args и передаётся в фабрику при сборке приложения

## Implementation Decisions

### Структура директорий

```
src/
  domain/           # Бизнес-логика, не зависит от внешних модулей
    models/         # Внутренние типы: Message, Session, Fact, Model, etc.
    ports/          # Интерфейсы: SessionRepository, LLMClient, MemoryStore, etc.
    services/       # ChatService, MemoryService, SessionService, ContextService, CostService
  storage/          # Реализации репозиториев
    sqlite/         # SQLite-реализации всех репозиториев (разбивка текущего db.ts)
    file/           # FileMemoryStore (текущий memory.ts)
  api/              # Реализации LLM-клиентов
    openai/         # OpenAI адаптер (текущий request.ts + часть cli.ts)
  presentation/     # Слои представления
    repl/           # REPL (текущий repl.ts без бизнес-логики)
  config.ts         # Парсинг конфигурации (остаётся как есть)
  main.ts           # Точка входа: собирает зависимости, запускает приложение
```

### Domain-модели (внутренний формат)

- `Message { id, sessionId, role: "user" | "assistant", content, createdAt }`
- `Session { id, title, contextStrategy, parentSessionId, branchPointMessageId, createdAt, updatedAt }`
- `Fact { id, sessionId, key, value, updatedAt }`
- `Model { id, name, inputPrice, outputPrice, contextSize }`
- `ModelRole { role: "chat" | "title" | "facts", modelId }`
- `Option { key, value }`
- `LLMRequest { messages: Message[], instructions: string, model: string, params: GenerationParams }`
- `LLMResponse { content: string, inputTokens: number, outputTokens: number }`
- `GenerationParams { temperature?, topP?, maxCompletionTokens?, reasoningEffort?, reasoningSummary?, stream? }`

### Порты (интерфейсы в domain/ports/)

- `SessionRepository` — `create()`, `getById(id)`, `getAll()`, `update(session)`, `delete(id)`, `getLastSession()`, `createBranch(sessionId, checkpointMessageId)`, `getBranches(sessionId)`
- `MessageRepository` — `add(sessionId, role, content)`, `getBySession(sessionId)`, `getById(id)`, `deleteBySession(sessionId)`
- `FactRepository` — `set(sessionId, key, value)`, `getBySession(sessionId)`, `delete(sessionId, key)`
- `ModelRepository` — `getAll()`, `getById(id)`, `getRole(role)`, `setRole(role, modelId)`
- `OptionsRepository` — `get(key)`, `set(key, value)`, `getAll()`
- `CheckpointRepository` — `create(sessionId, messageId)`, `getBySession(sessionId)`
- `MemoryStore` — `read(type: "longterm" | "working")`, `write(type, content)`, `append(type, content)`
- `LLMClient` — `send(request: LLMRequest): Promise<LLMResponse>`, `stream(request: LLMRequest): AsyncIterable<string>` (+ финальный LLMResponse)

### Domain-сервисы

- **ChatService** — основной workflow: принимает текст пользователя, использует `SessionService` для текущей сессии, `ContextService` для сборки контекста, `LLMClient` для запроса, `MessageRepository` для сохранения, `CostService` для стоимости. Возвращает `LLMResponse` или `AsyncIterable<string>`.
- **MemoryService** — `reconcile(content, memoryType)`, `checkShouldReconcile(messageCount)`, `getMemoryBlocks()`. Использует `MemoryStore` и `LLMClient` (с ролью "facts").
- **SessionService** — обёртка над `SessionRepository`, `MessageRepository`, `CheckpointRepository`. Методы: `createSession()`, `switchSession(id)`, `branchFromCheckpoint(...)`, `getHistory(sessionId)`, `autoTitle(sessionId, firstExchange)`.
- **ContextService** — стратегии контекста. Принимает `Message[]` и `Fact[]`, возвращает `Message[]` для отправки в LLM. Стратегии работают с внутренним форматом.
- **CostService** — `calculate(model, inputTokens, outputTokens)`, `accumulate(cost)`, `getTotal()`. Использует `ModelRepository` для цен.

### Dependency Injection

Простые фабричные функции в `main.ts`. Всё создаётся в точке входа и передаётся через конструкторы:

```
config → создаём sqlite-репозитории → создаём OpenAI-клиент → создаём domain-сервисы → создаём REPL → запускаем
```

Без DI-контейнера — проект не настолько большой, чтобы это оправдать. Если в будущем понадобится — легко добавить.

### Конвертация форматов

- **Storage → Domain**: SQLite-репозитории возвращают domain-модели, конвертация внутри реализации
- **Domain → API**: `OpenAILLMClient` конвертирует `Message[]` → OpenAI format, `LLMRequest` → OpenAI Responses API params
- **Domain → Presentation**: Сервисы возвращают domain-модели, REPL форматирует для вывода

### Миграция текущего кода

- `db.ts` → разбивается на `SqliteSessionRepository`, `SqliteMessageRepository`, `SqliteFactRepository`, `SqliteModelRepository`, `SqliteOptionsRepository`, `SqliteCheckpointRepository`. Инициализация схемы и миграции — в общем модуле `sqlite/schema.ts`.
- `memory.ts` → `FileMemoryStore` в `storage/file/`
- `request.ts` → часть логики уходит в `OpenAILLMClient`, часть (сборка instructions) — в `ContextService` или `ChatService`
- `strategy.ts` → `ContextService` в domain, но работает с внутренними `Message[]`, а не с OpenAI-форматом
- `reconciliation.ts` → `MemoryService` в domain, использует `LLMClient` вместо прямого вызова OpenAI
- `cost-accumulator.ts` → `CostService` в domain
- `repl.ts` → `ReplUI` в presentation, вся бизнес-логика заменяется вызовами domain-сервисов
- `cli.ts` → `main.ts` (сборка зависимостей) + вызов `ChatService` для single-shot режима
- `config.ts` → остаётся, используется в `main.ts` для создания реализаций
- `debug-logger.ts` → остаётся утилитой, используется в presentation и при необходимости в api-слое

### Порядок рефакторинга

Поступательно: тесты проходят → меняем → чиним если падает → повторяем. Обратная совместимость CLI не требуется. Можно рефакторить всё сразу.

## Testing Decisions

### Принципы тестирования

Хороший тест проверяет внешнее поведение модуля через его публичный интерфейс, а не детали реализации. Тест должен ломаться только если меняется контракт модуля, а не его внутренняя структура.

### Что тестируем

**Domain-сервисы (unit-тесты с моками):**
- `ChatService` — workflow отправки сообщения, обработка стриминга, сохранение ответа, расчёт стоимости. Моки: `MessageRepository`, `LLMClient`, `ContextService`, `CostService`.
- `MemoryService` — reconciliation, проверка интервала, формирование memory-блоков. Моки: `MemoryStore`, `LLMClient`.
- `SessionService` — создание, переключение, ветвление, auto-title. Моки: `SessionRepository`, `MessageRepository`, `CheckpointRepository`, `LLMClient`.
- `ContextService` — стратегии full/sliding, формирование контекста с фактами. Без моков (чистая логика).
- `CostService` — расчёт и накопление стоимости. Мок: `ModelRepository`.

**Storage-реализации (интеграционные тесты):**
- `SqliteSessionRepository`, `SqliteMessageRepository` и т.д. — тесты с реальной in-memory SQLite БД. Проверяют CRUD, constraints, edge cases.
- `FileMemoryStore` — тесты с временными файлами. Проверяют чтение, запись, дополнение.

**API-реализации:**
- `OpenAILLMClient` — тесты конвертации форматов (internal ↔ OpenAI). Мок HTTP-слоя для проверки запросов/ответов.

**Presentation (unit-тесты с мок-сервисами):**
- `ReplUI` — тесты команд: вызывает ли `/new` метод `SessionService.createSession()`, форматируется ли вывод `/models` корректно, и т.д. Моки: все domain-сервисы.

### Аналоги в текущем коде

- `db.test.ts` — аналог будущих интеграционных тестов storage-слоя
- `strategy.test.ts` — аналог будущих тестов `ContextService`
- `repl.test.ts` — аналог будущих тестов presentation
- `memory.test.ts` — аналог будущих тестов `FileMemoryStore`
- `request.test.ts` — аналог будущих тестов `OpenAILLMClient`
- `reconciliation.test.ts` — аналог будущих тестов `MemoryService`
- `cost-accumulator.test.ts` — аналог будущих тестов `CostService`

## Out of Scope

- Реализация TUI-интерфейса (будет отдельный PRD)
- Реализация Web-интерфейса (будет отдельный PRD)
- Реализация альтернативных хранилищ (PostgreSQL, Redis) — рефакторинг только создаёт интерфейсы, реализация остаётся SQLite + файлы
- Реализация альтернативных LLM-клиентов (Anthropic, local) — рефакторинг только создаёт интерфейс, реализация остаётся OpenAI
- Изменение функциональности — все 30+ команд REPL, single-shot режим, стриминг, ветвление, reconciliation должны работать как раньше
- Изменение схемы БД — структура таблиц остаётся прежней
- Изменение формата memory-файлов

## Further Notes

- Проект использует Bun runtime, все зависимости (`bun:sqlite`, `bun:test`) специфичны для Bun. Абстракция storage позволит в будущем отвязаться и от Bun при необходимости.
- `debug-logger.ts` остаётся утилитой и может использоваться в разных слоях. Это осознанное решение — он не несёт бизнес-логики.
- `config.ts` остаётся модулем верхнего уровня, используется только в `main.ts` при сборке приложения. Domain-сервисы получают уже готовые значения конфигурации через конструкторы.
- Стриминг LLM-ответов: `LLMClient.stream()` возвращает `AsyncIterable<string>`, presentation-слой итерирует и выводит. Финальный `LLMResponse` с токенами доступен после завершения стрима.

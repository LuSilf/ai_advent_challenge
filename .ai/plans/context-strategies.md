# Plan: Стратегии управления контекстом

> Source PRD: `.ai/prd/context-strategies.md`

## Architectural decisions

- **Стратегии контекста**: `full`, `sliding`, `facts` — строковые идентификаторы, хранятся в поле `context_strategy` таблицы `sessions`
- **Интерфейс стратегии**: метод `buildMessages(sessionId, historyLimit) → { messages: ChatMessage[], factsBlock?: string }` — единая точка формирования контекста для запроса
- **Схема БД**:
  - `sessions` — новые поля: `context_strategy TEXT DEFAULT 'full'`, `parent_session_id INTEGER`, `branch_point_message_id INTEGER`
  - `facts(id, session_id, key, value, updated_at)` — UNIQUE(session_id, key), CASCADE delete
  - `checkpoints(id, session_id, message_id, created_at)` — CASCADE delete
- **Facts-блок** включается в системный промпт как секция "Известные факты:" перед основным промптом
- **Извлечение фактов** — отдельный LLM-запрос после каждого обмена (user + assistant), используется `titleModel`
- **Branching** — ветка = новая сессия с `parent_session_id` и скопированными сообщениями до checkpoint

---

## Phase 1: Инфраструктура стратегий + Full + Sliding Window

**User stories**: 1, 2, 3, 4, 5, 6, 7, 20, 21

### What to build

Добавить в БД поле `context_strategy` в таблицу `sessions`. Создать интерфейс `ContextStrategy` и две реализации: `FullStrategy` (возвращает все сообщения без лимита) и `SlidingWindowStrategy` (возвращает последние N сообщений по `HISTORY_LIMIT`). Фабрика `createStrategy(name)` создаёт нужную стратегию по имени.

В `config.ts` добавить переменную `CONTEXT_STRATEGY` (default: `full`). В `cli.ts` и `repl.ts` заменить прямой вызов `getMessages()` на `strategy.buildMessages()`. Стратегия новой сессии берётся из конфига, существующей — из БД.

В REPL добавить команду `/strategy [name]`: без аргумента показывает текущую, с аргументом — переключает и сохраняет в БД. В debug-логах выводить имя стратегии и количество сообщений в контексте.

### Acceptance criteria

- [ ] Миграция БД: поле `context_strategy` в таблице `sessions`, default `'full'`
- [ ] Интерфейс `ContextStrategy` с методом `buildMessages()`
- [ ] `FullStrategy` возвращает все сообщения сессии без ограничений
- [ ] `SlidingWindowStrategy` возвращает последние N сообщений (N = `HISTORY_LIMIT`)
- [ ] Фабрика `createStrategy()` создаёт стратегию по имени, бросает ошибку при неизвестном имени
- [ ] `CONTEXT_STRATEGY` читается из env, добавлена в `AppConfig`
- [ ] Новая сессия создаётся со стратегией из конфига
- [ ] `/strategy` без аргумента показывает текущую стратегию
- [ ] `/strategy sliding` переключает стратегию и сохраняет в БД
- [ ] Debug-логи показывают имя стратегии и количество сообщений
- [ ] Тесты: стратегии, фабрика, config, DB-поле

---

## Phase 2: Sticky Facts

**User stories**: 8, 9, 10, 11, 12, 13

### What to build

Создать таблицу `facts` в SQLite. Реализовать `StickyFactsStrategy`: при `buildMessages()` загружает факты из БД и формирует facts-блок для системного промпта + последние N сообщений.

Реализовать извлечение фактов: после каждого обмена (user + assistant) отправлять отдельный LLM-запрос с текущими фактами и последним обменом, получать обновлённый JSON, сохранять в таблицу `facts` через upsert.

В REPL добавить команду `/facts` для просмотра текущих фактов сессии. Зарегистрировать `StickyFactsStrategy` в фабрике. В debug-логах показывать количество фактов.

### Acceptance criteria

- [ ] Таблица `facts` создаётся при инициализации БД
- [ ] DB-функции: `getFacts(sessionId)`, `upsertFacts(sessionId, facts)`, `clearFacts(sessionId)`
- [ ] `StickyFactsStrategy.buildMessages()` возвращает facts-блок + последние N сообщений
- [ ] Facts-блок включается в системный промпт как секция "Известные факты:"
- [ ] После каждого обмена в стратегии "facts" — LLM-запрос для извлечения/обновления фактов
- [ ] Промпт извлечения фактов принимает текущие факты + последний обмен, возвращает JSON
- [ ] `/facts` показывает текущие факты сессии в формате key: value
- [ ] Debug-логи показывают количество фактов в контексте
- [ ] Тесты: DB-функции, buildMessages, парсинг LLM-ответа (мок), формирование промпта

---

## Phase 3: Branching

**User stories**: 14, 15, 16, 17, 18, 19

### What to build

Добавить в таблицу `sessions` поля `parent_session_id` и `branch_point_message_id`. Создать таблицу `checkpoints`.

Команда `/checkpoint` сохраняет ID последнего сообщения текущей сессии в таблицу `checkpoints`. Команда `/branch [name]` создаёт новую сессию с `parent_session_id` = текущая, `branch_point_message_id` = последний checkpoint, копирует все сообщения до checkpoint включительно, переключает на новую сессию. Стратегия контекста ветки наследуется от родителя, но может быть изменена через `/strategy`.

`/branches` показывает все ветки (сессии с общим `parent_session_id` или дочерние текущей). `/switch-branch N` переключает на ветку по номеру из списка.

### Acceptance criteria

- [ ] Миграция БД: поля `parent_session_id`, `branch_point_message_id` в `sessions`; таблица `checkpoints`
- [ ] `/checkpoint` сохраняет checkpoint (message_id) для текущей сессии
- [ ] `/branch [name]` создаёт новую сессию-ветку, копирует сообщения до checkpoint
- [ ] Ветка имеет правильные `parent_session_id` и `branch_point_message_id`
- [ ] Стратегия ветки наследуется от родителя
- [ ] `/branches` показывает список веток текущей сессии
- [ ] `/switch-branch N` переключает на ветку по номеру
- [ ] Можно задать разные стратегии в разных ветках через `/strategy`
- [ ] Тесты: создание checkpoint, создание ветки с копированием, listBranches, switch

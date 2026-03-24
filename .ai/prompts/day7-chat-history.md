# День 7: Сохранение контекста диалога

## Контекст проекта

CLI-агент на Bun + TypeScript, отправляет промпты в OpenAI-совместимые LLM через Responses API (`client.responses.create`).

Структура:
- `src/cli.ts` — точка входа, одиночный запрос-ответ
- `src/config.ts` — загрузка конфигурации из env, тип `AppConfig`
- `src/request.ts` — сборка `ResponseCreateParams`, `input` сейчас строка
- `src/debug-logger.ts` — debug-вывод в stderr
- Зависимости: `openai`, `picocolors`. Runtime: Bun

Сейчас CLI stateless: принимает промпт аргументом, делает один запрос, выводит ответ, завершается.

## Задача

Добавить сохранение и восстановление истории диалога между запусками. Агент должен помнить предыдущие сообщения после перезапуска.

## Архитектурные решения

### Хранение — SQLite через `bun:sqlite` (0 зависимостей)

Схема БД:

```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

- Путь к БД: env `HISTORY_DB`, дефолт `./data/history.db`
- Создавать директорию автоматически если не существует

### Передача истории в API

- `input` в Responses API передавать как массив сообщений: `[{role: "user", content: "..."}, {role: "assistant", content: "..."}, ...]`
- Ограничение: последние N сообщений из сессии (env `HISTORY_LIMIT`, дефолт 50)
- Изменить `buildResponseRequest` в `src/request.ts`: `input` принимает `string | Array<{role, content}>`

### Автоименование сессий

- После первого обмена (user + assistant) — отдельный запрос к LLM для генерации короткого названия сессии
- Модель для названий: env `TITLE_MODEL`, дефолт = `OPENAI_MODEL`
- Промпт: "Придумай короткое название (до 50 символов) для диалога по первому сообщению. Ответь только названием."
- Запрос не блокирует ввод пользователя

### Системный промпт

Оставляем текущий дефолтный (поэт). Пользователь может поменять через `OPENAI_SYSTEM_PROMPT`.

## Режимы работы

### REPL-режим (без аргументов)

`bun run src/cli.ts` — интерактивный чат:

- При старте продолжает последнюю сессию
- Выводит информацию о сессии:
  ```
  Сессия #3: "Стихи про кота" (5 сообщений)
  Последние сообщения:
    Вы: напиши стих про кота
    Бот: В усах мерцает лунный свет...
  Для новой сессии: /new | Помощь: /help
  >
  ```
- Ввод: `node:readline`, пустая строка = отправить сообщение
- Поддержка стриминга
- Debug-логирование работает как раньше

### Одиночный режим (с аргументом)

- `bun run src/cli.ts "привет"` — создаёт новую сессию, пишет обмен, выходит
- `bun run src/cli.ts --session 3 "привет"` — продолжает сессию 3, дописывает, выходит

## Команды REPL

| Команда | Действие |
|---|---|
| `/new` | Создать новую сессию и переключиться на неё |
| `/list` | Показать список сессий (id, название, дата, кол-во сообщений) |
| `/switch N` | Переключиться на сессию N |
| `/clear` | Очистить сообщения текущей сессии |
| `/delete N` | Удалить сессию N |
| `/rename текст` | Переименовать текущую сессию |
| `/history` | Показать последние сообщения текущей сессии |
| `/edit` | Открыть `$EDITOR` для ввода многострочного промпта |
| `/help` | Показать список команд |
| `/exit` | Выход (также Ctrl+D) |

## Новые модули

### `src/db.ts` — работа с SQLite

- `initDb(dbPath: string)` — открыть/создать БД, выполнить миграции
- `createSession()` — создать сессию, вернуть id
- `getLastSession()` — последняя сессия или null
- `listSessions()` — список сессий с количеством сообщений
- `deleteSession(id)` — удалить сессию
- `renameSession(id, title)` — переименовать
- `updateSessionTitle(id, title)` — обновить название (для автоименования)
- `addMessage(sessionId, role, content)` — добавить сообщение
- `getMessages(sessionId, limit?)` — получить сообщения сессии
- `clearMessages(sessionId)` — очистить сообщения сессии

### `src/repl.ts` — REPL-цикл

- Инициализация readline
- Чтение многострочного ввода (пустая строка = отправить)
- Парсинг и выполнение команд (`/new`, `/list`, и т.д.)
- Отправка сообщения → стриминг ответа → сохранение в БД
- Обработка `/edit` — запуск `$EDITOR` с temp-файлом

## Изменения в существующих файлах

### `src/config.ts`
- Убрать `fail` при пустом промпте — пустой промпт = REPL-режим
- Добавить поля в `AppConfig`:
  - `historyDb: string` (из `HISTORY_DB`)
  - `historyLimit: number` (из `HISTORY_LIMIT`, дефолт 50)
  - `titleModel: string` (из `TITLE_MODEL`, дефолт = `model`)
  - `sessionId?: number` (из `--session N` аргумента CLI)
- Парсинг `--session N` из аргументов CLI

### `src/request.ts`
- `buildResponseRequest` принимает историю сообщений
- `input` формируется как массив: `[...history, {role: "user", content: prompt}]`
- Если истории нет — `input` остаётся строкой (обратная совместимость)

### `src/cli.ts`
- Инициализация БД
- Если промпт пустой → запуск REPL из `src/repl.ts`
- Если промпт есть → одиночный режим: создать/продолжить сессию, загрузить историю, отправить, сохранить, выйти

## Новые переменные окружения

| Переменная | Дефолт | Описание |
|---|---|---|
| `HISTORY_DB` | `./data/history.db` | Путь к файлу SQLite |
| `HISTORY_LIMIT` | `50` | Макс. сообщений в контексте |
| `TITLE_MODEL` | значение `OPENAI_MODEL` | Модель для генерации названий сессий |

## Ограничения

- Не добавлять новые npm-зависимости (`bun:sqlite` и `node:readline` встроены)
- Сохранить обратную совместимость одиночного режима
- Стриминг работает и в REPL
- Debug-логирование работает и в REPL

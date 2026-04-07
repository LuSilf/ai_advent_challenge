# PRD: Подключение MCP

## Problem Statement

CLI-чатбот пока не поддерживает MCP (Model Context Protocol) — стандартный протокол для подключения внешних инструментов к LLM-приложениям. Без MCP бот не может использовать внешние tools (файловая система, БД, API и т.д.), что ограничивает его полезность.

## Solution

Добавить MCP-клиент в проект: возможность регистрировать MCP-серверы, подключаться к ним по stdio-транспорту и получать список доступных инструментов. Конфигурация серверов хранится в SQLite. Управление — через REPL-команды.

## User Stories

1. As a user, I want to register an MCP server by name and command, so that I can manage my tool servers
2. As a user, I want to list all registered MCP servers, so that I can see what's configured
3. As a user, I want to remove a registered MCP server, so that I can clean up unused servers
4. As a user, I want to connect to a registered MCP server and see its available tools, so that I can verify the connection works
5. As a user, I want to see tool names and descriptions from the MCP server, so that I understand what each tool does
6. As a user, I want clear error messages when an MCP server fails to start or connect, so that I can debug configuration issues
7. As a user, I want the MCP connection to clean up properly after listing tools, so that child processes don't leak

## Implementation Decisions

### Модули

1. **MCP Server Repository (порт + SQLite-адаптер)** — CRUD для хранения зарегистрированных MCP-серверов (name, command, args) в SQLite. Таблица `mcp_servers` с полями: `name TEXT PRIMARY KEY, command TEXT NOT NULL, args TEXT` (args — JSON-массив строк).

2. **MCP Client Service (доменный сервис)** — подключение к MCP-серверу через stdio, получение списка tools, корректное закрытие соединения. Использует `@modelcontextprotocol/sdk` — официальный MCP SDK.

3. **REPL-команды** — набор команд `/mcp`:
   - `/mcp add <name> <command> [args...]` — регистрация сервера
   - `/mcp list` — список зарегистрированных серверов
   - `/mcp tools <name>` — подключиться к серверу и вывести список инструментов
   - `/mcp remove <name>` — удаление сервера

4. **Тестовый MCP-сервер** — минимальный скрипт на TypeScript, реализующий MCP-сервер с 2-3 dummy-инструментами (echo, add, current_time). Нужен для E2E-тестирования без внешних зависимостей.

### Технические решения

- **SDK**: `@modelcontextprotocol/sdk` — официальный TypeScript SDK для MCP
- **Транспорт**: stdio (StdioClientTransport) — сервер запускается как child process
- **Хранение**: SQLite, таблица `mcp_servers`. Args хранятся как JSON-массив
- **Жизненный цикл соединения**: connect → listTools → close. На этом этапе соединение не держится открытым — подключаемся только на время запроса tools

## Testing Decisions

Хорошие тесты проверяют внешнее поведение модуля через его публичный интерфейс, не завися от деталей реализации.

### Что тестируем

1. **MCP Server Repository** — unit-тесты: добавление, получение, удаление, список серверов, дубликаты имён. По аналогии с существующими SQLite-репозиториями (например, `options-repository.test.ts`).

2. **MCP Client Service** — unit-тест с мок-транспортом: проверка что `listTools` возвращает корректный список. Отдельно — обработка ошибок (сервер не запустился, таймаут).

3. **E2E-тест** — запуск реального тестового MCP-сервера через stdio, подключение, получение списка tools, проверка имён и описаний.

### Prior art

Существующие тесты репозиториев (`src/storage/sqlite/*.test.ts`) — паттерн для repository-тестов. E2E-тесты с живыми процессами — аналог `src/domain/services/task-state-machine.test.ts`.

## Out of Scope

- Вызов MCP-инструментов (tool call) — будет в следующих итерациях
- Интеграция MCP tools в LLM-цикл (передача tools в запрос к модели)
- SSE/HTTP транспорт
- Автоматическое переподключение / keep-alive
- Аутентификация MCP-серверов
- Редактирование зарегистрированных серверов (пока — remove + add)

## Further Notes

- MCP SDK (`@modelcontextprotocol/sdk`) требует установки как зависимость проекта
- Тестовый сервер размещается в `scripts/` рядом с существующим `seed-profiles.ts`
- Формат вывода tools: `name — description` (по одному на строку)

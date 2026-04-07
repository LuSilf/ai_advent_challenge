# Plan: Подключение MCP

> Source PRD: `.ai/prd/mcp-connection.md`

## Architectural decisions

- **Schema**: таблица `mcp_servers` — `name TEXT PRIMARY KEY, command TEXT NOT NULL, args TEXT` (args — JSON-массив строк)
- **Key models**: `McpServerConfig { name, command, args, cwd? }`, `McpTool { name, description, inputSchema }`
- **Порт**: `McpServerRepository` (CRUD) — по аналогии с `OptionsRepository`
- **Доменный сервис**: `McpClientService` — подключение через `@modelcontextprotocol/sdk`, stdio-транспорт
- **REPL**: команды `/mcp add|list|remove|tools` — внутри существующего switch-case в REPL
- **SDK**: `@modelcontextprotocol/sdk` — зависимость проекта

---

## Phase 1: Хранение MCP-серверов

**User stories**: 1, 2, 3

### What to build

Полный вертикальный слайс от SQLite до REPL: таблица `mcp_servers` в БД, порт `McpServerRepository`, SQLite-адаптер, и три REPL-команды (`/mcp add`, `/mcp list`, `/mcp remove`). После этой фазы пользователь может регистрировать, просматривать и удалять MCP-серверы.

### Acceptance criteria

- [x] Таблица `mcp_servers` создается при `initDb`
- [x] `/mcp add echo-server bun scripts/echo-server.ts` — сохраняет сервер в SQLite
- [x] `/mcp add` с дублирующимся именем — выводит ошибку
- [x] `/mcp list` — выводит все зарегистрированные серверы (имя, команда, аргументы)
- [x] `/mcp remove echo-server` — удаляет сервер, подтверждает удаление
- [x] `/mcp remove nonexistent` — выводит ошибку
- [x] Unit-тесты репозитория: add, get, getAll, remove, дубликат

---

## Phase 2: Подключение и список инструментов

**User stories**: 4, 5, 6, 7

### What to build

MCP-клиентский сервис, который подключается к зарегистрированному серверу через stdio и получает список инструментов. REPL-команда `/mcp tools <name>`. Тестовый MCP-сервер с 2-3 dummy-инструментами для E2E-тестирования.

### Acceptance criteria

- [x] `@modelcontextprotocol/sdk` установлен как зависимость
- [x] Тестовый MCP-сервер в `scripts/` с инструментами `echo`, `add`, `current_time`
- [x] `McpClientService.listTools(config)` — подключается по stdio, возвращает список `McpTool[]`, закрывает соединение
- [x] `/mcp tools echo-server` — выводит список инструментов в формате `name — description`
- [x] `/mcp tools nonexistent` — выводит ошибку "сервер не найден"
- [x] При ошибке запуска сервера — понятное сообщение (не crash)
- [x] Child process не утекает после получения списка tools (client.close() в finally)
- [x] E2E-тест: запуск тестового сервера -> подключение -> проверка списка tools

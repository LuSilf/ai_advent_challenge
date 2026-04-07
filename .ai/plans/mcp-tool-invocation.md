# Plan: MCP Tool Invocation

> Source PRD: `.ai/prd/mcp-tool-invocation.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **Domain Models**: новые типы `ToolCall` (id, serverName, toolName, arguments), `ToolResult` (callId, content, isError), `ToolWithServer` (McpTool + serverName), `ConnectionStatus` (serverName, status, error?, toolCount?)
- **Именование tools для LLM**: формат `serverName__toolName` (двойное подчёркивание) — Connection Manager маппит обратно при вызове
- **Tool-use mode**: без стриминга. Если в запросе есть tools и LLM вернул function_call — обрабатываем в non-streaming режиме
- **LLM Request расширение**: `LLMRequest` получает опциональное поле `tools` (массив function definitions). `LLMResponse` получает опциональное поле `toolCalls`
- **Tool-use loop лимит**: максимум 10 итераций. При достижении — LLM получает сообщение о лимите
- **MCP транспорт**: только stdio (StdioClientTransport)
- **Retry стратегия**: один retry при транспортной ошибке (переподключение + повторный вызов). Ошибки инструмента передаются LLM как есть

---

## Phase 1: Git Analyzer MCP Server + callTool

**User stories**: 10, 13

### What to build

Создать MCP-сервер `git-analyzer` с тремя инструментами (`git_log`, `git_diff`, `git_file_stats`), каждый из которых выполняет соответствующую git-команду и возвращает результат. Расширить `McpClientService` — добавить возможность открыть постоянное соединение и вызвать инструмент (callTool), не только листать список. Написать интеграционный тест: запустить git-analyzer, подключиться, вызвать каждый инструмент, проверить результат.

### Acceptance criteria

- [ ] Скрипт `scripts/git-analyzer-server.ts` запускается и регистрирует три MCP-инструмента
- [ ] `git_log` принимает `count` (number, default 10) и `author` (string, optional), возвращает форматированные коммиты
- [ ] `git_diff` принимает `target` (string, default "unstaged"), возвращает diff
- [ ] `git_file_stats` без параметров, возвращает статистику файлов по расширениям
- [ ] `McpClientService` поддерживает `connect()` → возвращает живое соединение (client + transport)
- [ ] `McpClientService` поддерживает `callTool(client, toolName, args)` → возвращает результат
- [ ] Интеграционный тест: запуск сервера, вызов всех трёх инструментов, проверка формата результата
- [ ] Существующие тесты `McpClientService` продолжают работать

---

## Phase 2: MCP Connection Manager + автоподключение

**User stories**: 1, 2, 8, 11, 12

### What to build

Создать `McpConnectionManager` — доменный сервис, который управляет пулом MCP-соединений. При вызове `connectAll()` подключается ко всем зарегистрированным серверам, сохраняет статусы. `getAvailableTools()` возвращает агрегированный список инструментов со всех подключённых серверов (с указанием сервера). `disconnectAll()` корректно завершает все соединения. Интегрировать в REPL: при старте сессии — connectAll + вывод статусов, при выходе — disconnectAll. Серверы с ошибкой подключения исключаются из списка tools.

### Acceptance criteria

- [ ] `McpConnectionManager.connectAll()` подключается ко всем серверам из репозитория, возвращает `ConnectionStatus[]`
- [ ] `McpConnectionManager.getAvailableTools()` возвращает `ToolWithServer[]` — tools только от connected-серверов
- [ ] `McpConnectionManager.callTool(serverName, toolName, args)` вызывает инструмент на правильном сервере
- [ ] `McpConnectionManager.disconnectAll()` закрывает все соединения
- [ ] Серверы со статусом `error` не попадают в `getAvailableTools()`
- [ ] REPL при старте выводит статусы подключения (иконки connected/error)
- [ ] REPL при выходе вызывает `disconnectAll()`
- [ ] Тест: подключение к нескольким серверам, агрегация tools, вызов инструмента
- [ ] Тест: один сервер недоступен — остальные работают, ошибочный исключён

---

## Phase 3: LLM Tool-Use — передача tools и парсинг ответа

**User stories**: 3, 14

### What to build

Расширить `LLMRequest` полем `tools` и `LLMResponse` полем `toolCalls`. В `OpenAILLMClient.send()` — если request содержит tools, добавить их в OpenAI Responses API запрос как function tools. Парсить ответ: если модель вернула `function_call` output items — преобразовать в массив `ToolCall`. Добавить новые типы в domain models. Написать тест с моком OpenAI-клиента: отправить запрос с tools, получить tool_call в ответе.

### Acceptance criteria

- [ ] `LLMRequest` имеет опциональное поле `tools` с описанием инструментов (name, description, parameters)
- [ ] `LLMResponse` имеет опциональное поле `toolCalls` — массив `ToolCall`
- [ ] `OpenAILLMClient.send()` передаёт tools в формате OpenAI Responses API
- [ ] `OpenAILLMClient.send()` парсит `function_call` items из ответа в `toolCalls`
- [ ] Если tools не указаны — поведение не меняется (обратная совместимость)
- [ ] Тест: запрос с tools возвращает response с toolCalls

---

## Phase 4: Tool-Use Loop в ChatService

**User stories**: 3, 6, 7, 9

### What to build

Добавить в `ChatService` tool-use loop. Если в `SendMessageOptions` передан `McpConnectionManager` (или его интерфейс) и есть доступные tools — включить их в LLM-запрос. После получения ответа: если LLM вернул toolCalls — вызвать каждый через Connection Manager, собрать результаты, добавить в контекст, отправить повторный запрос LLM. Повторять до текстового ответа или лимита итераций. При ошибке tool call — один retry при транспортной ошибке, иначе передать ошибку LLM. Вызывать callback `onToolCall` для каждого вызова (для отображения в REPL).

### Acceptance criteria

- [ ] ChatService принимает опциональный источник tools и callback `onToolCall`
- [ ] Один tool call → result → финальный текстовый ответ от LLM
- [ ] Цепочка: tool call → result → ещё tool call → result → финальный ответ
- [ ] LLM без tool calls — обычный текстовый ответ (регрессии нет)
- [ ] Ошибка tool call передаётся LLM как error result
- [ ] Лимит итераций (10) — при достижении LLM получает уведомление, даёт финальный ответ
- [ ] Retry при транспортной ошибке (один раз)
- [ ] Callback `onToolCall` вызывается с информацией о каждом tool call и результате
- [ ] Тест с моком LLM + моком Connection Manager: все сценарии выше

---

## Phase 5: Форматированный вывод tool-use в REPL

**User stories**: 4, 5

### What to build

Создать `ToolUseFormatter` — модуль для форматирования плашки tool-use вызова с ANSI-цветами. Интегрировать в REPL через callback `onToolCall` из ChatService. При каждом tool call показывать: имя инструмента, сервер, описание, параметры, разделитель, результат. Использовать picocolors для цветов.

### Acceptance criteria

- [ ] `ToolUseFormatter` форматирует плашку с: именем tool, сервером, описанием, параметрами, результатом
- [ ] Используется picocolors для ANSI-цветов
- [ ] Плашка выводится в REPL при каждом tool call во время беседы
- [ ] При ошибке tool call — плашка показывает ошибку
- [ ] Тест: проверка что вывод содержит все обязательные поля (имя, сервер, описание, параметры, результат)

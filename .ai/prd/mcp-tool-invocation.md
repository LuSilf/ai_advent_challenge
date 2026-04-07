# PRD: MCP Tool Invocation — вызов инструментов через MCP

## Problem Statement

Агент умеет регистрировать MCP-серверы и получать список доступных инструментов (День 16), но не может их вызывать. LLM не знает о существовании инструментов и не может ими воспользоваться. Без реального вызова инструментов MCP-интеграция бесполезна — это каталог без магазина.

## Solution

Реализовать полный цикл tool-use: агент при старте сессии подключается ко всем зарегистрированным MCP-серверам, передаёт список инструментов в LLM, LLM решает какой инструмент вызвать, агент выполняет вызов через MCP, показывает пользователю красивую плашку с информацией о вызове, передаёт результат обратно LLM, и LLM формирует финальный ответ. Дополнительно — реализовать собственный MCP-сервер (git-analyzer) для демонстрации.

## User Stories

1. As a user, I want the agent to automatically connect to all registered MCP servers when a session starts, so that tools are available immediately without manual setup
2. As a user, I want to see connection status of each MCP server (connected/error), so that I know which tools are available
3. As a user, I want the LLM to automatically decide when to use an MCP tool based on my question, so that I don't need to manually invoke tools
4. As a user, I want to see a formatted block when a tool is being called (tool name, server, description, parameters), so that I understand what the agent is doing
5. As a user, I want to see the tool result in the formatted block, so that I can verify the data the agent received
6. As a user, I want the LLM to use the tool result to form a meaningful answer, so that I get a complete response — not raw data
7. As a user, I want the agent to support chain calls (LLM calls tool A, gets result, calls tool B, gets result, then answers), so that complex questions can be resolved
8. As a user, I want tools from multiple MCP servers to be available simultaneously, so that I'm not limited to one server
9. As a user, I want clear error handling when a tool call fails, with a retry if it makes sense, so that transient errors don't break the conversation
10. As a user, I want a git-analyzer MCP server that can show commit history, diffs, and file statistics, so that I can ask the agent questions about my repository
11. As a user, I want the agent to cleanly disconnect from all MCP servers when the session ends, so that child processes don't leak
12. As a user, I want servers that failed to connect at startup to be excluded from the tool list (not passed to LLM), so that the model doesn't try to call unavailable tools
13. As a user, I want to ask questions like "покажи последние 5 коммитов" and get a formatted answer based on git_log tool output, so that the MCP integration feels natural
14. As a user, I want the tool-use flow to work without streaming (simplified), so that the implementation is reliable and debuggable

## Implementation Decisions

### Новые модули

#### 1. Git Analyzer MCP Server

Отдельный скрипт-сервер, реализующий MCP-протокол через stdio. Три инструмента:

- **`git_log`** — последние коммиты. Параметры: `count` (число, default 10), `author` (строка, опционально). Выполняет `git log` с форматированием.
- **`git_diff`** — показать изменения. Параметры: `target` (строка: "staged", "unstaged", или ref вроде "HEAD~3..HEAD"), default "unstaged".
- **`git_file_stats`** — статистика файлов в репо. Без параметров. Возвращает количество файлов по расширениям, общий размер.

Сервер использует `@modelcontextprotocol/sdk` — `McpServer` + `StdioServerTransport`. Выполняет git-команды через child_process.

#### 2. MCP Connection Manager (доменный сервис)

Глубокий модуль, инкапсулирующий всю сложность управления MCP-соединениями за простым интерфейсом:

- `connectAll(): Promise<ConnectionStatus[]>` — подключается ко всем зарегистрированным серверам, возвращает статусы
- `getAvailableTools(): ToolWithServer[]` — все инструменты со всех подключённых серверов (с указанием какому серверу принадлежит каждый)
- `callTool(serverName, toolName, args): Promise<ToolResult>` — вызов конкретного инструмента. При ошибке — один retry с переподключением, если это транспортная ошибка
- `disconnectAll(): Promise<void>` — graceful shutdown всех соединений

Внутри хранит Map<serverName, { client, transport, status, tools }>. Использует `McpClientService` для подключения (расширить его для поддержки keep-alive соединений, убрать автоматический close) и `McpServerRepository` для получения списка серверов.

Статусы соединения: `connected` | `error` | `disconnected`.

#### 3. Tool Use Formatter (презентационный модуль)

Чистая функция для форматирования вызова инструмента в REPL:

```
🔧 Вызов инструмента: git_log
   Сервер: git-analyzer
   Описание: Получить последние коммиты репозитория
   Параметры: { count: 5 }
   ─────────────────
   Результат: <текст результата>
```

Принимает: имя инструмента, имя сервера, описание, параметры, результат (опционально — может быть вызвана дважды: до и после вызова). Возвращает строку с ANSI-цветами (picocolors).

### Модифицируемые модули

#### 4. LLM Client

Расширить для поддержки tool-use через OpenAI Responses API:

- Добавить параметр `tools` в запрос — массив function definitions (name, description, parameters schema)
- Парсить ответ: если модель вернула `function_call` items — вернуть их как часть `LLMResponse`
- Новый тип ответа: LLM может вернуть либо текст, либо один или несколько tool calls
- Не стримить tool-use запросы (упрощение)

#### 5. Chat Service — Tool-Use Loop

Главное изменение. Оркестрация цикла:

1. Собрать tools из Connection Manager → сформировать tools для LLM
2. Отправить запрос LLM с messages + tools
3. Если LLM вернул tool calls:
   a. Для каждого tool call — вывести плашку (formatter), вызвать tool через Connection Manager, вывести результат
   b. Добавить tool results в контекст
   c. Отправить повторный запрос LLM (goto 2)
4. Если LLM вернул текст — это финальный ответ, вернуть его

Максимум итераций цикла — ограничить (например, 10) для защиты от бесконечных вызовов.

#### 6. Domain Models

Новые типы:

- `ToolCall` — { id, serverName, toolName, arguments }
- `ToolResult` — { callId, content, isError }
- `ToolWithServer` — McpTool + serverName
- `ConnectionStatus` — { serverName, status, error?, toolCount? }

#### 7. REPL

- При старте сессии — вызвать `connectionManager.connectAll()`, показать статусы серверов
- При завершении — вызвать `connectionManager.disconnectAll()`
- Показ статусов: список серверов с иконками (подключён/ошибка)
- Передать callback для вывода tool-use плашек в Chat Service (или через event emitter)

### Архитектурные решения

- **Нет стриминга для tool-use**: при наличии tools в запросе используем non-streaming mode. Это упрощение оправдано — tool-use ответы обычно короткие.
- **Retry стратегия**: один retry при транспортной ошибке (переподключение + повторный вызов). Если ошибка в самом инструменте (невалидные параметры и т.д.) — retry не делаем, передаём ошибку LLM.
- **Идентификация инструментов**: tools передаются в LLM с именами в формате `serverName__toolName` для уникальности между серверами. Connection Manager маппит обратно при вызове.
- **MCP Client Service**: расширяется — метод connect возвращает живое соединение (client + transport) вместо автоматического закрытия. Отдельный метод для закрытия.

## Testing Decisions

Хорошие тесты проверяют внешнее поведение модуля через его публичный интерфейс. Не мокаем внутренние детали — тестируем контракты.

### Что тестируем

#### 1. Git Analyzer Server (интеграционный тест)

Запуск реального сервера через stdio, подключение MCP-клиентом, вызов каждого инструмента, проверка результата. По аналогии с существующим `mcp-client-service.test.ts`, но с проверкой callTool вместо listTools.

#### 2. MCP Connection Manager (unit + интеграционный)

- Подключение к одному серверу — статус connected, tools доступны
- Подключение к нескольким серверам — все tools агрегированы
- Сервер недоступен — статус error, его tools исключены
- `callTool` — вызов инструмента, проверка результата
- `callTool` с несуществующим сервером/инструментом — ошибка
- `disconnectAll` — корректное завершение
- Retry при транспортной ошибке

Используем реальный `test-mcp-server.ts` как тестовый сервер.

#### 3. Tool Use Formatter (unit-тест)

Чистая функция — тестируем выходную строку при различных входах. Проверяем наличие имени, описания, параметров, результата в выводе.

#### 4. Chat Service Tool-Use Loop (unit-тест с моком LLM)

Мокаем LLM Client, чтобы он возвращал предсказуемые tool calls. Мокаем Connection Manager, чтобы он возвращал предсказуемые результаты. Проверяем:

- Один tool call → result → финальный ответ
- Цепочка: tool call → result → второй tool call → result → финальный ответ
- LLM не вызвал tools — обычный ответ
- Ошибка tool call — передаётся обратно LLM
- Лимит итераций — не зацикливается

### Prior art

- `src/domain/services/mcp-client-service.test.ts` — паттерн для интеграционных MCP-тестов
- `src/storage/sqlite/*.test.ts` — паттерн для unit-тестов с изолированной БД
- `src/domain/services/task-state-machine.test.ts` — паттерн для тестов чистой логики

## Out of Scope

- SSE/HTTP транспорт MCP — только stdio
- Стриминг ответов при tool-use (упрощение)
- Аутентификация MCP-серверов
- Динамическое добавление/удаление серверов без перезапуска сессии (добавил сервер — нужно `/mcp reconnect` или новая сессия)
- Tool-use в контексте task phase system (инструменты доступны во всех фазах одинаково)
- Кеширование результатов tool calls
- Rate limiting вызовов инструментов
- Параллельный вызов нескольких инструментов (вызываем последовательно)

## Further Notes

- OpenAI Responses API формат для tools: `{ type: "function", name, description, parameters }`. Tool calls приходят как output items с `type: "function_call"`.
- Формат `serverName__toolName` (двойное подчёркивание) выбран как разделитель, потому что одинарное подчёркивание часто встречается в именах инструментов.
- Лимит итераций tool-use loop (10) — защита от бесконечных циклов. При достижении лимита — LLM получает сообщение "лимит вызовов достигнут" и должен дать финальный ответ.
- Git Analyzer сервер выполняет git-команды в cwd процесса. При регистрации можно указать cwd, чтобы работать с конкретным репозиторием.

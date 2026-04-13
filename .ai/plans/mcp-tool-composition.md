# Plan: Композиция MCP-инструментов

> Source PRD: `.ai/prd/mcp-tool-composition.md`

## Architectural decisions

- **Серверы**: три отдельных MCP-сервера в `scripts/mcp-servers/`, каждый — самостоятельный процесс через `McpServer` + `StdioServerTransport`
- **Именование серверов**: `github-search`, `summarize`, `save-to-file`
- **Паттерн серверов**: идентичен `git-analyzer-server.ts` — Zod-схемы, `Bun.spawn()` для child-процессов, формат ответа `{ content: [{ type: "text", text }] }`
- **GitHub-данные**: `gh` CLI с фоллбэком на REST API (`fetch`), без токена (60 req/h)
- **LLM в summarize**: прямой `fetch` на OpenAI-совместимый Chat Completions endpoint, без SDK. Env-переменные: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`
- **Оркестрация**: существующий `ChatService.sendWithToolLoop()` — без изменений в логике, только увеличение `maxToolRounds`
- **Тесты**: `bun:test`, паттерн из `mcp-client-service.test.ts` — запуск реального сервера через McpClientService, вызов инструментов, проверка формата ответа

---

## Phase 1: GitHub Search Server

**User stories**: 1, 2, 3, 4, 5, 14, 15

### What to build

MCP-сервер `github-search` с двумя инструментами: `search_pulls` и `search_issues`. Сервер принимает параметры `repo` (owner/repo), `count`, и для pulls — `state` (closed/merged). Возвращает JSON-массив с данными PR/issues включая top-3 комментариев.

Стратегия получения данных: проверить наличие `gh` CLI, если есть — использовать `gh pr list` / `gh issue list` + `gh api` для комментариев. Если `gh` недоступен — фоллбэк на `fetch` к GitHub REST API.

Тесты: запустить сервер через McpClientService, вызвать оба инструмента с mock-данными (подменить функцию выполнения команд), проверить формат и структуру ответа. Отдельный тест на ошибку (несуществующий репозиторий).

После завершения фазы: зарегистрировать сервер через `/mcp add`, попросить LLM «покажи последние 3 PR в spring-projects/spring-boot» — должен вернуть данные.

### Acceptance criteria

- [ ] Файл `scripts/mcp-servers/search.ts` реализует MCP-сервер с двумя инструментами
- [ ] `search_pulls` возвращает JSON с полями: number, title, body, url, author, labels, merged_at/closed_at, comments[]
- [ ] `search_issues` возвращает JSON с полями: number, title, body, url, author, labels, closed_at, comments[]
- [ ] Комментарии — top-3 по дате, каждый с author и body
- [ ] `gh` CLI используется если доступен, иначе REST API через fetch
- [ ] Параметр `count` управляет количеством результатов (default 5)
- [ ] Параметр `state` для pulls: `closed` или `merged` (default `closed`)
- [ ] При ошибке (несуществующий репо, сетевая ошибка) — MCP-ответ с текстом ошибки, не crash сервера
- [ ] Unit-тесты проходят: формат ответа, обработка ошибок
- [ ] Сервер регистрируется через `/mcp add` и инструменты появляются в списке

---

## Phase 2: Summarize Server

**User stories**: 6, 7, 15

### What to build

MCP-сервер `summarize` с одним инструментом `summarize`. Принимает `text` (обязательный) и `context` (опциональный, например "GitHub Pull Request #12345"). Внутри вызывает LLM через прямой `fetch` на Chat Completions endpoint — system prompt требует лаконичное содержание на русском (2-4 предложения).

Env-переменные читаются из окружения процесса: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`. Входной текст обрезается если превышает разумный лимит (например 12000 символов), чтобы не упереться в контекстное окно.

Тесты: запустить сервер через McpClientService, вызвать `summarize` с mock LLM (подменить fetch), проверить что результат пробрасывается корректно. Тест на пустой текст — должен вернуть ошибку.

После завершения: попросить LLM суммаризировать один PR — он вызовет `search_pulls`, затем `summarize`.

### Acceptance criteria

- [ ] Файл `scripts/mcp-servers/summarize.ts` реализует MCP-сервер с инструментом `summarize`
- [ ] Инструмент принимает `text` (string, обязательный) и `context` (string, опциональный)
- [ ] Внутри вызывает OpenAI-совместимый Chat Completions API через `fetch`
- [ ] System prompt требует краткое содержание на русском, 2-4 предложения
- [ ] Длинный входной текст обрезается до безопасного лимита
- [ ] При ошибке LLM — возвращает MCP-ответ с текстом ошибки
- [ ] Unit-тесты проходят: корректная суммаризация (mock LLM), обработка ошибок
- [ ] Сервер регистрируется и работает совместно с github-search

---

## Phase 3: Save-to-File Server

**User stories**: 8, 9, 15

### What to build

MCP-сервер `save-to-file` с одним инструментом `save_to_file`. Принимает `filename` (string) и `content` (string, Markdown). Записывает файл в `process.cwd()`. Валидация: filename не содержит `..` и `/` — только имя файла.

Тесты: вызвать инструмент, проверить что файл создан с правильным содержимым. Тест безопасности: filename с `..` или `/` — должен быть отклонён. Cleanup: удалить созданные файлы.

После завершения: все три сервера зарегистрированы, можно попросить LLM найти PR, суммаризировать и сохранить.

### Acceptance criteria

- [ ] Файл `scripts/mcp-servers/save-to-file.ts` реализует MCP-сервер с инструментом `save_to_file`
- [ ] Принимает `filename` (string) и `content` (string)
- [ ] Записывает файл в `process.cwd()`
- [ ] Возвращает подтверждение с абсолютным путём файла
- [ ] Filename с `..` или `/` отклоняется с понятной ошибкой
- [ ] Unit-тесты проходят: создание файла, валидация filename, cleanup
- [ ] Сервер регистрируется и работает совместно с остальными

---

## Phase 4: Интеграция и E2E

**User stories**: 10, 11, 12, 13, 16

### What to build

Увеличить `DEFAULT_MAX_TOOL_ROUNDS` в ChatService до 20, чтобы полная цепочка (1 search + N summarize + 1 save) укладывалась в лимит.

Провести полное e2e тестирование на реальном репозитории spring-boot:

1. Зарегистрировать все три сервера
2. Попросить LLM: «Найди последние 3 вмердженных PR в spring-projects/spring-boot, суммаризируй каждый и сохрани в файл»
3. Убедиться: LLM вызывает search_pulls → summarize × 3 → save_to_file
4. Проверить Markdown-файл: структура, номера PR, ссылки, суммари

Дополнительные сценарии: только поиск без суммаризации, только issues, ошибка с несуществующим репо.

Написать тест-сценарий в `.ai/test-scenario-mcp-composition.md`.

### Acceptance criteria

- [ ] `DEFAULT_MAX_TOOL_ROUNDS` увеличен до 20
- [ ] E2E: полная цепочка search → summarize × N → save работает на spring-boot
- [ ] E2E: частичная цепочка (только search) работает
- [ ] E2E: tool call плашки отображаются в REPL на каждом шаге
- [ ] E2E: Markdown-файл содержит структурированные суммари с номерами и ссылками
- [ ] E2E: ошибка в search (несуществующий репо) не крашит агента
- [ ] Тест-сценарий задокументирован в `.ai/test-scenario-mcp-composition.md`
- [ ] Нет утечек процессов после завершения сессии

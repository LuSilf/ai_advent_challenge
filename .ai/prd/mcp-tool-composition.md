# PRD: Композиция MCP-инструментов — пайплайн search → summarize → saveToFile

## Problem Statement

Агент умеет вызывать MCP-инструменты по одному (День 17), но все инструменты живут в одном сервере (git-analyzer). В реальном мире инструменты распределены по разным серверам, каждый отвечает за свою зону ответственности. Нет демонстрации того, как LLM оркестрирует цепочку из нескольких инструментов разных серверов, передавая данные между шагами.

Пользователь не может попросить агента «найди последние 3 вмердженных PR в spring-boot, суммаризируй каждый и сохрани в файл» — для этого нужна композиция: один сервер ищет, другой суммаризирует, третий сохраняет.

## Solution

Реализовать три отдельных MCP-сервера, каждый с чёткой зоной ответственности:

1. **GitHub Search Server** — два инструмента (`search_pulls`, `search_issues`), получающих данные из GitHub через `gh` CLI с фоллбэком на REST API. Возвращает PR/issues с комментариями.

2. **Summarize Server** — инструмент `summarize`, который принимает текст и возвращает краткое содержание. Внутри сам вызывает LLM (OpenAI-совместимый API) — это настоящая суммаризация, а не заглушка.

3. **Save-to-File Server** — инструмент `save_to_file`, который сохраняет контент в Markdown-файл в текущей директории.

LLM-оркестратор (существующий ChatService с tool-use loop) сам решает какие инструменты вызвать и в каком порядке, исходя из запроса пользователя. Пайплайн не жёсткий — LLM может вызвать только search, или search + summarize без сохранения, или полную цепочку.

После реализации — провести e2e тестирование: зарегистрировать все три сервера, попросить LLM суммаризировать PR/issues из https://github.com/spring-projects/spring-boot и убедиться, что цепочка работает от начала до конца.

## User Stories

1. As a user, I want to ask the agent "покажи последние 5 закрытых PR в spring-boot" and get structured data from GitHub, so that I can review project activity through the agent
2. As a user, I want to ask for closed issues from any public GitHub repository, so that I'm not limited to one project
3. As a user, I want to see PR data with top-3 comments included, so that the summarization captures the discussion context
4. As a user, I want to configure how many PRs/issues to fetch (e.g. "последние 3 PR"), so that I control the volume of data
5. As a user, I want the search to work via `gh` CLI when available, falling back to GitHub REST API, so that it works regardless of my local setup
6. As a user, I want each PR/issue to be summarized individually by the LLM, so that summaries are focused and detailed rather than a generic overview
7. As a user, I want the summarize tool to produce concise Russian-language summaries, so that the output is immediately useful without extra translation
8. As a user, I want the agent to save all summaries into a single Markdown file in the current directory, so that I have a persistent artifact of the analysis
9. As a user, I want the Markdown file to have clear structure — заголовки, номера PR/issues, ссылки, so that the file is navigable
10. As a user, I want the agent to automatically chain search → summarize → save when I ask "суммаризируй и сохрани последние 3 PR из spring-boot", so that I don't need to invoke each step manually
11. As a user, I want to be able to ask only for search without summarization, so that I can get raw data when I need it
12. As a user, I want to be able to ask for summarization without saving to file, so that I can review summaries in chat before committing to a file
13. As a user, I want to see tool call notifications in the REPL as each step of the pipeline executes, so that I understand what the agent is doing
14. As a user, I want errors in one step (e.g. GitHub rate limit) to be reported clearly without crashing the entire pipeline, so that I can retry or adjust
15. As a user, I want the three MCP servers to be registered independently, so that I can use them in any combination
16. As a user, I want to run an e2e test against a real GitHub repository (spring-boot), asking the LLM to fetch, summarize, and save PR/issues, so that the full pipeline is verified end-to-end

## Implementation Decisions

### Три новых MCP-сервера

Размещаются в `scripts/mcp-servers/`. Каждый — самостоятельный скрипт, запускаемый через `bun run`.

#### 1. GitHub Search Server (`search.ts`)

Имя сервера: `github-search`, версия `1.0.0`.

**Инструменты:**

- **`search_pulls`** — поиск закрытых/вмердженных PR.
  - Параметры: `repo` (string, обязательный, формат `owner/repo`), `count` (number, default 5), `state` (enum: `closed` | `merged`, default `closed`)
  - Возвращает: JSON-массив объектов `{ number, title, body, url, author, labels, merged_at/closed_at, comments: [{ author, body }] }`
  - Комментарии: top-3 по дате создания

- **`search_issues`** — поиск закрытых issues.
  - Параметры: `repo` (string, обязательный), `count` (number, default 5)
  - Возвращает: аналогичный JSON с `{ number, title, body, url, author, labels, closed_at, comments: [{ author, body }] }`

**Стратегия получения данных:**

1. Проверить наличие `gh` CLI (`which gh` или `gh --version`)
2. Если `gh` доступен — использовать `gh pr list --repo <repo> --state closed --limit <count> --json number,title,body,url,author,labels,mergedAt,closedAt` и аналогично для issues
3. Для комментариев: `gh api repos/<repo>/issues/<number>/comments --jq '.[0:3]'`
4. Если `gh` недоступен — фоллбэк на `fetch('https://api.github.com/repos/<repo>/pulls?state=closed&per_page=<count>')` и аналогично для комментариев
5. Без токена: rate limit 60 req/h, достаточно для демо (5 PR + 5 issues + комментарии ≈ 15 запросов)

#### 2. Summarize Server (`summarize.ts`)

Имя сервера: `summarize`, версия `1.0.0`.

**Инструменты:**

- **`summarize`** — суммаризация произвольного текста.
  - Параметры: `text` (string, обязательный — текст для суммаризации), `context` (string, опциональный — контекст, например "GitHub Pull Request #12345")
  - Возвращает: краткое содержание на русском языке

**Реализация LLM-вызова:**

- Читает `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` из environment (те же переменные, что у основного агента)
- Использует OpenAI-совместимый API напрямую через `fetch()` (Chat Completions endpoint), без тяжёлого SDK
- System prompt: «Ты — суммаризатор. Получаешь текст и возвращаешь краткое содержание на русском языке. Будь лаконичен: 2-4 предложения.»
- Не использует `openai` SDK — чтобы сервер был лёгким и самодостаточным

#### 3. Save-to-File Server (`save-to-file.ts`)

Имя сервера: `save-to-file`, версия `1.0.0`.

**Инструменты:**

- **`save_to_file`** — сохранение контента в файл.
  - Параметры: `filename` (string, обязательный), `content` (string, обязательный — Markdown-контент)
  - Возвращает: подтверждение с абсолютным путём сохранённого файла
  - Записывает в `process.cwd()` — текущую рабочую директорию сервера
  - Валидация: filename не должен содержать `..` или `/` (только имя файла, без вложенных путей)

### Паттерны, заимствованные из существующего кода

- Все серверы используют `McpServer` + `StdioServerTransport` из `@modelcontextprotocol/sdk` (как git-analyzer-server)
- Параметры валидируются через Zod-схемы
- Формат ответа: `{ content: [{ type: "text", text }] }`
- Child-процессы (git-analyzer) запускаются через `Bun.spawn()`

### Регистрация серверов

Серверы регистрируются через существующий `/mcp add`:
```
/mcp add github-search bun run scripts/mcp-servers/search.ts
/mcp add summarize bun run scripts/mcp-servers/summarize.ts
/mcp add save-to-file bun run scripts/mcp-servers/save-to-file.ts
```

Никаких изменений в McpConnectionManager, ChatService или REPL не требуется — существующая инфраструктура дней 16-17 обеспечивает всё необходимое.

### Передача данных между инструментами

Данные передаются через LLM-оркестратор. Типичный сценарий (пользователь: «суммаризируй последние 3 PR в spring-boot и сохрани в файл»):

1. LLM вызывает `github-search__search_pulls({ repo: "spring-projects/spring-boot", count: 3 })`
2. Получает JSON с 3 PR + комментариями
3. Для каждого PR вызывает `summarize__summarize({ text: "<PR data>", context: "GitHub Pull Request #XXXXX" })`
4. Собирает все суммари
5. Вызывает `save-to-file__save_to_file({ filename: "spring-boot-summary.md", content: "<markdown>" })`
6. Формирует финальный ответ пользователю

Каждый вызов summarize — это отдельный вызов LLM внутри summarize-сервера. LLM-оркестратор видит каждый вызов как отдельный tool call.

### Ограничение по раундам tool-use

Текущий `maxToolRounds = 10`. Для полной цепочки (1 search + 5 summarize + 1 save = 7 вызовов) этого достаточно. Но при 5 PR + 5 issues + 10 summarize + 1 save = 12 — не хватит. Нужно либо увеличить лимит, либо пользователь должен запрашивать PR и issues отдельно.

Решение: увеличить `maxToolRounds` до 20 по умолчанию или сделать его конфигурируемым через опции SendMessageOptions (уже поддерживается).

## Testing Decisions

### Хороший тест

Хороший тест проверяет внешнее поведение модуля, а не детали реализации. Для MCP-серверов это означает: запустить сервер, вызвать инструмент с конкретными параметрами, проверить формат и содержание ответа. Не проверять внутреннюю логику парсинга или формирования запросов.

### Unit-тесты на каждый сервер

Аналогично существующим тестам в `mcp-client-service.test.ts` и `mcp-connection-manager.test.ts`.

#### GitHub Search Server

- Тест `search_pulls`: вызвать инструмент с mock-репозиторием, проверить формат JSON-ответа (наличие полей number, title, body, url, comments)
- Тест `search_issues`: аналогично
- Тест ошибки: несуществующий репозиторий, проверить что возвращается `isError: true` с понятным сообщением
- Mock: переопределить функцию выполнения команд, чтобы не ходить в реальный GitHub

#### Summarize Server

- Тест `summarize`: вызвать с известным текстом, проверить что ответ непустой и содержит текст
- Mock: подменить LLM-вызов (mock fetch), вернуть фиксированный ответ, проверить что он корректно пробрасывается
- Тест ошибки: пустой текст, недоступный LLM

#### Save-to-File Server

- Тест `save_to_file`: вызвать с filename и content, проверить что файл создан с правильным содержимым
- Тест безопасности: filename с `..` или `/` должен быть отклонён
- Cleanup: удалить созданные файлы после теста

### E2E тест-сценарий (ручной)

Полноценное end-to-end тестирование с реальными данными. Выполняется вручную через REPL.

**Предусловия:**
- `gh` CLI установлен (через mise)
- Все три сервера зарегистрированы через `/mcp add`
- Доступ к интернету (GitHub API)

**Сценарий 1: Полная цепочка — PR**
1. Ввести: «Найди последние 3 вмердженных PR в spring-projects/spring-boot, суммаризируй каждый и сохрани в файл»
2. Ожидание: LLM вызывает `search_pulls` → получает 3 PR с комментариями → вызывает `summarize` 3 раза → вызывает `save_to_file`
3. Проверить: файл создан в текущей директории, содержит 3 суммари с номерами PR и ссылками

**Сценарий 2: Полная цепочка — Issues**
1. Ввести: «Покажи последние 3 закрытых issue в spring-projects/spring-boot, суммаризируй и сохрани»
2. Ожидание: аналогичная цепочка через `search_issues`

**Сценарий 3: Частичная цепочка — только поиск**
1. Ввести: «Покажи последние 2 вмердженных PR в spring-projects/spring-boot»
2. Ожидание: LLM вызывает только `search_pulls`, показывает данные в чате без суммаризации и сохранения

**Сценарий 4: Ошибка — несуществующий репозиторий**
1. Ввести: «Найди PR в nonexistent/repo»
2. Ожидание: LLM получает ошибку от search, сообщает пользователю

**Критерии успеха:**
- Все tool call плашки отображаются в REPL
- Данные корректно передаются между инструментами (результат search → вход summarize → вход save_to_file)
- Markdown-файл содержит структурированные суммари
- Нет утечек процессов после завершения

## Out of Scope

- Аутентификация GitHub (токены) — работаем без токена, 60 req/h достаточно для демо
- Кэширование результатов GitHub API — каждый запрос идёт в API напрямую
- Параллельный вызов summarize (LLM вызывает их последовательно в рамках tool-use loop)
- Web UI или визуализация пайплайна — только REPL
- Поддержка других VCS (GitLab, Bitbucket) — только GitHub
- Streaming в tool-use режиме — остаётся non-streaming как в дне 17
- Декларативные (hardcoded) пайплайны — только LLM-оркестрация

## Further Notes

- `gh` CLI установлен через mise — при тестировании убедиться, что mise shim доступен в PATH для child-процесса MCP-сервера (может потребоваться полный путь к `gh`)
- Spring-boot — очень активный проект, PR и issues могут содержать длинные body/комментарии. Summarize-сервер должен обрезать входной текст при необходимости, чтобы не превысить контекстное окно LLM
- При 10 вызовах summarize (5 PR + 5 issues) стоимость на gpt-4o-mini минимальна (~$0.01), но на более дорогих моделях может быть заметна
- Все три сервера переиспользуют паттерны git-analyzer-server: McpServer + StdioServerTransport + Zod + Bun.spawn

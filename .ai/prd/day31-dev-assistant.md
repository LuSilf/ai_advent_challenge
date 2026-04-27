# Day 31 — Ассистент разработчика: RAG по проекту + MCP git-tools + /help REPL

## Problem Statement

К концу 30-го дня у меня в репе лежит впечатляющий стек: индексация документов (day21), RAG с reranker'ом (day23), цитирование (day24), мини-чат с памятью (day25), локальная LLM (day27), local RAG (day28), retrieval-gating refusal (day29), приватный HTTP-сервис над Ollama с web-UI (day30). Но когда я **сам** хочу что-то узнать про **этот же** проект — нет ни одного интерфейса, который бы это умел.

Конкретные боли:

- Когда я возвращаюсь к проекту после нескольких дней перерыва, я не помню, что в нём уже есть. Реальный сценарий: «у меня же был reranker в day23 — где он лежит и как называется класс?» — и я открываю IDE, делаю ripgrep, читаю файлы. Вместо того, чтобы спросить «где в проекте rерanker?» и получить ссылку на `src/domain/services/llm-reranker-service.ts`. У меня есть RAG-движок, но нет ни одного интерфейса, который натравил бы его на **сам репозиторий**.
- 17 PRD и 17 планов в `.ai/` фиксируют design decisions проекта — но прочитать их можно только глазами. Когда я смотрю на проект через месяц, я не помню, почему `LLM_SERVICE_MAX_INPUT_TOKENS=6000`, а не 8000 — это решение зафиксировано в day30 PRD, но достать его без grep'а нельзя. Памяти проекту не хватает не на хранение данных, а на **их retrieval по вопросу разработчика**.
- Когда я отвечаю на вопросы о проекте кому-то другому (или себе через неделю), мне нужен «второй мозг», который читает мой код и доки и отвечает по ним. Готовые тулы (Cursor, Claude Code) для этого подходят, но они не интегрированы с локальной LLM-инфраструктурой, которую я сам построил — это значит, что я не использую *свой собственный* RAG в *своём собственном* workflow. Сапожник без сапог.
- В проекте есть MCP-инфраструктура (`MCPClientService`, `MCPConnectionManager` из day23-25), но она использовалась только для еxternal MCP-серверов в тестах. Никогда — для project-aware tools (git status, ветка, diff). Это значит, что у LLM нет доступа к «состоянию здесь и сейчас»: какая ветка, что я сейчас делаю, что я только что закоммитил. Без этого ассистент отвечает абстрактно, не «вы сейчас на ветке day31-dev-assistant-rag, недавно был merge day30».
- Нет ни одной точки входа, где RAG, LLM, MCP-tools и project-context соединяются в один интерфейс. Это критическая дыра — все компоненты есть, intgrated не в одном месте.

В итоге: у меня есть всё для AI-ассистента разработчика, но **самого ассистента — нет**. Это значит, что построенный за 30 дней стек я фактически не применяю к собственному развитию.

## Solution

Делаем CLI REPL `bun run assistant` — интерактивная среда, в которой я задаю вопросы про **этот** проект и получаю ответы, опирающиеся на (a) индекс документации и кода, (b) MCP-инструменты для git, (c) tool-use LLM, (d) цитаты с файлами и строками.

Конкретно:

1. **REPL CLI как интерфейс.** Команда `bun run assistant` запускает интерактивный prompt в терминале (по канону `--day25` chat-режима из main.ts). Пользователь печатает slash-команды:
   - `/help <вопрос>` — основная: ассистент идёт в RAG, при необходимости вызывает MCP-tools, отвечает с цитатами.
   - `/reindex` — пересборка индекса проектной документации.
   - `/tools` — выводит список доступных MCP-инструментов с описанием.
   - `/clear` — сбрасывает диалог-историю текущей сессии.
   - `/quit` или `/exit` — выход.
   Никаких ASCII-фреймворков (blessed/inquirer), просто `process.stdin` line-by-line и `console.log` с цветами через `picocolors`. Один процесс, простая state-machine.

2. **RAG-индекс по документации и коду проекта.** Отдельный SQLite-файл `data/project-docs.db`, схема — переиспользует уже работающий vector-index стек (`SqliteVectorIndex`, `OllamaEmbedder` с `nomic-embed-text`/dim=768). Источники, попадающие в индекс:
   - `README.md` и `spring-boot-summary.md` (корневые .md);
   - все `src/**/*.ts`, кроме `*.test.ts` и `*.d.ts`.
   Стратегия чанкинга — per-type:
   - `.md` → `StructuralMarkdownChunker` (по заголовкам H2/H3, max 2000 chars);
   - `.ts` → `FixedSizeChunker` (1500 chars, overlap 200).
   Индексация — отдельная команда `bun run assistant:reindex` (и slash-команда `/reindex` в REPL делегирует ту же логику). Без auto-watcher'а: если разработчик хочет, чтобы индекс был свежим, он явно перестраивает. Полная пересборка (drop-and-reload), incremental hash-based — out of scope.

3. **MCP-сервер с git-tools.** Standalone stdio-сервер `scripts/day31/mcp-server.ts`, написанный на `@modelcontextprotocol/sdk` (по канону `scripts/mcp-servers/search.ts`). Tools:
   - `git_branch()` — возвращает имя текущей ветки.
   - `git_status()` — краткий список изменённых/untracked файлов (porcelain).
   - `git_log(limit?: number)` — последние N коммитов (по умолчанию 10), формат `hash subject author date`.
   - `git_diff(path?: string)` — diff незакоммиченных изменений; если задан path — diff одного файла.
   - `list_files(pattern: string)` — листинг файлов по glob-паттерну (через bun's `Glob`), c hardcoded ignore-листом `node_modules/**`, `.git/**`, `data/**`, `*.lock`.
   Все shell-вызовы — через инжектируемый `ShellExecutor` (для тестов мокается). Ассистент сам запускает MCP-сервер как child-процесс через `StdioClientTransport` и вызывает tools по протоколу MCP — не через прямой импорт.

4. **Tool-use через function-calling.** Ассистент передаёт схемы MCP-tools в `chat.completions` через поле `tools[]` (OpenAI-совместимый формат). LLM сама решает, нужно ли вызвать tool, и если да — какой и с какими аргументами. Цикл: первый запрос → LLM может вернуть `tool_calls` → ассистент исполняет каждый call через MCP, добавляет `tool` сообщения в диалог → второй запрос → финальный ответ. Цикл ограничен 5 итерациями, чтобы LLM не зацикливалась.

5. **Backend LLM настраивается через env.** Префикс `ASSISTANT_LLM_*`:
   - `ASSISTANT_LLM_BASE_URL` (например `http://localhost:8080/v1` для day30 service, или OpenAI URL).
   - `ASSISTANT_LLM_API_KEY`.
   - `ASSISTANT_LLM_MODEL` (по умолчанию `qwen2.5-coder:7b` — он умеет tool-use и хорош на коде).
   Без fallback на `OPENAI_*` — ассистент и `bot.ts`/`main.ts` могут смотреть в разные backend'ы (например, бот в OpenAI cloud, ассистент в свой локальный day30).

6. **Streaming ответа в REPL.** Финальный ответ от LLM (после tool-loop) идёт через streaming `chat.completions` и печатается в terminal токен за токеном. Tool-call'ы в логе обозначаются маркерами `→ git_branch()` / `← master\n` для прозрачности — пользователь видит, какие tools были вызваны.

7. **Цитирование как в day24.** Ответ LLM просят формировать с inline-цитатами вида `[1]`, `[2]`, а в конце сообщения — список источников: `[1] README.md:42-58`, `[2] src/db.ts:120-145`. Для этого retrieval возвращает не только текст чанка, но и `{file_path, line_start, line_end}`. Используется существующая модель `CitedRagResponse` (доменная модель из day24).

8. **Retrieval параметры.** `top-K=5`, без reranker'а, без gating. Это сознательный минимализм: для Q&A по 30-50 файлам своего же проекта top-5 уже выдаёт релевантный контекст, а LLM-reranker (day23) и refusal (day29) — это фичи следующих итераций, если выявится плохое качество.

9. **In-process диалог-история.** История чата живёт только в RAM текущей REPL-сессии. `/clear` сбрасывает. `/quit` — теряется. Никакого SQLite-message-repository (в отличие от day25). Причина: ассистент не задумывается как «помнящий собеседник», это инструмент Q&A — каждый /help почти всегда самодостаточен. Если потребуется continuation — пользователь повторит контекст в следующем вопросе.

10. **Layout — по канону layered architecture.**
    - `src/assistant.ts` — entry-point, как `src/bot.ts`/`src/server.ts`.
    - `src/presentation/repl/` — REPL-loop, парсер slash-команд, печать.
    - `src/domain/services/docs-indexer.ts` — DocsIndexer (deep).
    - `src/domain/services/assistant-orchestrator.ts` — AssistantOrchestrator (deep).
    - `src/domain/services/assistant-config.ts` — loadAssistantConfig (deep, по аналогии с server-config day30).
    - `scripts/day31/mcp-server.ts` — MCP-сервер.

11. **Тесты — Red-Green на все deep-модули.** DocsIndexer, AssistantConfig, AssistantOrchestrator, и каждый MCP-tool отдельно (с инжектированным ShellExecutor). Wiring REPL и MCP-сервер сами по себе не тестируются юнитами — проверяются вручную smoke-сценарием.

## User Stories

1. Как разработчик проекта, я хочу запустить `bun run assistant` и попасть в REPL prompt, чтобы за одну команду открыть интерактивную среду для вопросов про проект.
2. Как разработчик, я хочу, чтобы при первом запуске (если индекс пуст) ассистент явно подсказал «индекс пуст, выполните /reindex», чтобы я понял, что сначала нужно построить индекс, а не получил тихий пустой ответ.
3. Как разработчик, я хочу выполнить `/reindex` и увидеть, как идёт прогресс по файлам (`indexed README.md (3 chunks), indexed src/main.ts (5 chunks)…`), чтобы понимать, что процесс идёт, и заметить ошибку, если файл не читается.
4. Как разработчик, я хочу, чтобы `/reindex` создавал/перезаписывал `data/project-docs.db`, не трогая `data/history.db`, чтобы индексы day21-29 и история чатов остались нетронутыми.
5. Как разработчик, я хочу, чтобы команда `bun run assistant:reindex` (вне REPL) делала ровно то же самое, что `/reindex` — чтобы можно было перестроить индекс из CI/cron, не запуская REPL.
6. Как разработчик, я хочу спросить `/help как устроен RAG-pipeline в проекте?` — и получить ответ, в котором упомянуты `RagPipelineService` и `IndexingService` с цитатами на конкретные файлы и строки, чтобы быстро прыгнуть в нужный код.
7. Как разработчик, я хочу спросить `/help какие env-переменные нужны для day30 сервиса?` — и получить список (`LLM_SERVICE_API_KEYS`, `LLM_SERVICE_PORT`, …) с цитатой на `.env.example` и/или PRD, чтобы сразу применить.
8. Как разработчик, я хочу спросить `/help на какой я ветке сейчас?` — и чтобы LLM вызвала `git_branch()` через MCP и ответила «вы на `day31-dev-assistant-rag`», чтобы убедиться, что MCP реально работает.
9. Как разработчик, я хочу спросить `/help что у меня в незакоммиченных изменениях?` — и чтобы LLM вызвала `git_status()` и/или `git_diff()` и пересказала diff человеческим языком, чтобы получить summary без открытия терминала.
10. Как разработчик, я хочу спросить `/help какие последние 5 коммитов?` — и чтобы LLM вызвала `git_log(limit=5)` и отрисовала их с описанием каждого, чтобы быстро вспомнить, что сделано недавно.
11. Как разработчик, я хочу спросить `/help найди мне все .test.ts в src/domain/services` — и чтобы LLM вызвала `list_files("src/domain/services/**/*.test.ts")` и вернула список, чтобы быстро навигировать по тестам.
12. Как разработчик, я хочу видеть в выводе REPL маркеры вызовов tools (`→ git_branch()` / `← day31-dev-assistant-rag`), чтобы было прозрачно, какие данные ассистент использовал.
13. Как разработчик, я хочу, чтобы финальный ответ ассистента стримился в терминал по мере генерации, чтобы UX был «как в ChatGPT-CLI», а не «зависание → стена текста».
14. Как разработчик, я хочу, чтобы ответ содержал inline-цитаты `[1]`, `[2]` с финальным списком источников вида `[1] README.md:42-58`, чтобы я мог сразу открыть файл на нужной строке.
15. Как разработчик, я хочу, чтобы LLM не галлюцинировала несуществующие файлы — если ответ ссылается на `src/foo.ts`, этот файл реально лежит в индексе. Это обеспечивается дисциплиной «отвечай только на основе контекста» в system-промпте + цитатами, которые шерifиклирует пользователь.
16. Как разработчик, я хочу выполнить `/tools` — и увидеть список доступных MCP-инструментов с их описаниями (`git_branch — текущая ветка`, …), чтобы понимать, какие capabilities у ассистента.
17. Как разработчик, я хочу выполнить `/clear` — и продолжить REPL с чистой dialog-историей (но индекс и MCP-подключение сохранятся), чтобы начать новую тему без перезапуска.
18. Как разработчик, я хочу выполнить `/quit` или `/exit` — и чтобы REPL корректно закрыл MCP-child-процесс и SQLite-соединения, чтобы не остались зомби-процессы.
19. Как разработчик, я хочу, чтобы Ctrl+C в REPL делал то же самое, что `/quit` — graceful shutdown, чтобы привычная горячая клавиша работала.
20. Как разработчик, я хочу указать в `.env`: `ASSISTANT_LLM_BASE_URL=http://localhost:8080/v1`, `ASSISTANT_LLM_API_KEY=...`, `ASSISTANT_LLM_MODEL=qwen2.5-coder:7b` — и ассистент использовал день-30 сервис как backend, чтобы замкнуть свою же инфраструктуру.
21. Как разработчик, я хочу, чтобы при отсутствии хотя бы одной из обязательных env (`ASSISTANT_LLM_BASE_URL`, `ASSISTANT_LLM_API_KEY`, `ASSISTANT_LLM_MODEL`) ассистент падал с понятным сообщением «set ASSISTANT_LLM_MODEL in .env», а не молча работал на каких-то дефолтах.
22. Как разработчик, я хочу настроить через env лимит итераций tool-loop (`ASSISTANT_TOOL_LOOP_MAX`, дефолт 5), чтобы при необходимости поднять/опустить, не пересобирая.
23. Как разработчик, я хочу, чтобы tool-loop ограничивал глубину вызовов (если LLM уже 5 раз вызвала tools — ассистент принудительно завершает с финальным ответом), чтобы не было зацикливания и run-away costs.
24. Как разработчик, я хочу, чтобы при вопросе, на который retrieval не нашёл релевантного контекста (top-5 score ниже порога), ассистент честно отвечал «не нашёл в документации, могу попробовать ответить по общим знаниям» — а не выдумывал по проекту, чтобы не поверить ошибочной информации. (Лёгкий gating — порог сравнения, без полноценного refusal-policy day29.)
25. Как разработчик, я хочу, чтобы DocsIndexer корректно игнорировал `node_modules/**`, `.git/**`, `data/**`, `*.lock`, `*.test.ts`, `*.d.ts`, чтобы в индекс не утекли тысячи зависимостей, бинарные файлы или тестовые фикстуры.
26. Как разработчик, я хочу, чтобы DocsIndexer применял правильный chunker по расширению (`.md` → structural, `.ts` → fixed), чтобы markdown-разделы не рвались посередине, а ts-файлы дробились детерминированно.
27. Как разработчик, я хочу, чтобы каждый чанк в индексе хранил `{file_path, line_start, line_end}` в metadata, чтобы цитирование указывало точные строки, а не только имя файла.
28. Как разработчик, я хочу, чтобы MCP-сервер `git_*` tools работали относительно cwd запуска ассистента, чтобы команды показывали статус именно того репо, из которого я работаю.
29. Как разработчик, я хочу, чтобы `list_files` респектил hardcoded ignore-список (`node_modules`, `.git`, `data`, `*.lock`), чтобы LLM случайно не запросила листинг 10 000 файлов из node_modules.
30. Как разработчик, я хочу, чтобы все deep-модули (DocsIndexer, AssistantConfig, AssistantOrchestrator, MCP-tools) имели unit-тесты в Red-Green стиле, чтобы регрессия в подборке файлов или tool-loop не уплыла молча.

## Implementation Decisions

### Зависимости

- **Переиспользуем**: `@modelcontextprotocol/sdk` (уже стоит, использовался в day23-25), `openai` SDK (для function-calling chat.completions), `gpt-tokenizer` (для max-context guard, как в day30), `sqlite-vec` (vector index), `picocolors` (цвета REPL).
- **Bun's `Glob` API** — для list_files MCP-tool. В стандарте Bun, без новых зависимостей.
- **Без `chokidar`/file-watcher** — reindex только по явной команде, никаких background-демонов.
- **Без `ts-morph`** — структурный AST-чанкинг для .ts остаётся out of scope. Fixed chunker даёт «достаточно хороший» retrieval для Q&A на 30-50 файлах.

### Layout

```
src/
  assistant.ts                                  # entry-point: загружает конфиг, запускает REPL
  presentation/
    repl/
      assistant-repl.ts                         # REPL-loop, парсер slash-команд
      slash-command-parser.ts                   # парсит /help, /reindex, /tools, /clear, /quit
      slash-command-parser.test.ts
  domain/
    services/
      docs-indexer.ts                           # DocsIndexer (deep)
      docs-indexer.test.ts
      assistant-config.ts                       # loadAssistantConfig (deep)
      assistant-config.test.ts
      assistant-orchestrator.ts                 # AssistantOrchestrator (deep)
      assistant-orchestrator.test.ts
scripts/
  day31/
    mcp-server.ts                               # standalone stdio MCP-сервер
    mcp-tools/
      git-branch.ts
      git-branch.test.ts
      git-status.ts
      git-status.test.ts
      git-log.ts
      git-log.test.ts
      git-diff.ts
      git-diff.test.ts
      list-files.ts
      list-files.test.ts
```

### Deep-модули

1. **`loadAssistantConfig(env)`** — синхронная функция, читает `process.env`, валидирует, возвращает `AssistantConfig`:
   - `llmBaseUrl: string` (`ASSISTANT_LLM_BASE_URL`, обязательное).
   - `llmApiKey: string` (`ASSISTANT_LLM_API_KEY`, обязательное).
   - `llmModel: string` (`ASSISTANT_LLM_MODEL`, обязательное, нет дефолта).
   - `embeddingBaseUrl: string` (`ASSISTANT_EMBEDDING_BASE_URL`, дефолт `http://localhost:11434`).
   - `embeddingModel: string` (`ASSISTANT_EMBEDDING_MODEL`, дефолт `nomic-embed-text`).
   - `dbPath: string` (`ASSISTANT_DB_PATH`, дефолт `data/project-docs.db`).
   - `topK: number` (`ASSISTANT_TOP_K`, дефолт 5, валидация 1..20).
   - `toolLoopMax: number` (`ASSISTANT_TOOL_LOOP_MAX`, дефолт 5, валидация 1..10).
   - `projectRoot: string` (`ASSISTANT_PROJECT_ROOT`, дефолт — `process.cwd()`).
   - Невалидное значение → throw с понятным сообщением, содержащим имя env и причину. Отсутствие обязательного — throw с инструкцией «set X in .env».

2. **`DocsIndexer`** — оркестрирует подбор файлов, чанкинг, эмбеддинг, запись в vector-index. Конструктор принимает: `projectRoot`, `chunkerByExtension: Map<string, Chunker>`, `embedder: Embedder`, `vectorIndex: VectorIndex`, `fileSystem: { glob, readFile }` (инжектируется для тестов). Метод `reindex(): AsyncIterable<{ file: string, chunks: number }>` — возвращает поток событий для печати прогресса. Внутри:
   - сначала собирает список файлов через `glob` с patterns и ignore-list;
   - drop'ает существующий индекс (truncate vector table);
   - для каждого файла: читает, выбирает chunker по расширению, чанкит, эмбеддит batch, пишет в vector-index с metadata `{file_path, line_start, line_end}`;
   - yield-ит прогресс.
   Тесты: при заданном файл-системе мок-результате выдаёт правильное количество чанков; ignore-list работает; неизвестное расширение пропускается с предупреждением; пустой файл пропускается.

3. **`AssistantOrchestrator`** — главный модуль ответа на /help. Конструктор: `llmClient`, `vectorIndex`, `embedder`, `mcpClient`, `toolLoopMax`, `topK`. Метод `ask(question: string, history: ChatMessage[]): AsyncIterable<OrchestratorEvent>` — возвращает поток событий:
   - `RetrievalEvent { chunks }` — что нашёл retrieval;
   - `ToolCallEvent { name, args }` — какой tool вызывает LLM;
   - `ToolResultEvent { name, result }` — что вернул tool;
   - `TokenEvent { delta }` — стрим финального ответа;
   - `FinalEvent { citations }` — список источников.
   Логика:
   1. Эмбеддит вопрос, retrieval top-K.
   2. Строит system-prompt: «Ты ассистент по проекту. Используй контекст ниже. Цитируй [N]. Если не знаешь — скажи прямо. Можешь вызывать tools (git_branch, …) если нужно состояние проекта».
   3. Прикладывает history + user message + контекст в `chat.completions` с `tools[]`.
   4. Если LLM возвращает `tool_calls` — параллельно исполняет через MCP, добавляет `tool` сообщения, цикл (max `toolLoopMax` итераций).
   5. Финальный ответ — стрим, токены через `TokenEvent`. Парсит цитаты `[N]` и yield-ит `FinalEvent`.
   Тесты: с mock LLM-клиентом, мок MCP — orchestrator корректно зацикливается на tool-call, обрывает после maxIter, возвращает финальный ответ; цитаты парсятся; events идут в правильном порядке.

4. **MCP tools (каждый — мини-deep)** — каждый tool — функция `(args, ctx) → ToolResult`, где `ctx` содержит `{ shellExec, projectRoot }`:
   - **`gitBranch(_, ctx)`** — вызывает `shellExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectRoot })`, возвращает stdout.trim().
   - **`gitStatus(_, ctx)`** — `git status --porcelain`, парсит в `{ modified: [], untracked: [], staged: [] }`.
   - **`gitLog({ limit })`** — `git log --oneline -n <limit>`, parsing.
   - **`gitDiff({ path? })`** — `git diff` или `git diff -- <path>`, raw stdout (truncate до 5000 chars).
   - **`listFiles({ pattern })`** — `Bun.Glob`-walk по pattern с hardcoded ignore-list, возвращает массив relative paths (max 100).
   Тесты для каждого: с инжектированным `shellExec` (мок) — возвращает корректный распарсенный результат; обрабатывает stderr/non-zero exit gracefully (возвращает error в ToolResult); ignore-list для list_files реально пропускает файлы.

### MCP-сервер `scripts/day31/mcp-server.ts`

- Создаёт `Server` (MCP SDK), регистрирует 5 tools с JSON Schema input.
- Подключается `StdioServerTransport`.
- Каждый tool-handler делегирует в одноимённую функцию из `mcp-tools/`.
- `ShellExecutor` — обёртка над `Bun.spawn`, инжектируется в tools.
- Запуск: `bun run scripts/day31/mcp-server.ts` (но обычно — через ассистента как child).

### REPL (`src/presentation/repl/assistant-repl.ts`)

- Принимает: `orchestrator`, `mcpClient`, `indexer`, `out: Writable`.
- Цикл: `prompt> ` → читает строку, парсит slash-команду через `parseSlashCommand(line)`.
- Для `/help <q>`: вызывает `orchestrator.ask(q, history)`, печатает события в реальном времени (tool-маркеры курсивом, токены — прямой stream).
- Для `/reindex`: вызывает `indexer.reindex()`, печатает прогресс.
- Для `/tools`: запрашивает у `mcpClient.listTools()`, форматирует и печатает.
- Для `/clear`: history = [].
- Для `/quit`/`/exit` или Ctrl+C/Ctrl+D: graceful shutdown — закрывает mcpClient и vectorIndex, exit 0.
- Цвета: bold для prompt, dim для tool-маркеров, normal для ответа, red для ошибок (через `picocolors`).

### Entry point `src/assistant.ts`

- Вход: парсит CLI-аргументы. Если первый аргумент — `reindex`, делает только reindex и exit (для `bun run assistant:reindex`). Иначе запускает REPL.
- Загружает конфиг, инициализирует БД, создаёт DocsIndexer/Orchestrator/MCPClient, передаёт в REPL.
- MCPClient запускает MCP-сервер как child-процесс через `StdioClientTransport` (по канону day23-25).

### Системный промпт ассистента

- «Ты — AI-ассистент разработчика проекта <ai-advent-challenge>. У тебя есть контекст из документации и кода (см. ниже). У тебя есть tools для git и файловой системы (см. описание tools). Отвечай только на основе предоставленного контекста и результатов tools. Если контекста недостаточно — скажи прямо. Цитируй источники в формате `[1]`, `[2]` и в конце ответа дай список источников вида `[1] file_path:line_start-line_end`.»
- Контекст вставляется в system как `## Контекст из документации\n\n[1] README.md:42-58\n<chunk text>\n\n[2] src/db.ts:120-145\n...`.

### Конфиг и .env.example

`.env.example` дополняется блоком:
```
# Day 31 — dev assistant
ASSISTANT_LLM_BASE_URL=http://localhost:8080/v1
ASSISTANT_LLM_API_KEY=personal:sk-changeme
ASSISTANT_LLM_MODEL=qwen2.5-coder:7b
ASSISTANT_EMBEDDING_BASE_URL=http://localhost:11434
ASSISTANT_EMBEDDING_MODEL=nomic-embed-text
ASSISTANT_DB_PATH=data/project-docs.db
ASSISTANT_TOP_K=5
ASSISTANT_TOOL_LOOP_MAX=5
```

### `package.json` scripts

- `"assistant": "bun run src/assistant.ts"`
- `"assistant:reindex": "bun run src/assistant.ts reindex"`

## Testing Decisions

**Что такое хороший тест:** проверяет внешнее поведение модуля (вход → выход), не лезет в реальную ФС, реальный shell, реальный MCP-сервер, реальную LLM. Все side-effect'ы инжектируются (`shellExec`, `fileSystem`, `llmClient`, `embedder`, `vectorIndex`, `mcpClient`). Используется детерминированный mock-LLM, возвращающий запрограммированную последовательность ответов (включая tool_calls).

**Тестируется (Red-Green по канону day27/30):**

- **`loadAssistantConfig`** — все обязательные env заданы → корректный объект с дефолтами. Отсутствие любого обязательного → throw с именем переменной. Невалидный `ASSISTANT_TOP_K` (0, отрицательный, не число, > 20) → throw. Невалидный `ASSISTANT_TOOL_LOOP_MAX` (0, > 10) → throw. Дефолты применяются при отсутствии опциональных.
- **`DocsIndexer`** — с мок-fileSystem (заранее заданный набор файлов): выдаёт правильное число чанков, ignore-list реально работает (`node_modules/foo.ts` не попадает), неизвестное расширение пропускается, пустой файл пропускается, .md обрабатывается structural-чанкером, .ts — fixed. Прогресс-events идут в порядке файлов.
- **`AssistantOrchestrator`** — главный кейс: с mock-LLM, который в первом вызове возвращает `tool_calls: [git_branch]`, во втором — финальный ответ. Orchestrator: эмбеддит вопрос, делает retrieval (mock-vectorIndex возвращает 5 чанков), вызывает MCP (mock возвращает `master`), второй вызов LLM с `tool` сообщением, стрим финального ответа. Events идут в правильном порядке: Retrieval, ToolCall, ToolResult, Token*, Final. Проверки: max iterations enforced (LLM-mock возвращающий вечно tool_calls обрывается на 5-й итерации с финальным no-content ответом); цитаты парсятся в `FinalEvent.citations`; пустой retrieval не падает.
- **MCP tools** — каждый tool с инжектированным shellExec mock'ом: возвращает корректный распарсенный результат; обрабатывает non-zero exit gracefully (возвращает error в ToolResult, не throw); list_files с реальным `Bun.Glob` на тестовом sandbox — респектит ignore-list.
- **`parseSlashCommand`** — `/help foo bar` → `{kind: "help", arg: "foo bar"}`; `/reindex` → `{kind: "reindex"}`; пустая строка → null; неизвестная команда `/foo` → ошибка валидации; `help foo` (без слеша) → как обычное сообщение (или ошибка — решено: ошибка, REPL обязывает к slash-формату).

**Не тестируется (тонкая glue, проверяется ручным smoke-сценарием):**

- `src/assistant.ts` — entry-point, только wiring.
- `src/presentation/repl/assistant-repl.ts` — REPL-loop с `process.stdin` — тестируется ручным запуском.
- `scripts/day31/mcp-server.ts` — стартует SDK-сервер, регистрирует tools — поведение каждого tool покрыто отдельно.

**Приёмка дня:**

1. `bun test` — зелёный (все новые тесты + не сломаны старые).
2. `bun run assistant:reindex` — успешно строит `data/project-docs.db`, выводит прогресс по файлам, не падает на пустых/бинарных.
3. `bun run assistant` — поднимается REPL.
4. `/tools` — выводит 5 git/file tools с описанием.
5. `/help какие env-переменные нужны для day30 сервиса?` — отвечает с цитатой на day30 PRD (если он попал в индекс через .ai/) или на .env.example, либо честно говорит «не нашёл» (если индекс на это не натренирован — ожидаемое поведение, поскольку выбран минимальный объём источников).
6. `/help на какой я ветке?` — LLM вызывает `git_branch()`, ответ содержит `day31-dev-assistant-rag`.
7. `/help что в незакоммиченных изменениях?` — вызов `git_status()`/`git_diff()`, человеческий пересказ.
8. `/clear` — сбрасывает контекст, следующий /help не помнит предыдущего.
9. `/quit` — graceful shutdown, нет zombie MCP-процесса (`pgrep mcp-server` пусто).

## Out of Scope

- **Источники в RAG помимо README+spring-boot-summary+src/**/*.ts.** PRD выбрал минимальный набор. `.ai/prd/`, `.ai/plans/`, `scripts/day*/report.md`, тесты, конфиги, package.json — следующая итерация. Это значит, что вопросы про «почему 6000 max input tokens?» (это в day30 PRD) могут не находиться — это осознанный trade-off.
- **TypeScript AST-чанкинг** (через `ts-morph`/`tree-sitter`). Fixed chunker даёт acceptable retrieval, AST-чанкинг — отдельный день.
- **Auto-watch / incremental reindex.** Только manual `/reindex`. File-watcher с детектом изменений + selective re-embedding — отдельный день.
- **Persistent диалог-история.** In-process. Persistent через message-repository (как day25) — следующий шаг, если выявится потребность.
- **Reranker (day23) поверх retrieval.** Не используем. Top-5 без reranker'а. Включение — отдельный шаг с измерением качества.
- **Retrieval-gating refusal (day29).** Не реализуем строго. Только мягкое «отвечай только по контексту» в system-промпте, без отдельной refusal-policy.
- **Web-UI / Telegram-бот /help.** Только REPL CLI. Day30 web-UI и `bot.ts` могут быть расширены позже отдельным днём.
- **Tool-execution timeout / sandbox.** MCP-tools исполняются без timeout'а и в полном доступе к репозиторию (read-only по факту: только `git`-чтения и `glob`). Если LLM начнёт спамить tool-calls — ограничение `toolLoopMax` спасает.
- **Read-file MCP-tool / write-file.** Намеренно нет: отдавать LLM возможность читать произвольный файл и писать — отдельный security-разговор. RAG уже даёт LLM содержимое файлов через retrieval.
- **Cross-project ассистент.** Жёстко `cwd`-bound. Если репо не git — `git_*` падают gracefully, но конфиг не делает их optional.
- **Streaming tool-calls.** Если модель поддерживает streaming с tool_calls в одном запросе — мы не оптимизируем, стрим только на финальной (no-tool-call) итерации. Промежуточные tool-call ответы — не stream.
- **Кэширование retrieval-результатов / эмбеддингов.** Каждый /help делает свежий retrieval. Дешёвая операция, smarter cache — premature optimization.
- **Многоязычные ответы.** LLM сама решает, на каком языке отвечать (системный промпт по-русски — модель ответит по-русски). Без явной локализации.
- **MCP над day30 HTTP-сервисом / удалённый MCP.** Только локальный stdio. Если ассистент гоняется на ноуте, а MCP — на сервере, это другой день.
- **Анализ зависимостей / call-graph.** «Где используется этот класс?» через AST — отдельная фича. RAG ищет по тексту, не по структуре.
- **Production-grade error handling в MCP-сервере.** Crash MCP-process → ассистент печатает ошибку, не пытается перезапустить (не нужно).
- **Quality-evaluation /help-ответов.** Никакого RagJudgeService на ответы ассистента. Качество — на ощупь, в ручном smoke-сценарии. Авто-eval — отдельный день, если потребуется regression-protection.

## Further Notes

- **Почему REPL, а не one-shot CLI.** Мне нужно итеративно крутить вопросы по проекту, и `bun run assistant /help "..."` — это медленно (каждый shot заново загружает БД, эмбеддер, MCP). REPL держит все ресурсы тёплыми, и follow-up вопрос дешёв. One-shot из shell — вторичный сценарий, можно сделать отдельно (day31+1) если потребуется.
- **Почему отдельная БД `data/project-docs.db`, а не source в `history.db`.** Чтобы `/reindex` мог делать честный drop-and-reload без риска снести day21-30 индексы. Чисто и просто. Размер БД мизерный (≤ 50 файлов × ~10 чанков × 768 dim float32 ≈ 1.5 MB).
- **Почему standalone MCP-сервер, а не in-process.** ТЗ дня требует MCP. Standalone — это «настоящий MCP» — тот же сервер можно подключить к Claude Desktop, к другому LLM-клиенту, протестировать `mcp inspector`. Это инвестиция в будущее, не дополнительная ценность сегодня.
- **Почему qwen2.5-coder:7b как default.** Уже стоит локально (day28-30), уже умеет OpenAI-tool-use, профильная для кода. Llama3.2:3b — не пойдёт на tool-calling, проверено в day29.
- **Почему минимальный объём источников.** Не хочу строить «универсальный поиск по всему», хочу минимальный slice: README + код. Если в смоук-тесте окажется, что вопросы по PRD (`day30 max tokens`) часто провисают — расширим источники в day31+1, измерив до/после.
- **Почему top-5 без reranker'а.** На 30-50 файлах своего же проекта top-5 даёт релевантный контекст в 80% случаев. Reranker — это +1 LLM-вызов на каждый /help (стоимость и latency). Включаем, если измерим, что top-5 промахивается.
- **Почему LLM сама решает вызывать tools (function-calling), а не «всегда подставляем git_branch».** «Всегда подставляем» дёшево и работает с любой LLM, но создаёт шум: на 80% вопросов про код git-state бесполезен. LLM-driven tool-call попадает только тогда, когда нужно. Цена — требуется tool-aware модель (qwen2.5-coder это есть).
- **Что дальше после day31.** Расширение источников (day31+1: PRD/планы в индекс), reranker для качества (day31+2), incremental reindex по hash (day31+3), web-UI как режим day30 (day31+4). Серия 21-31 закрывает: indexing → retrieval → reranking → citations → memory → local LLM → local RAG → optimization → service → assistant. Ассистент — финальная точка, в которой все 30 дней сходятся в один продукт.
- **Риск концепции.** Качество ответов /help зависит от двух вещей: качества retrieval'а на 50 файлах (легко промахнуться без reranker'а) и от честности LLM «отвечать только по контексту». Mitigation: цитирование (если LLM ссылается на несуществующий файл — пользователь сразу видит), `/tools` для прозрачности capabilities, и осознанное narrowing источников (лучше «не знаю» по PRD, чем галлюцинации). Если первый smoke-сценарий покажет много ложных ответов — добавляем gating-policy day29 как next step.
- **Связь с day30.** Ассистент по умолчанию ходит в day30-сервис как backend (`ASSISTANT_LLM_BASE_URL=http://localhost:8080/v1`). Это закрывает контур: моя локальная LLM → мой service → мой ассистент по моему проекту. Эталонный «свой стек до конца».

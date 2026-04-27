# Plan: Day 31 — Dev Assistant (RAG + MCP + /help REPL)

> Source PRD: `.ai/prd/day31-dev-assistant.md`

## Architectural decisions

Durable decisions, общие для всех фаз:

- **Slash-команды**: `/help <вопрос>`, `/reindex`, `/tools`, `/clear`, `/quit`, `/exit`. Не-slash ввод в REPL → ошибка валидации с подсказкой.
- **Schema**: новая БД `data/project-docs.db`. Vector-индекс через переиспользуемый `SqliteVectorIndex` (схема та же, что в day21). Каждый чанк хранит metadata `{file_path, line_start, line_end}`.
- **Key models**:
  - `AssistantConfig` — результат парсинга env.
  - `OrchestratorEvent` — union: `RetrievalEvent { chunks }`, `ToolCallEvent { name, args }`, `ToolResultEvent { name, result }`, `TokenEvent { delta }`, `FinalEvent { citations }`.
  - `Citation { file_path, line_start, line_end, label }` (label = `[1]`, `[2]`, …).
  - `ChatMessage { role, content, tool_call_id?, tool_calls? }` — OpenAI-совместимый формат.
- **Env-префикс `ASSISTANT_*`**:
  - Обязательные: `ASSISTANT_LLM_BASE_URL`, `ASSISTANT_LLM_API_KEY`, `ASSISTANT_LLM_MODEL`.
  - С дефолтами: `ASSISTANT_EMBEDDING_BASE_URL=http://localhost:11434`, `ASSISTANT_EMBEDDING_MODEL=nomic-embed-text`, `ASSISTANT_DB_PATH=data/project-docs.db`, `ASSISTANT_TOP_K=5`, `ASSISTANT_TOOL_LOOP_MAX=5`, `ASSISTANT_PROJECT_ROOT=cwd`.
- **MCP transport**: stdio. MCP-сервер запускается ассистентом как child-процесс через `StdioClientTransport` SDK.
- **Tool routing**: function-calling (OpenAI-совместимый `tools[]` в chat.completions). LLM сама решает, какой tool вызвать.
- **Backend LLM**: настраивается через env, не имеет hard-coded fallback на `OPENAI_*`. Default-модель: `qwen2.5-coder:7b` (умеет tool-use). По канону пользователь указывает `ASSISTANT_LLM_BASE_URL` на day30 service для замыкания контура.
- **Layout**:
  - `src/assistant.ts` — entry-point (как `src/bot.ts`/`src/server.ts`).
  - `src/presentation/repl/` — REPL-loop, парсер slash-команд.
  - `src/domain/services/` — `assistant-config.ts`, `docs-indexer.ts`, `assistant-orchestrator.ts` (deep-модули).
  - `scripts/day31/mcp-server.ts` — MCP-сервер.
  - `scripts/day31/mcp-tools/` — отдельные функции на каждый tool (testable).
- **Тесты**: Red-Green по канону day27/30 для каждого deep-модуля. Glue-слои (entry-point, REPL-loop с stdin, MCP SDK wiring) покрываются ручным smoke-сценарием.
- **Package.json scripts**: `"assistant": "bun run src/assistant.ts"`, `"assistant:reindex": "bun run src/assistant.ts reindex"`.

---

## Phase 1: REPL skeleton + AssistantConfig

**User stories**: 1, 18, 19, 20, 21, 22.

### What to build

Тонкий end-to-end tracer bullet: пользователь набирает `bun run assistant`, попадает в интерактивный prompt, может вводить slash-команды и получать на них ответы-заглушки (для тех, что ещё не реализованы), может выйти через `/quit`/`/exit`/Ctrl+C/Ctrl+D с graceful shutdown. При отсутствии обязательных env — падает с понятным сообщением до открытия prompt'а.

Включает:
- Entry-point ассистента, читающий CLI-аргументы (без аргументов → REPL; `reindex` → пока заглушка с TODO).
- Парсинг env через deep-модуль `loadAssistantConfig` с валидацией обязательных и проверкой диапазонов (`top_k`, `tool_loop_max`).
- REPL-loop: prompt с цветом, чтение `process.stdin` line-by-line, диспатч в slash-парсер.
- Парсер slash-команд: `/help`, `/reindex`, `/tools`, `/clear`, `/quit`, `/exit`. Возвращает дискриминированное object либо валидационную ошибку. Покрыт unit-тестами.
- Заглушки команд: `/help <q>` → «RAG не подключён, ждите phase 3»; `/reindex` → «индексация не реализована, ждите phase 2»; `/tools` → «MCP не подключён, ждите phase 4»; `/clear` → «история пуста»; `/quit`/`/exit`/Ctrl+C → graceful shutdown (закрытие stdin, exit 0).
- Блок в `.env.example` с `ASSISTANT_LLM_BASE_URL`, `_API_KEY`, `_MODEL` (минимум для phase 1).

### Acceptance criteria

- [ ] `bun test` зелёный для `assistant-config` и `slash-command-parser`.
- [ ] При запуске `bun run assistant` без любого из 3 обязательных env — процесс падает с stderr вида `set ASSISTANT_LLM_MODEL in .env`, exit code != 0.
- [ ] При запуске с корректными env — открывается REPL prompt.
- [ ] Ввод `/help как дела?` печатает заглушку.
- [ ] Ввод `/quit` или `/exit` или Ctrl+C / Ctrl+D — graceful exit без stack trace, exit code 0.
- [ ] Ввод произвольного текста без слеша — печатает «команды должны начинаться со /, попробуйте /help <вопрос>».
- [ ] `package.json` содержит `"assistant"` script.
- [ ] `.env.example` содержит блок Day 31 с тремя `ASSISTANT_LLM_*`.

---

## Phase 2: Indexing pipeline + /reindex

**User stories**: 2, 3, 4, 5, 25, 26, 27.

### What to build

`bun run assistant:reindex` (и slash `/reindex` в REPL) собирает файлы документации и кода, чанкует, эмбеддит через Ollama, кладёт в `data/project-docs.db`. По мере прогресса печатает события `indexed README.md (3 chunks)` и т.п. Полный drop-and-reload (без incremental).

Включает:
- Deep-модуль `DocsIndexer`: принимает inject-able `fileSystem` (glob+readFile), `chunkerByExtension: Map<string, Chunker>`, `embedder`, `vectorIndex`. Метод `reindex()` возвращает `AsyncIterable` событий прогресса (`{ kind: "file", path, chunks }` / `{ kind: "skipped", path, reason }` / `{ kind: "done", totalFiles, totalChunks }`).
- Hardcoded patterns для подбора:
  - Include: `README.md`, `spring-boot-summary.md`, `src/**/*.ts`.
  - Ignore: `node_modules/**`, `.git/**`, `data/**`, `*.lock`, `*.test.ts`, `*.d.ts`.
- Per-type chunker selection: `.md` → `StructuralMarkdownChunker` (переиспользуем существующий), `.ts` → `FixedSizeChunker` (1500/200, переиспользуем).
- Каждый чанк хранит metadata `{file_path, line_start, line_end}` — `line_start`/`line_end` рассчитываются на этапе чанкинга (для fixed — по offset → line via `\n`-count; для structural — по позиции заголовка).
- Entry-point ассистента: ветка `reindex` инициализирует БД, embedder, vectorIndex, DocsIndexer, гоняет `for await` цикл, печатает прогресс, exit 0.
- Slash `/reindex` в REPL делегирует ту же логику, печатает прогресс в текущем терминале, возвращает к prompt'у.
- Расширение `.env.example` блоком embedding/db/top_k.

### Acceptance criteria

- [ ] `bun test` зелёный для `docs-indexer` (mock fileSystem/embedder/vectorIndex).
- [ ] Тест: при заданном наборе файлов в mock-FS, `node_modules/foo.ts` и `src/x.test.ts` пропущены.
- [ ] Тест: для `README.md` используется structural chunker, для `src/main.ts` — fixed.
- [ ] Тест: каждый чанк выходит с правильными `{file_path, line_start, line_end}` (line_end > line_start).
- [ ] Тест: пустой файл yield-ит `kind: "skipped"`, не падает.
- [ ] `bun run assistant:reindex` создаёт `data/project-docs.db`, печатает прогресс минимум для `README.md`, нескольких `src/**/*.ts`, в конце — totals.
- [ ] Повторный запуск `bun run assistant:reindex` не валится (drop-and-reload), БД содержит свежий набор чанков.
- [ ] В REPL ввод `/reindex` приводит к тому же прогрессу и возврату в prompt без ошибок.
- [ ] `data/history.db` не повреждена и не изменена.

---

## Phase 3: RAG /help без tool-use

**User stories**: 6, 7, 13, 14, 15, 24.

### What to build

`/help <вопрос>` стал работающим: ассистент эмбеддит вопрос, ищет top-K=5 чанков в индексе, склеивает в системный промпт с инструкцией цитировать, отправляет в LLM, стримит ответ в терминал токен за токеном, в конце выдаёт список цитат. Без MCP, без tool-use — чистый RAG-pipeline.

Включает:
- Deep-модуль `AssistantOrchestrator`: конструктор принимает `llmClient`, `vectorIndex`, `embedder`, `topK`, `mcpClient` (передаётся, но в этой фазе игнорируется — просто `null`-passable). Метод `ask(question, history): AsyncIterable<OrchestratorEvent>`. В этой фазе цикл сводится к: эмбеддинг → retrieval → один LLM-вызов в streaming-режиме → парсинг цитат.
- Системный промпт: «ты ассистент по проекту, отвечай только по контексту, цитируй `[1]`, `[2]`, в конце дай список `[N] file:line_start-line_end`».
- Контекст инжектится в system-сообщение в формате `[1] README.md:42-58\n<chunk text>\n\n[2] src/db.ts:120-145\n<chunk text>`.
- Парсинг цитат: пост-обработка финального текста — извлекает `[N]` маркеры, сопоставляет с retrieved chunks, формирует `Citation[]`.
- Минимальный gating: если retrieved chunks все имеют score ниже порога (например 0.3) — orchestrator emit-ит `FinalEvent` с пустыми citations и в TokenEvents просто отдаёт ответ LLM «не нашёл в документации, отвечаю по общим знаниям». LLM-промпт включает эту директиву условно.
- REPL-обработчик `/help`: создаёт orchestrator при первом вызове (lazy init), вызывает `ask`, печатает `TokenEvent.delta` без буферизации, в конце — список citations.
- Расширение `.env.example` строкой `ASSISTANT_TOP_K=5`.

### Acceptance criteria

- [ ] `bun test` зелёный для `assistant-orchestrator` с mock LLM/embedder/vectorIndex/mcpClient=null.
- [ ] Тест: orchestrator emit-ит events в порядке `RetrievalEvent → TokenEvent* → FinalEvent`.
- [ ] Тест: цитаты `[1]`, `[2]` в финальном тексте корректно парсятся в `Citation[]` с правильными file/line.
- [ ] Тест: пустой retrieval (все score < threshold) → empty citations, TokenEvents всё равно идут.
- [ ] Тест: dialog history передаётся в LLM (первое сообщение system + history + user).
- [ ] После phase 2 reindex: `bun run assistant`, `/help какие чанкеры есть в проекте?` — приходит ответ с цитатой на `src/domain/services/chunkers/...` или `README.md`.
- [ ] Ответ стримится в реальном времени (видно нарастание текста).
- [ ] В конце ответа — пронумерованный список источников вида `[1] README.md:42-58`.

---

## Phase 4: MCP server (standalone) + 5 git/file tools

**User stories**: 8, 9, 10, 11, 28, 29.

### What to build

Запускается standalone MCP-сервер `scripts/day31/mcp-server.ts` на `@modelcontextprotocol/sdk` со stdio-транспортом, регистрирует 5 tools. Каждый tool — отдельная функция в `scripts/day31/mcp-tools/`, тестируемая в изоляции с инжектируемым `ShellExecutor`. Сервер пока **не интегрирован** в orchestrator — он только проверен отдельно.

Включает:
- Deep-модуль `ShellExecutor` — обёртка над `Bun.spawn` с интерфейсом `exec(cmd, args, opts): Promise<{ stdout, stderr, exitCode }>`. Инжектируется в каждый tool.
- 5 tool-функций:
  - `gitBranch({}, ctx)` — `git rev-parse --abbrev-ref HEAD`.
  - `gitStatus({}, ctx)` — `git status --porcelain`, парсит в `{ modified, untracked, staged }`.
  - `gitLog({ limit?: number }, ctx)` — `git log --oneline -n <limit||10>`, массив `{ hash, subject }`.
  - `gitDiff({ path?: string }, ctx)` — `git diff` (или `git diff -- <path>`), truncate до 5000 chars.
  - `listFiles({ pattern: string }, ctx)` — `Bun.Glob` walk по pattern с hardcoded ignore-list (`node_modules/**`, `.git/**`, `data/**`, `*.lock`), max 100 paths.
- MCP-сервер: создаёт `Server` с metadata, регистрирует 5 tools с JSON Schema input. Каждый handler делегирует в одноимённую функцию + `shellExec` инстанс. Подключает `StdioServerTransport`.
- Все tools обрабатывают non-zero exit gracefully (возвращают error в `ToolResult.isError`, не throw).

### Acceptance criteria

- [ ] `bun test` зелёный для каждого из 5 tool-файлов с mock `ShellExecutor`.
- [ ] Тест: `gitBranch` парсит trim'нутую ветку.
- [ ] Тест: `gitStatus` корректно разносит modified vs untracked vs staged.
- [ ] Тест: `gitLog` с `limit=5` дёргает shell с правильным `-n 5`.
- [ ] Тест: `gitDiff` без path делает `git diff` без аргументов; с path — добавляет `--`.
- [ ] Тест: `listFiles` респектит ignore-list (mock-glob возвращает `node_modules/foo.ts` — он отфильтрован).
- [ ] Тест: shell exit != 0 — tool возвращает `{ isError: true, message }`, а не throw.
- [ ] `bun run scripts/day31/mcp-server.ts` запускается без ошибок (для smoke: `echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | bun run scripts/day31/mcp-server.ts` возвращает JSON со списком 5 tools).

---

## Phase 5: Tool-use loop + /tools + /clear + финал

**User stories**: 12, 16, 17, 23, замыкание smoke-acceptance из PRD (пункты 1-9 раздела «Приёмка дня»).

### What to build

Orchestrator получает рабочий MCP-клиент, передаёт схемы tools в LLM как `tools[]`, исполняет цикл tool_calls → MCP execute → follow-up call (max 5 итераций) → финальный стрим. REPL печатает маркеры `→ git_branch()` / `← master` для прозрачности. `/tools` начинает показывать реальный список из `mcpClient.listTools()`. `/clear` сбрасывает диалог-историю. Полный smoke по 9 пунктам приёмки PRD.

Включает:
- Расширение `AssistantOrchestrator`: после retrieval + первого LLM-вызова — если ответ содержит `tool_calls`, исполнить через `mcpClient.callTool()`, добавить результаты как `tool` сообщения, вызвать LLM ещё раз. Цикл до `toolLoopMax`. Финальный (без tool_calls) ответ — стрим в `TokenEvent`. Промежуточные emit-ятся как `ToolCallEvent` + `ToolResultEvent`.
- Системный промпт расширяется: «у тебя есть tools для git и файлов — используй, если вопрос про состояние проекта».
- Entry-point: запускает MCP-сервер как child через `StdioClientTransport` (по канону day23-25), передаёт `mcpClient` в orchestrator.
- REPL: обработка `ToolCallEvent` → печать `→ tool_name(args)` курсивом/dim; `ToolResultEvent` → печать `← <первые 200 chars результата>` dim; `TokenEvent` → нормальный вывод.
- `/tools` → `mcpClient.listTools()` → форматированная таблица tools с описанием.
- `/clear` → orchestrator.history = []; печать «история сброшена».
- Graceful shutdown в `/quit`: закрывает `mcpClient` (что убивает child-процесс MCP-сервера), закрывает vectorIndex, exit 0. То же на Ctrl+C.
- Финализация `.env.example` — добавить `ASSISTANT_TOOL_LOOP_MAX=5`.

### Acceptance criteria

- [ ] `bun test` зелёный для расширенного `assistant-orchestrator` (mock LLM возвращает tool_calls в первом ответе, финальный текст во втором).
- [ ] Тест: orchestrator emit-ит events в порядке `RetrievalEvent → ToolCallEvent → ToolResultEvent → TokenEvent* → FinalEvent`.
- [ ] Тест: при mock LLM, который возвращает tool_calls бесконечно — цикл обрывается на iteration 5 + emit финального TokenEvent (с понятным сообщением «достигнут лимит итераций»).
- [ ] Тест: tool_calls с несколькими tools в одном ответе — все исполняются, все `tool` сообщения добавляются в историю перед следующим LLM-вызовом.
- [ ] Smoke 1: `bun run assistant`, `/tools` — печатает 5 tools с описаниями.
- [ ] Smoke 2: `/help на какой я ветке?` — видны маркеры `→ git_branch()` / `← day31-dev-assistant-rag`, финальный ответ упоминает ветку.
- [ ] Smoke 3: `/help что в незакоммиченных изменениях?` — вызов `git_status` или `git_diff`, человеческий пересказ.
- [ ] Smoke 4: `/help последние 3 коммита?` — вызов `git_log` с limit=3, форматированный ответ.
- [ ] Smoke 5: `/help какие файлы есть в src/domain/services?` — вызов `list_files`, список путей.
- [ ] Smoke 6: `/help` (вопрос без git-контекста, чисто документация) — отвечает по RAG без вызова tools.
- [ ] Smoke 7: `/clear` сбрасывает историю — следующий `/help` не помнит предыдущего вопроса.
- [ ] Smoke 8: `/quit` — graceful shutdown, `pgrep -f mcp-server` пусто после exit.
- [ ] Smoke 9: `bun test` весь зелёный, `.env.example` содержит полный блок Day 31 со всеми ASSISTANT_* переменными.

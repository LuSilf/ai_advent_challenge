# Day 31 — Dev Assistant: финальный отчёт

> Ветка: `day31-dev-assistant-rag` · Прогон: 2026-04-27

## Резюме

Реализован CLI ассистент разработчика `bun run assistant`, отвечающий на вопросы о проекте через RAG-индекс (README + spring-boot-summary + src/**/*.ts) с 5 MCP-инструментами для git и файловой системы (function-calling, локальная qwen3-instruct через Ollama). Все 5 фаз PRD выполнены, все 9 пунктов приёмки прошли.

| | |
|---|---|
| Фаз реализовано | **5/5** |
| Коммитов фазы | **6** (PRD/план + 5 phase) |
| Unit-тестов всего | **903 pass, 0 fail** |
| Новых deep-модулей | **8** (parser, config, indexer, orchestrator, 5 mcp-tools, llm-port, shell-executor) |
| Новых MCP-инструментов | **5** (git_branch, git_status, git_log, git_diff, list_files) |
| Slash-команд REPL | **5** (/help, /reindex, /tools, /clear, /quit/exit) |
| Реальный smoke-прогон | **9/9 PASS** |

## Состав фаз

| # | Фаза | Коммит | Юнит-тесты добавлено |
|---|------|--------|-----------------------|
| 0 | PRD + план | `b4966db` | — |
| 1 | REPL skeleton + AssistantConfig | `6984475` | 13 (parser) + 11 (config) = **24** |
| 2 | Indexing + `/reindex` | `b04c72c` | 8 (DocsIndexer) |
| 3 | RAG `/help` без tool-use | `c0aadaf` | 8 (orchestrator) |
| 4 | MCP server + 5 tools | `aa5ec6e` | 19 (5 tools × ~4 теста) |
| 5 | Tool-loop + `/tools` + `/clear` | `38784af` | 4 (orchestrator tool-loop) |

Итого новых юнитов: **63**. Финальный прогон `bun test` — `903 pass / 0 fail`.

## Архитектура

```
src/
  assistant.ts                                  # entry-point: bun run assistant [reindex]
  domain/
    ports/
      assistant-llm.ts                          # AssistantLLMClient интерфейс
    services/
      assistant-config.ts (+ test)              # loadAssistantConfig (deep)
      docs-indexer.ts (+ test)                  # DocsIndexer (deep)
      assistant-orchestrator.ts (+ test)        # AssistantOrchestrator (deep)
  api/
    openai/openai-assistant-llm.ts              # реализация порта поверх openai SDK
  presentation/
    repl/
      assistant-slash-parser.ts (+ test)        # парсер slash-команд (deep)
      assistant-repl.ts                         # REPL-loop (тонкая wiring)
      assistant-reindex.ts                      # общая логика для CLI subcommand + /reindex
      bun-glob-fs.ts                            # IndexerFileSystem поверх Bun.Glob

scripts/day31/
  mcp-server.ts                                 # standalone stdio MCP-сервер
  mcp-tools/
    shell-executor.ts                           # ShellExecutor port (Bun.spawn)
    types.ts                                    # ToolContext, ToolResult
    git-branch.ts (+ test)
    git-status.ts (+ test)
    git-log.ts (+ test)
    git-diff.ts (+ test)
    list-files.ts (+ test)                      # sandbox-тесты на реальных файлах
  report.md                                     # этот документ
  raw/                                          # сырые логи 9 smoke-прогонов
```

### Ключевые архитектурные решения

- **`Chunk`-модель расширена** опциональными `lineStart`/`lineEnd`. Миграция через `ALTER TABLE … ADD COLUMN` в `initDb` для совместимости с существующими `data/history.db`.
- **Отдельная БД `data/project-docs.db`** — изолирует индекс ассистента от истории чатов и других индексов проекта (day21-29).
- **Свой минимальный порт `AssistantLLMClient`** вместо переиспользования сложного `LLMClient`/`LLMRequest` (день 25). Чистый поток `delta | tool_call | done`, не привязан к `Message`-модели с `sessionId`.
- **MCP-сервер запускается ассистентом как child** через `StdioClientTransport` SDK (через существующий `McpClientService`).
- **Function-calling tool-loop**: orchestrator передаёт схемы tools в `chat.completions`, цикл `tool_calls → MCP execute → next call → final stream` ограничен `toolLoopMax`.
- **Корректный graceful shutdown**: убран `process.exit(0)` из `onQuit` — REPL естественно завершается через `return`, transport.close() успевает прибрать child-процесс MCP-сервера.

### Хардкод-настройки индекса

- **Include patterns**: `README.md`, `spring-boot-summary.md`, `src/**/*.ts`.
- **Ignore patterns**: `node_modules/**`, `.git/**`, `data/**`, `**/*.lock`, `**/*.test.ts`, `**/*.d.ts`.
- **Chunkers**: `.md` → `StructuralMarkdownChunker` (H2/H3, max 2000 chars); `.ts` → `FixedSizeChunker` (1500 chars, overlap 200).
- **Embedder**: Ollama `nomic-embed-text`, dim=768.

## Smoke-прогон по 9 пунктам приёмки PRD

Запуск с `ASSISTANT_LLM_BASE_URL=http://localhost:11434/v1`, `ASSISTANT_LLM_MODEL=qwen3:4b-instruct-2507-q8_0` (Ollama, native tool-calling). Сырые логи в `scripts/day31/raw/`.

| # | Сценарий | Ожидаемое | Факт | Лог |
|---|---|---|---|---|
| 1 | `bun test` | All green | `903 pass / 0 fail / 2053 expect() / 82 files / 14.22s` | `raw/smoke-1-tests.log` |
| 2 | `bun run assistant:reindex` | Создание `data/project-docs.db`, прогресс по файлам, totals | `done — 120 files, 423 chunks, elapsed 122312ms` | `raw/smoke-2-reindex.log` |
| 3 | REPL поднимается, `/tools` | 5 MCP-инструментов с описанием | git_branch / git_status / git_log / git_diff / list_files | `raw/smoke-3-tools.log` |
| 4 | `/help на какой я ветке?` | LLM вызывает `git_branch`, ответ упоминает ветку | `→ git_branch({})` / `← day31-dev-assistant-rag` / "Текущая ветка: `day31-dev-assistant-rag`." | `raw/smoke-4-branch.log` |
| 5 | `/help последние 3 коммита?` | LLM вызывает `git_log` с limit=3 | `→ git_log({"limit":3})` → 3 коммита day31 phase 5/4/3 пересказаны | `raw/smoke-5-log.log` |
| 6 | `/help какие .ts файлы в src/domain/services?` | LLM вызывает `list_files` | `→ list_files({"pattern":"src/domain/services/*.ts"})` → корректный листинг 30+ файлов | `raw/smoke-6-listfiles.log` |
| 7 | `/help какие OPENAI_* в README?` | RAG-only ответ с цитатами | Перечислены 9 переменных с цитатами `[N4]`, `[N5]` и упоминанием строк | `raw/smoke-7c-readme.log` |
| 8 | `/clear` сбрасывает контекст | Ввод печатает `[clear] история сброшена`, `history.length = 0` | OK | `raw/smoke-8-clear.log` |
| 9 | `/quit` graceful shutdown, нет zombie MCP | После exit `pgrep mcp-server` пусто | После exit + 3s — `0` живых child-процессов | `raw/smoke-9-quit.log` |

**Итог: 9/9 PASS.**

## Замечания и trade-offs

- **Tool-use модель**. PRD рекомендовал `qwen2.5-coder:7b` как default. Фактическая проверка в Ollama-OpenAI-shim: эта модель **не возвращает нативные `tool_calls`** — вместо них пишет JSON в `content`. `qwen3:4b-instruct-2507-q8_0` корректно эмитит `tool_calls`. Дефолт зафиксирован в `.env.example` с явной заметкой.
- **RAG honesty vs recall**. Системный промпт "отвечай только по контексту" иногда даёт overreject ("не нашёл в документации") даже на чанках со смежной семантикой. Для smoke 7 удачно сработал конкретный вопрос про `OPENAI_*` в README; абстрактные ("какие env для day30?") отказывает, поскольку в индекс не включены `.ai/prd/`. Это осознанный narrowing PRD и при необходимости расширяется в day31+1.
- **REPL race fix**. Первая версия REPL вызывала `onQuit` через `rl.close` event handler параллельно с обработкой строки → ответ обрывался. Перенёс quit в синхронную ветку `for-await` цикла (`rl.close()` + `return`), убрал `process.exit(0)` из `onQuit` — позволило `transport.close()` SDK дождаться завершения child-процесса.
- **Bun.Glob ignore**. У `Bun.Glob` нет нативного `ignore` параметра — реализовано через post-filter (включая для `list_files` MCP-tool и `DocsIndexer`).
- **Migration risk**. `ALTER TABLE chunks ADD COLUMN line_start/line_end` — обратная совместимость с существующими `data/history.db`. Существующие 50 тестов `db.test.ts` + `indexing-service.test.ts` остались зелёными, новые колонки nullable.

## Out of scope (как и заявлено в PRD)

- AST/structural чанкинг для `.ts`.
- Auto-watch / hash-based incremental reindex.
- Расширение источников (`.ai/prd/`, `scripts/day*/report.md`).
- Reranker (day23) и retrieval-gating refusal (day29).
- Persistent диалог-история между сессиями.
- Web-UI / Telegram-бот для `/help`.
- One-shot CLI режим (`bun run assistant /help "..."`).
- Multimodal входы, embeddings endpoint.

## Что дальше

- **day31+1 — расширение индекса**: добавить `.ai/prd/`, `.ai/plans/`, `scripts/day*/report.md` — закроет 80% случаев "RAG не нашёл".
- **day31+2 — reranker**: подключить `LlmRerankerService` (day23) и измерить delta качества на 10 синтетических вопросах.
- **day31+3 — incremental reindex**: hash-based detection изменённых файлов, ускорение `/reindex` с 2 минут до секунд.
- **day31+4 — публикация в day30 web-UI**: режим `/help` в существующем браузерном чате с тем же orchestrator.

Серия 21-31 закрывает: indexing → retrieval → reranking → citations → memory → local LLM → local RAG → optimization → service → **assistant**. Финальная точка достигнута: модель + сервис + RAG + ассистент собраны в один интерфейс.

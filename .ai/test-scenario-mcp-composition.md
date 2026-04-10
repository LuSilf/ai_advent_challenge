# Тест-сценарий: Композиция MCP-инструментов

## Предусловия

1. Все три MCP-сервера зарегистрированы:
   ```
   /mcp add github-search bun run scripts/mcp-servers/search.ts
   /mcp add summarize bun run scripts/mcp-servers/summarize.ts
   /mcp add save-to-file bun run scripts/mcp-servers/save-to-file.ts
   ```
2. `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` настроены в `.env`
3. Доступ к интернету (GitHub API)

## Сценарий 1: Полная цепочка — PR

**Ввод:** «Найди последние 2 вмердженных PR в spring-projects/spring-boot, суммаризируй каждый и сохрани в файл»

**Ожидание:**
- LLM вызывает `github-search__search_pulls` с `repo: "spring-projects/spring-boot", count: 2, state: "merged"`
- Получает JSON с 2 PR + комментариями
- Вызывает `summarize__summarize` 2 раза (по одному на каждый PR)
- Вызывает `save-to-file__save_to_file` с Markdown-содержимым
- В REPL отображаются tool call плашки на каждом шаге
- Файл создан в текущей директории с суммари

**Проверка:**
- [ ] Файл существует и содержит структурированный Markdown
- [ ] Каждый PR имеет номер, заголовок, ссылку и суммари
- [ ] Нет ошибок в tool calls

## Сценарий 2: Полная цепочка — Issues

**Ввод:** «Покажи последние 2 закрытых issue в spring-projects/spring-boot, суммаризируй и сохрани в файл»

**Ожидание:** аналогичная цепочка через `search_issues`

## Сценарий 3: Частичная цепочка — только поиск

**Ввод:** «Покажи последний вмердженный PR в spring-projects/spring-boot»

**Ожидание:**
- LLM вызывает только `search_pulls`
- Показывает данные в чате без суммаризации и сохранения

## Сценарий 4: Ошибка — несуществующий репозиторий

**Ввод:** «Найди PR в nonexistent/repo»

**Ожидание:**
- LLM получает ошибку от search
- Сообщает пользователю о проблеме
- Не крашит сессию

## Результаты тестирования

| Сценарий | Статус | Дата | Примечания |
|----------|--------|------|------------|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |

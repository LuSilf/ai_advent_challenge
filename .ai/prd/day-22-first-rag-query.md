# PRD: День 22 — Первый RAG-запрос

## Problem Statement

В проекте уже есть индекс документов, чанки, эмбеддинги и векторный поиск, но сам агент пока не умеет отвечать в режиме retrieval-augmented generation. Сейчас пользователь в REPL получает ответ только от модели без явной опоры на проиндексированную базу знаний. Это делает невозможным честное сравнение двух режимов:

- обычный ответ модели без retrieval,
- ответ модели с retrieval по локальной базе.

Из-за этого Day 21 остаётся незавершённым с точки зрения пользовательской ценности: индекс существует, но не участвует в ответе. Кроме того, отсутствует воспроизводимый способ оценить, действительно ли RAG улучшает качество ответа по конкретному корпусу. Нет набора контрольных вопросов, нет ожидаемых источников, нет автоматического отчёта, нет фиксации стоимости двух режимов.

Пользователю нужен агент в REPL с двумя режимами работы — с RAG и без RAG — с понятным переключением, прозрачным отображением найденных источников и отдельной командой автоматической оценки качества на 10 контрольных вопросах по базе system-design-primer.

## Solution

Добавить в REPL полноценный RAG-режим поверх уже существующего индекса документов.

Поведение в пользовательском сценарии:

1. Пользователь заранее индексирует базу знаний отдельной командой, как в Day 21.
2. В REPL пользователь видит текущий статус RAG в отдельной статус-строке.
3. Пользователь может переключать режим командами `/rag on` и `/rag off`, а также настраивать стратегию поиска и `topK`.
4. Если RAG включён, перед обращением к LLM система:
   - строит embedding запроса,
   - ищет релевантные чанки в индексе,
   - формирует RAG-контекст,
   - добавляет его к вопросу,
   - отправляет запрос в LLM.
5. Приложение печатает отдельный техблок с найденными чанками, расстояниями и источниками. Этот блок выводится отдельно от текста модели.
6. Если индекс не готов или релевантные чанки не найдены, приложение явно сообщает об этом и делает безопасный fallback в обычный non-RAG ответ.
7. Появляется отдельная команда оценки, которая:
   - берёт 10 контрольных вопросов,
   - прогоняет каждый вопрос в двух режимах,
   - фиксирует ответы, retrieval-метаданные и стоимость,
   - оценивает качество по шкале 0–3 через гибридную систему rules + judge,
   - сохраняет markdown-отчёт.

Основные пользовательские решения, зафиксированные в этом PRD:

- RAG реализуется в REPL.
- RAG по умолчанию выключен.
- Статус показывается не через хрупкий визуальный status bar, а через отдельную статус-строку.
- По умолчанию используется structural retrieval strategy.
- `topK` по умолчанию равен 5.
- Жёсткий threshold по distance не вводится.
- Источники, section и distance печатает приложение, а не сама модель.
- При отсутствии индекса или результатов поиск не ломает чат, а даёт fallback в non-RAG.
- Оценка качества запускается отдельной командой, в духе Day 21.
- За основу контрольных вопросов берётся набор Day 21, при необходимости он уточняется под оценку финального ответа.
- Ожидаемые источники в оценке проверяются в основном по section.
- Для LLM-as-a-judge добавляется отдельная роль judge с fallback на chat.

## User Stories

1. As a REPL user, I want to see whether RAG is enabled or disabled before I send a message, so that I understand how the next answer will be generated.
2. As a REPL user, I want to enable RAG with a simple command, so that I can switch from plain chat to retrieval-assisted chat without restarting the app.
3. As a REPL user, I want to disable RAG with a simple command, so that I can compare the baseline answer with the retrieval-augmented answer.
4. As a REPL user, I want to inspect the current RAG settings, so that I know which retrieval strategy and topK are active.
5. As a REPL user, I want to change the retrieval strategy from the REPL, so that I can compare fixed and structural retrieval without editing code.
6. As a REPL user, I want to change topK from the REPL, so that I can tune how many chunks are injected into the answer context.
7. As a REPL user, I want RAG to use the existing document index, so that indexing and answering stay decoupled.
8. As a REPL user, I want the app to retrieve chunks before calling the LLM, so that the model answers using the indexed knowledge base.
9. As a REPL user, I want the app to show which chunks were retrieved, so that I can verify that the answer is grounded in the expected document sections.
10. As a REPL user, I want the app to show source metadata and distance for each retrieved chunk, so that I can understand retrieval quality.
11. As a REPL user, I want the app to explicitly tell me when no RAG data was available, so that I do not mistake a plain model answer for a grounded answer.
12. As a REPL user, I want the app to fall back to non-RAG mode when the index is missing or no chunks are found, so that the chat remains usable.
13. As a REPL user, I want the answer itself to remain readable and focused, so that technical retrieval details do not pollute the model’s natural-language response.
14. As a developer, I want a dedicated retrieval orchestration module, so that query embedding, vector search, and context assembly are isolated and testable.
15. As a developer, I want RAG settings to live in the existing settings mechanism, so that they survive across sessions and fit the current architecture.
16. As a developer, I want a separate evaluation command for Day 22, so that RAG quality can be measured reproducibly with one command.
17. As a developer, I want to reuse the Day 21 query set as the base for the Day 22 control questions, so that retrieval evaluation and answer evaluation remain aligned.
18. As a developer, I want each control question to store the expected answer content, so that answer quality can be judged against explicit expectations.
19. As a developer, I want each control question to store expected sources when applicable, so that groundedness can be checked in RAG mode.
20. As a developer, I want each control question to support must-have concepts and optional concepts, so that rule-based scoring is more nuanced than a binary keyword match.
21. As a developer, I want the evaluation pipeline to run each question twice, once without RAG and once with RAG, so that I can compare the two modes fairly.
22. As a developer, I want the evaluation report to include both answers side by side, so that the quality difference is easy to inspect.
23. As a developer, I want the evaluation pipeline to record retrieval metadata for the RAG run, so that I can debug why a grounded answer succeeded or failed.
24. As a developer, I want the evaluation pipeline to record token usage and cost for both modes, so that quality improvements can be weighed against extra cost.
25. As a developer, I want rule-based scoring in the evaluator, so that part of the judgement is deterministic and reproducible.
26. As a developer, I want LLM-as-a-judge scoring in the evaluator, so that semantic correctness and completeness are assessed beyond simple keyword presence.
27. As a developer, I want the final score per answer to use a 0–3 scale, so that quality differences are visible without pretending to be more precise than the data allows.
28. As a developer, I want a dedicated judge model role with fallback to the chat role, so that evaluation can be configured independently without blocking default usage.
29. As a developer, I want the report to be saved as markdown, so that it matches the Day 21 workflow and can be committed to git.
30. As a developer, I want the RAG feature to be tested through public behavior rather than internal implementation details, so that refactors remain safe.

## Implementation Decisions

- В существующую архитектуру добавляется отдельный доменный модуль retrieval orchestration, который отвечает за три шага: embedding пользовательского вопроса, vector search по индексу и сбор RAG-контекста для LLM.
- Retrieval orchestration не должен смешиваться с UI-логикой REPL и не должен знать о способе вывода техблока. Он возвращает структурированный результат поиска, пригодный и для чата, и для offline-оценки.
- Векторный поиск использует уже существующий индекс и существующий embedder, чтобы не дублировать инфраструктуру Day 21.
- Для RAG-конфигурации добавляются настройки: включённость режима, retrieval strategy, topK. По умолчанию: `enabled = false`, `strategy = structural`, `topK = 5`.
- Переключение RAG выполняется REPL-командой, а текущее состояние отображается отдельной статус-строкой рядом с другой сессионной информацией.
- Поддерживаемый набор REPL-команд: показать статус, включить RAG, выключить RAG, сменить retrieval strategy, сменить topK.
- В ответе с RAG используется отдельный технический вывод приложения. Сам текст модели остаётся обычным ответом, а найденные чанки, источники и distance показываются отдельным блоком.
- Жёсткий distance threshold не вводится. Система всегда пытается взять topK результатов и честно показывает retrieval-метаданные, не делая неочевидной фильтрации.
- Если индекс отсутствует, retrieval недоступен или поиск вернул пустой результат, приложение не падает и не блокирует ответ. Вместо этого печатается явное сообщение о fallback в non-RAG.
- RAG-контекст должен собираться в предсказуемом формате: список найденных чанков с source, section, distance и текстом чанка. Формат должен быть пригоден для последующего отображения в отчёте и для тестирования.
- Вопрос модели в RAG-режиме отличается от non-RAG только добавлением retrieval-контекста. Это нужно для честного сравнения качества двух режимов.
- Для оценки создаётся отдельная команда, аналогичная отдельной команде Day 21. Она не строит индекс автоматически и требует заранее подготовленную базу.
- Набор контрольных вопросов наследует Day 21 набор, но дополняется полями, необходимыми для оценки финального ответа: ожидание, ожидаемые источники, обязательные смыслы, желательные смыслы, при необходимости запрещённые утверждения.
- Проверка ожидаемых источников в автоматической оценке в основном опирается на section, потому что на текущем этапе используется один основной документ.
- Автоматическая оценка состоит из двух слоёв:
  - rules-based слой проверяет обязательные смыслы, ожидаемые section и другие формализуемые признаки;
  - judge-слой оценивает полноту, корректность и groundedness ответа по шкале 0–3.
- Финальный отчёт должен содержать для каждого вопроса: ожидание, ответ без RAG, ответ с RAG, retrieval-метаданные для RAG, стоимость обоих режимов, оценку обоих режимов и краткий verdict.
- Для оценки добавляется роль модели judge. Если отдельная модель для judge не настроена, используется модель chat.
- Поскольку текущий REPL уже поддерживает команды и состояние сессии, расширение делается поверх существующего механизма, а не через параллельный UI-слой. Это уменьшает риск костылей и UI-долга.
- Нефункционально важный принцип: RAG должен быть прозрачным. Пользователь должен всегда понимать, был ли реально использован retrieval и на каких данных основан ответ.

## Testing Decisions

- Тесты пишутся по Red-Green: сначала фиксируется ожидаемое внешнее поведение новой возможности, затем реализуется код.
- Хороший тест проверяет наблюдаемое поведение публичного интерфейса, а не внутренние шаги реализации. Для RAG это особенно важно: мы тестируем, что приложение корректно включает retrieval, делает fallback, печатает техблок и выдаёт ожидаемую структуру данных, а не то, какими именно локальными переменными это достигнуто.
- Должен появиться набор unit-тестов для retrieval orchestration модуля:
  - успешный retrieval с topK результатами;
  - пустой retrieval;
  - применение выбранной strategy;
  - корректная сборка RAG-контекста и retrieval-метаданных.
- Должны появиться тесты для интеграции RAG в chat-пайплайн:
  - non-RAG режим отправляет вопрос без retrieval-контекста;
  - RAG режим добавляет retrieval-контекст к запросу в LLM;
  - при отсутствии результатов происходит fallback в non-RAG без падения;
  - стоимость и результат retrieval доступны вызывающему коду.
- Должны появиться тесты REPL-команд:
  - показать статус RAG;
  - включить/выключить RAG;
  - сменить strategy;
  - сменить topK;
  - отклонить невалидные значения.
- Должны появиться тесты форматирования техблока retrieval:
  - наличие distance, source и section;
  - корректный вывод пустого результата;
  - корректный вывод fallback-сообщения.
- Должны появиться тесты evaluation pipeline:
  - загрузка контрольных вопросов;
  - прогон двух режимов на одном вопросе;
  - rules-based scoring;
  - агрегация judge-score и rules-score в итоговый отчёт;
  - сохранение markdown-отчёта в ожидаемом формате.
- Для judge-слоя должны быть тесты уровня orchestration с подменённым LLM-клиентом, чтобы проверять структуру judge-запроса и обработку judge-ответа без реальных сетевых вызовов.
- Live-прогон с настоящей моделью, настоящим индексом и реальным markdown-отчётом выполняется вручную перед завершением задачи. Автотесты не должны зависеть от внешнего LLM endpoint или локального Ollama.
- Prior art в кодовой базе уже есть:
  - тесты доменных сервисов и orchestration-пайплайнов;
  - тесты SQLite-репозиториев;
  - тесты presentation-слоя REPL-команд;
  - тесты indexing и vector-search модулей из Day 21.
  Новый код должен наследовать этот стиль и не привносить отдельную тестовую философию.

## Out of Scope

- Автоматическая индексация документов из REPL.
- Поддержка нескольких корпусов знаний с динамическим выбором источника пользователем.
- Гибридный retrieval (например, BM25 + vector) вместо чистого vector search.
- Семантический reranking поверх результатов vector search.
- Визуальный status bar с перерисовкой prompt и сложным TUI-поведением.
- Автоматическое определение “качества retrieval” через магический threshold по distance.
- Полноценный citation-aware ответ, где модель сама обязана формировать строгие inline-ссылки.
- Параллельная оценка на нескольких моделях и сравнение моделей между собой.
- Поддержка новой базы знаний, отличной от system-design-primer.
- Продуктовая аналитика, телеметрия и долгосрочное хранение истории evaluation run’ов.

## Further Notes

- Это упражнение должно завершить связку Day 21 → Day 22: сначала индекс, потом первый реальный RAG-запрос, потом воспроизводимое сравнение качества.
- Отдельная evaluation-команда обязательна: без неё результат будет трудно повторить и легко испортить ручными действиями.
- Прозрачность важнее “магии”. Если RAG не сработал, пользователь должен явно это увидеть.
- Стоимость нужно фиксировать всегда и для обоих режимов, иначе нельзя честно сравнить выигрыш в качестве с ростом затрат.
- В отчёте важно показывать не только числовые оценки, но и сами ответы. Иначе невозможно понять, почему score получился именно таким.
- Поскольку corpus сейчас один, проверка источников по section является достаточным и менее хрупким критерием, чем сравнение по полным путям.
- По умолчанию предпочтительна structural strategy, потому что она лучше объяснима пользователю за счёт section breadcrumbs, даже если fixed retrieval в отдельных кейсах может быть сильнее по recall.

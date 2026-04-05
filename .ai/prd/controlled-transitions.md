# День 15. Контролируемые переходы состояний

## Problem Statement

Текущая реализация стейт-машины задач имеет несколько проблем:

1. **`/task done` пробивает все фазы насквозь** — команда принудительно проходит `planning → execution → validation → done`, нарушая саму идею контролируемых переходов.
2. **Невалидный переход просто игнорируется** — если LLM пытается перепрыгнуть фазу, система выводит ошибку в консоль, но ответ показывается как есть. LLM не получает обратную связь и может продолжать нарушать.
3. **Ручные команды дублируют автоматику** — `/task pause`, `/task switch`, `/task phase` создают путаницу: переходы должны быть либо ручными, либо автоматическими.
4. **Нет аудита переходов** — невозможно посмотреть историю того, как задача проходила через фазы.
5. **Нет обратной связи при долгих операциях** — LLM-вызовы, судейские вызовы, повторные запросы происходят молча.

## Solution

Сделать все переходы между фазами **исключительно автоматическими** через маркеры в ответе LLM. Убрать все ручные команды управления фазами. При невалидном переходе — **повторный запрос к LLM** с графом допустимых переходов (до 5 попыток). Вести **аудит-лог** всех переходов. Показывать **спиннеры с описанием** на всех долгих операциях.

## User Stories

1. As a user, I want the assistant to never skip a phase (e.g. no implementation before approved plan), so that the task lifecycle is predictable.
2. As a user, I want all phase transitions to happen automatically via LLM markers, so that I don't need to manage phases manually.
3. As a user, I want the system to retry with feedback when LLM attempts an invalid transition, so that the assistant self-corrects.
4. As a user, I want to see the allowed transition graph in the retry message, so that the LLM knows exactly what transitions are valid.
5. As a user, I want retry messages to be saved in chat history, so that I can see when and why retries happened.
6. As a user, I want a maximum of 5 retry attempts before the system gives up, so that infinite loops are impossible.
7. As a user, I want tasks to automatically pause when I switch sessions, so that context is preserved without manual commands.
8. As a user, I want tasks to automatically resume when I return to a session, so that I pick up where I left off.
9. As a user, I want to see a full audit log of phase transitions for a task, so that I can understand how the task progressed.
10. As a user, I want to see spinners with descriptive labels during LLM calls, so that I know what's happening during long operations.
11. As a user, I want spinners on retry attempts, judge calls, and memory reconciliation, so that silence during long waits is eliminated.
12. As a user, I want `/task create` to remain as the explicit way to create tasks, so that I have control over when tasks are created.
13. As a user, I want task auto-detection to ask for confirmation before creating, so that accidental tasks aren't created.
14. As a user, I want `/task list` to show transition history alongside task info, so that I can review the lifecycle at a glance.
15. As a user, I want `/task cancel` to remain available, so that I can abandon a task at any point.
16. As a user, I want the transition markers to use JSON format in HTML comments, so that parsing is reliable and markers don't leak into output.

## Implementation Decisions

### Удаляемые команды и методы

Убираем из REPL:
- `/task done` — нарушает контролируемые переходы
- `/task pause` — пауза только автоматическая при смене сессии/задачи
- `/task switch` — переключение задач через создание новой (старая автопаузится)
- `/task phase` — если существует, убираем

Убираем из TaskService:
- `pauseTask()` — пауза только через `pauseAllActive()`
- `resumeTask()` — resume только через автоматику при входе в сессию

### Формат маркеров перехода

JSON в HTML-комментариях (уже частично используется):

```
<!--task-update
{"transition": "execution", "summary": "План утверждён, начинаю реализацию"}
-->
```

Автодетект задачи:
```
<!--task-detect
{"title": "Название задачи"}
-->
```

### Retry-логика при невалидном переходе

1. LLM возвращает ответ с маркером перехода
2. Код парсит маркер, проверяет переход через `TaskStateMachine.canTransition()`
3. Если переход невалиден:
   a. Сохраняем системное сообщение в историю: "Переход {from} → {to} запрещён. Допустимые переходы: {граф}"
   b. Показываем спиннер "Повторный запрос (попытка N/5)..."
   c. Отправляем повторный запрос к LLM с этим сообщением в контексте
   d. Повторяем до 5 раз
4. Если после 5 попыток переход всё ещё невалиден — показываем последний ответ без перехода, пишем предупреждение в лог

### Граф переходов для промпта ошибки

`TaskStateMachine` получает метод `describeTransitions()`, возвращающий человекочитаемое описание графа:

```
planning → execution | cancelled
execution → validation | planning | cancelled
validation → done | execution | cancelled
done → (терминальное)
cancelled → (терминальное)
```

Этот граф включается в системное сообщение при retry.

### Аудит-лог переходов

Новая таблица `task_transitions`:
- `id` — автоинкремент
- `task_id` — FK на tasks
- `from_phase` — фаза до перехода
- `to_phase` — фаза после перехода
- `triggered_by` — "llm" | "system" | "user"
- `created_at` — timestamp

`triggered_by`:
- `"llm"` — переход через маркер в ответе LLM
- `"system"` — автопауза при смене сессии, авто-resume при входе
- `"user"` — `/task cancel`, `/task create` (создание = переход в planning)

TaskService логирует каждый переход через `TaskTransitionRepository`.

### Автопауза и авто-resume

**Пауза** происходит только автоматически:
- При смене сессии (`/switch N`) — `pauseAllActive(oldSessionId)`
- При создании новой задачи — текущая активная паузится
- При выходе (`/exit`) — `pauseAllActive(currentSessionId)`

**Resume** происходит только автоматически:
- При входе в сессию — если есть единственная paused задача, она автоматически возобновляется
- Если paused задач несколько — показываем список, но не resume (пользователь создаёт новую или продолжает без задачи)

### Спиннеры на долгих операциях

Добавить спиннеры с описательными метками:
- "Генерация ответа..." — основной LLM-вызов
- "Повторный запрос (попытка N/5)..." — retry при невалидном переходе
- "Анализ ответа..." — вызов судьи (если сохраняется)
- "Обновление памяти..." — reconciliation
- "Генерация заголовка..." — auto-title сессии

Использовать существующий `startSpinner()`.

### Обновление TaskStateMachine

Убираем `paused` из карты переходов как самостоятельное состояние для LLM-переходов. LLM не может перевести задачу в `paused` — это делает только система. Карта переходов для LLM:

```
planning   → execution, cancelled
execution  → validation, planning, cancelled
validation → done, execution, cancelled
done       → (терминальное)
cancelled  → (терминальное)
```

`paused` остаётся как внутреннее состояние для автопаузы/resume.

Новые методы:
- `getAllowedTransitions(from: TaskPhase): TaskPhase[]` — список допустимых целевых фаз
- `describeTransitions(): string` — человекочитаемый граф для промптов

### Обновление промптов

Фазовые промпты обновляются:
- Явно указывают допустимые переходы из текущей фазы
- Не упоминают `paused` (LLM не может паузить)
- Включают граф переходов в системный промпт

## Testing Decisions

Хороший тест проверяет **внешнее поведение**, а не внутреннюю реализацию. Тест должен оставаться зелёным при рефакторинге внутренностей, пока поведение не меняется.

### Модули для тестирования

**TaskStateMachine** (юнит-тесты):
- Все допустимые переходы возвращают `true`
- Все недопустимые переходы (включая перепрыгивание фаз) возвращают `false`
- Терминальные состояния не имеют переходов
- `paused → cancelled` запрещён (только система управляет paused)
- `getAllowedTransitions()` возвращает корректный список
- `describeTransitions()` содержит все фазы

**TaskService** (юнит-тесты с мок-репозиторием):
- `transition()` логирует переход в аудит
- `transition()` отклоняет невалидный переход и не логирует его
- `pauseAllActive()` логирует переходы с `triggered_by: "system"`
- `cancelTask()` логирует с `triggered_by: "user"`
- Создание задачи паузит предыдущую и логирует оба перехода

**TaskTransitionRepository** (интеграционные тесты с SQLite):
- CRUD для записей аудита
- Выборка по task_id
- Корректные timestamps

**REPL retry-логика** (юнит-тесты):
- Невалидный переход вызывает повторный запрос
- Системное сообщение с графом сохраняется в историю
- После 5 неудачных попыток — показ ответа без перехода
- Валидный переход после retry применяется корректно

**Спиннеры** (юнит-тесты):
- Спиннер запускается перед LLM-вызовом и останавливается после
- Корректные метки для разных типов операций

### Prior art

Тесты следуют паттерну проекта:
- `*.test.ts` рядом с модулем
- Bun test runner (`bun:test`)
- Моки через интерфейсы (порты)
- Примеры: `task-service.test.ts`, `task-state-machine.test.ts`, `repl/index.test.ts`

## Out of Scope

- Вложенные задачи / подзадачи
- Пользовательская настройка набора фаз
- Визуализация графа переходов в UI
- Кросс-сессионные задачи
- Приоритеты и дедлайны
- Экспорт/импорт задач
- Детекция нарушения фазы по содержимому ответа (например, код в фазе planning) — только по маркерам переходов

## Further Notes

- Миграция БД: добавление таблицы `task_transitions` обратно совместима.
- Если в сессии нет активной задачи, агент работает в обычном режиме + промпт автодетекта.
- Маркер `<!--task-update-->` — HTML-комментарий, не ломает рендеринг.
- Retry-сообщения сохраняются в историю как `role: "user"` (системные) — LLM видит их как контекст.

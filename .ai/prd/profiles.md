# PRD: Персонализация ассистента (профили пользователей)

## Problem Statement

Ассистент отвечает всем пользователям одинаково — без учёта индивидуальных предпочтений по стилю, формату и ограничениям. Нет способа настроить поведение под конкретного пользователя. Также система памяти хранится в файлах, что не согласуется с остальной архитектурой (SQLite).

## Solution

Добавить систему профилей пользователей с хранением в SQLite. Профиль содержит структурированные предпочтения (имя, язык, стиль, формат, ограничения, произвольные настройки) и автоматически подключается к каждому запросу через system prompt. Поддерживается несколько профилей с переключением. Параллельно — миграция памяти из файлов в SQLite.

## User Stories

1. As a user, I want to create a profile with my name, so that the assistant addresses me personally
2. As a user, I want to set my preferred response language, so that the assistant always replies in the right language
3. As a user, I want to choose a communication style (formal, informal, technical), so that responses match my expectations
4. As a user, I want to set response format preferences (brief, detailed, with code examples), so that I get information in the most useful form
5. As a user, I want to define restrictions (forbidden topics, technology preferences), so that the assistant respects my boundaries
6. As a user, I want to add arbitrary key-value preferences, so that I can customize behavior beyond predefined fields
7. As a user, I want to create multiple profiles, so that I can switch between different personas or use cases
8. As a user, I want to switch between profiles via `/profile switch`, so that I can quickly change the assistant's behavior
9. As a user, I want to view my current profile via `/profile`, so that I can see what settings are active
10. As a user, I want to list all profiles via `/profile list`, so that I can see available profiles
11. As a user, I want to edit profile fields via `/profile set <key> <value>`, so that I can fine-tune preferences
12. As a user, I want to delete profiles via `/profile delete`, so that I can remove unused profiles
13. As a user, I want the active profile to be automatically applied to every LLM request, so that personalization works without manual intervention
14. As a user, I want to see how different profiles change the assistant's responses, so that I can verify personalization works
15. As a user, I want memory (long-term and working) stored in SQLite instead of files, so that all data is in one place
16. As a user, I want the active profile ID stored in options, so that it persists between sessions

## Implementation Decisions

### Новые таблицы в SQLite

**profiles** — основная таблица профилей:
- `id` (INTEGER PRIMARY KEY)
- `name` (TEXT NOT NULL) — имя профиля
- `user_name` (TEXT) — как обращаться к пользователю
- `language` (TEXT) — язык ответов
- `style` (TEXT) — стиль общения (formal / informal / technical)
- `format` (TEXT) — формат ответов (brief / detailed / with_examples)
- `restrictions` (TEXT) — ограничения в свободной форме
- `created_at`, `updated_at` (DATETIME)

**profile_preferences** — произвольные ключ-значение:
- `id` (INTEGER PRIMARY KEY)
- `profile_id` (INTEGER, FK → profiles)
- `key` (TEXT NOT NULL)
- `value` (TEXT NOT NULL)
- UNIQUE(profile_id, key)

**long_term_memories** — долгосрочная память (миграция из файла):
- `id` (INTEGER PRIMARY KEY)
- `content` (TEXT NOT NULL)
- `created_at`, `updated_at` (DATETIME)

**working_memories** — рабочая память (миграция из файла):
- `id` (INTEGER PRIMARY KEY)
- `content` (TEXT NOT NULL)
- `created_at`, `updated_at` (DATETIME)

### Хранение активного профиля

Активный профиль хранится в таблице `options` с ключом `active_profile_id`. Если значение не задано или профиль удалён — ассистент работает без персонализации.

### Новые модули (порты и адаптеры)

**ProfileRepository** (порт) — интерфейс для CRUD профилей:
- `create(profile)` → id
- `getById(id)` → Profile | null
- `getAll()` → Profile[]
- `update(id, fields)` → void
- `delete(id)` → boolean
- `getPreferences(profileId)` → Preference[]
- `setPreference(profileId, key, value)` → void
- `deletePreference(profileId, key)` → boolean

**SqliteProfileRepository** (адаптер) — реализация через SQLite.

**ProfileService** (сервис) — бизнес-логика:
- `createProfile(data)` → id
- `getActiveProfile()` → Profile | null (читает `active_profile_id` из options)
- `setActiveProfile(id)` → void (пишет в options)
- `buildProfileBlock(profile)` → string (формирует структурированный блок для system prompt)
- CRUD-делегация в репозиторий

**MemoryRepository** (порт) — интерфейс для памяти в SQLite (замена MemoryStore):
- `getAll(type)` → Memory[]
- `set(type, content)` → void
- `clear(type)` → void

**SqliteMemoryRepository** (адаптер) — реализация.

### Подключение профиля к запросам

В `ChatService.sendMessage()` профиль добавляется в system prompt как структурированный блок:

```
=== Профиль пользователя ===
Имя: Алексей
Язык: русский
Стиль: неформальный
Формат: краткий
Ограничения: не использовать Java-примеры
Предпочтения:
- framework: React
- editor: VSCode
===========================
```

Блоки памяти остаются в instructions (как сейчас).

### Команды REPL

- `/profile` — показать активный профиль
- `/profile create <name>` — создать профиль
- `/profile list` — список всех профилей
- `/profile switch <id>` — переключить активный профиль
- `/profile set <key> <value>` — установить поле профиля (стандартное или произвольное)
- `/profile delete <id>` — удалить профиль

### Миграция памяти

- `FileMemoryStore` заменяется на `SqliteMemoryRepository`
- `MemoryService` переключается на новый репозиторий
- Интерфейс `MemoryStore` заменяется на `MemoryRepository`

## Testing Decisions

Хороший тест проверяет внешнее поведение модуля через его публичный интерфейс, а не внутреннюю реализацию. Тесты не должны зависеть от конкретной структуры БД или файловой системы — только от контрактов портов.

### Модули для тестирования

**SqliteProfileRepository** — CRUD операции:
- Создание, чтение, обновление, удаление профилей
- Работа с произвольными предпочтениями (set/get/delete)
- Граничные случаи (несуществующий ID, дубликаты ключей)
- Образец: `src/storage/sqlite/session-repository.test.ts`

**ProfileService** — бизнес-логика:
- `getActiveProfile()` при наличии/отсутствии активного профиля
- `buildProfileBlock()` — корректная сборка блока для prompt
- `setActiveProfile()` — запись в options
- Образец: `src/domain/services/session-service.test.ts`

**SqliteMemoryRepository** — миграция памяти:
- CRUD для обоих типов памяти (long_term / working)
- Образец: `src/storage/sqlite/fact-repository.test.ts`

**ChatService** — интеграция профиля:
- Проверка что профиль попадает в system prompt
- Проверка что без активного профиля запрос работает как раньше
- Образец: `src/domain/services/chat-service.test.ts`

## Out of Scope

- Автоматическое определение предпочтений из разговора (автопрофилирование)
- Импорт/экспорт профилей
- Профили, привязанные к сессиям (один профиль на всё приложение)
- UI для редактирования профиля вне REPL (веб-интерфейс и т.д.)
- Миграция существующих файлов памяти в SQLite при первом запуске (ручной перенос)

## Further Notes

- Порядок блоков в system prompt: базовый промпт → профиль пользователя. Память и факты — в instructions.
- При удалении активного профиля — `active_profile_id` из options сбрасывается.
- Стандартные поля профиля (style, format) имеют свободный формат — без жёсткого enum, чтобы пользователь мог писать произвольные значения.

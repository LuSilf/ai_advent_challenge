# AI Avent Challenge

Простой CLI-инструмент на Bun: отправляет промпт в любой OpenAI-совместимый LLM endpoint и печатает ответ в терминал.

## Настройка

1. Установите Bun (если еще не установлен): https://bun.sh
2. Скопируйте env-файл:

```bash
cp .env.example .env
```

3. Экспортируйте реальный ключ в shell (или в переменные окружения ОС):

```bash
export OPENAI_API_KEY="your_real_key"
```

4. Заполните значения в `.env`:
   - `OPENAI_API_KEY_ENV` (имя переменной окружения с ключом, по умолчанию `OPENAI_API_KEY`)
   - `OPENAI_MODEL`
   - Опционально `OPENAI_BASE_URL` для не-OpenAI провайдеров
   - Опционально `OPENAI_API_KEY` для прямого указания ключа (без промежуточной переменной)
   - Опционально `OPENAI_SYSTEM_PROMPT` для переопределения встроенного системного промпта
   - Опционально `OPENAI_TIMEOUT_MS` таймаут запроса в мс (по умолчанию `30000`)
   - Опционально `OPENAI_STREAM` включает/выключает streaming (по умолчанию включен)
    - Опционально `OPENAI_DEBUG` (`1|0|true|false|yes|no|on|off`) для вывода endpoint/model/параметров в stderr
      и расширенной статистики ответа (токены, время, статус, reasoning summary)
   - Опциональные параметры генерации (подробности ниже):
     - `OPENAI_TEMPERATURE`
     - `OPENAI_TOP_P`
     - `OPENAI_N`
     - `OPENAI_REASONING_EFFORT`
      - `OPENAI_REASONING_SUMMARY`
      - `OPENAI_MAX_COMPLETION_TOKENS`
     - `OPENAI_PRESENCE_PENALTY`
     - `OPENAI_FREQUENCY_PENALTY`

## Параметры генерации

Все параметры ниже опциональны и передаются напрямую в `responses.create`.
Поддержка конкретных параметров может отличаться у разных моделей и OpenAI-совместимых провайдеров.

- `OPENAI_STREAM` (`1|0|true|false|yes|no|on|off`, по умолчанию `true`)
  - Включает или отключает потоковый вывод токенов.
  - `true`: ответ печатается по мере генерации.
  - `false`: сначала ждет полный ответ, затем печатает целиком.
  - Документация: https://platform.openai.com/docs/guides/streaming-responses

- `OPENAI_TEMPERATURE` (`0..2`)
  - Управляет случайностью ответа. Ниже значение - более детерминированный вывод, выше - более креативный.
  - Документация: https://platform.openai.com/docs/api-reference/chat/create#chat-create-temperature

- `OPENAI_TOP_P` (`0..1`)
  - Nucleus sampling: модель выбирает токены из набора, где суммарная вероятность равна `top_p`.
  - Обычно настраивают либо `temperature`, либо `top_p`, но не оба сразу.
  - Документация: https://platform.openai.com/docs/api-reference/chat/create#chat-create-top_p

- `OPENAI_N` (целое `>= 1`)
  - Количество вариантов ответа в одном запросе. Больше вариантов = выше расход токенов/стоимость.
  - Документация: https://platform.openai.com/docs/api-reference/chat/create#chat-create-n

- `OPENAI_REASONING_EFFORT` (`none|minimal|low|medium|high|xhigh`)
  - Управляет объемом reasoning-бюджета модели. Меньше значение обычно быстрее/дешевле, больше может помочь на сложных задачах.
  - Поддержка зависит от семейства модели.
  - Документация: https://platform.openai.com/docs/guides/reasoning

- `OPENAI_REASONING_SUMMARY` (`auto|concise|detailed`)
  - Просит модель вернуть summary reasoning (если модель/провайдер поддерживает).
  - Summary выводится в `stderr` при `OPENAI_DEBUG=1`.
  - Документация: https://platform.openai.com/docs/guides/reasoning

- `OPENAI_MAX_COMPLETION_TOKENS` (целое `>= 1`)
  - Верхняя граница числа сгенерированных completion-токенов (включая reasoning-токены, если применимо).
  - Документация: https://platform.openai.com/docs/api-reference/chat/create#chat-create-max_completion_tokens

- `OPENAI_PRESENCE_PENALTY` (`-2..2`)
  - Повышает новизну тем. Чем выше значение, тем сильнее модель склоняется к новым темам.
  - В текущей версии CLI параметр не поддерживается Responses API и игнорируется (с предупреждением в debug-режиме).
  - Документация: https://platform.openai.com/docs/api-reference/chat/create#chat-create-presence_penalty

- `OPENAI_FREQUENCY_PENALTY` (`-2..2`)
  - Штрафует повторы токенов. Чем выше значение, тем меньше буквальных повторов фраз/строк.
  - В текущей версии CLI параметр не поддерживается Responses API и игнорируется (с предупреждением в debug-режиме).
  - Документация: https://platform.openai.com/docs/api-reference/chat/create#chat-create-frequency_penalty

- `OPENAI_N` (целое `>= 1`)
  - Исторический параметр для Chat Completions API.
  - В текущей версии CLI при Responses API игнорируется (с предупреждением в debug-режиме).

## Использование

```bash
bun run src/cli.ts "Объясни рекурсию одним предложением"
```

Или через script:

```bash
bun run start "Объясни рекурсию одним предложением"
```

## Пример с локальным OpenAI-совместимым endpoint

```bash
OPENAI_BASE_URL=http://localhost:1234/v1 OPENAI_MODEL=local-model bun run start "Привет"
```

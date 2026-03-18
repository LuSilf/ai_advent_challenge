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
     - `OPENAI_REASONING_EFFORT`
      - `OPENAI_REASONING_SUMMARY`
      - `OPENAI_MAX_COMPLETION_TOKENS`

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

## Сравнение 4 способов решения через API

В репозитории есть скрипт эксперимента, который прогоняет набор из 20 задач четырьмя методами:

- `direct` - прямой запрос без дополнительных инструкций
- `step_by_step` - с инструкцией "Solve step by step"
- `meta_prompt` - сначала просит модель создать промпт, затем решает им задачу
- `experts` - четыре отдельных запроса: критик, психолог, учитель, биолог

Запуск:

```bash
bun run experiment
```

Во время прогона скрипт печатает для каждого метода:

- промпт(ы), отправленные в API
- полный текст ответа
- reasoning summary (если провайдер вернул его)
- токены и задержку каждого API-вызова

Полезные переменные окружения:

- `EXPERIMENT_TASK_LIMIT` - сколько задач взять из набора (по умолчанию `20`)
- `EXPERIMENT_RUNS_PER_TASK` - число прогонов на задачу (по умолчанию `1`)
- `EXPERIMENT_TEMPERATURE` - температура для всех вызовов
- `EXPERIMENT_REASONING_SUMMARY` - `auto|concise|detailed` для запроса reasoning summary
- `EXPERIMENT_PRICE_INPUT_PER_1M` - цена входных токенов за 1M (USD)
- `EXPERIMENT_PRICE_OUTPUT_PER_1M` - цена выходных токенов за 1M (USD)

Сейчас в коде зашита одна задача для сравнения техник промптинга (2 яйца, 100 этажей),
поэтому режим работает как поведенческое сравнение без оценки правильности.

Пример с оценкой стоимости:

```bash
EXPERIMENT_PRICE_INPUT_PER_1M=5 \
EXPERIMENT_PRICE_OUTPUT_PER_1M=15 \
bun run experiment
```

# Day 26 — Conclusions

_Заполняется руками после прогона `bun run day26-local`. Автораннер трогает этот файл только при первом создании._

## Что удивило

- **Llama 3.2:3b обогнала Qwen2.5-Coder:7b в 4 раза по скорости** на reasoning/code (38 vs 9 tps). Причина: 7B уходит за границу VRAM (95% утилизация по llmfit), часть слоёв падает на CPU → penalty. На этом железе 3B помещается целиком в VRAM и летит.
- **gpt-5-nano через OpenRouter выдаёт 108 tps на reasoning** — в 3 раза быстрее, чем самая быстрая local модель. Ожидаемо, но показательно: cloud latency идёт не от сети, а от размера/распараллеливания на DC.
- **Prompt tokens у cloud меньше, чем у local** (24–82 vs 43–86). Вероятно, OpenRouter не дублирует system prompt, который Ollama добавляет от template модели.
- **Код-ответы у Qwen и Llama обёрнуты в ```typescript fence, хотя prompt явно просил "output only the code, no explanation"**. Инструкции формата следуют только cloud, но и там gpt-5-nano добавляет JSDoc-комментарий чуть не в каждое ответ — меньше формалистики.

## Где local уступил cloud

- **Скорость reasoning**: 9 tps (Qwen) / 38 tps (Llama) vs 108 tps (gpt-5-nano). Для чата/ассистента в реальном времени разница ощутима.
- **Качество структурированного вывода на q02**: cloud-ответ разбит на логические секции с "Pros/Cons/When to use which", у Qwen и Llama структура плоская ("Trade-offs:" в лоб).
- **Follow instruction**: на q03 "output only code" cloud ближе к спецификации, local оборачивает в markdown fence.

## Где local не уступил (или обогнал)

- **q01_factual ("capital of France")**: все три target ответили "Paris". Local даже короче (2 completion tokens vs 96–122 у cloud — gpt-5-nano тратит reasoning tokens даже на тривиальщину).
- **Корректность кода**: все три binarySearch-варианта корректны и читаемы. Ни одного бага. Для reference-кода local = cloud.
- **Стоимость**: local = $0, cloud за три запроса = ~$0.00152. Мелочь, но на миллионе запросов это уже ощутимо — и у local cost не масштабируется по нагрузке.
- **Latency на коротких ответах**: q01 у всех ~2–3 секунды; cloud не выигрывает за счёт network round-trip.

## Детерминизм (temperature=0, seed=42)

Повторный прогон сравнивался через `diff` (игнорируя timestamps и latency):

- **Local (Ollama) — stable**: completion_tokens идентичны для всех 6 local вызовов, тексты ответов совпадают байт-в-байт. Seed=42 в Ollama соблюдается.
- **Cloud (gpt-5-nano через OpenRouter) — drifting**: completion_tokens расходятся (например, q02 — 2779 vs 2434, q01 — 96 vs 122). Тексты отличаются уже в первом предложении. **Seed не соблюдается у gpt-5-nano через OpenRouter** — это reasoning-модель, у неё нет гарантий детерминизма даже при temperature=0, а OpenRouter, видимо, seed просто не прокидывает в upstream.

Практический вывод: для воспроизводимых eval-прогонов (day22–24 тоже) cloud через OpenRouter нельзя считать детерминистичным, и какие-то метрики между прогонами будут скакать. Local — можно.

## Downgrades / проблемы

- Никаких downgrades не потребовалось: qwen2.5-coder:7b отработал без OOM, несмотря на marginal VRAM fit (95% по llmfit). CUDA-offload справился.
- Временные метрики стабильны между прогонами (разброс <5%), значит, cache/warmup уже прогрет после первого вызова.
- OpenAI SDK ходит в Ollama без единой правки — главная техническая гипотеза дня подтверждена.

## Next steps (day 27+)

- **Провайдер-переключатель в REPL** (`OPENAI_BASE_URL` override на уровне CLI флага). Затраченного времени на integration: ~5 строк изменений в `src/config.ts` + `src/request.ts`. Теперь это имеет смысл — совместимость доказана.
- **Offline RAG**: embedding-модели (bge-m3, nomic-embed-text) уже в Ollama → весь RAG-стек можно гонять без internet. Единственная зависимость от cloud — сама LLM, которую теперь можно заменить на llama3.2:3b для быстрых проверок eval-скриптов без сжигания cloud-бюджета.
- **Benchmark на судью**: прогнать day22-24 eval-сценарии с llama3.2:3b в роли answerer и gpt-5-nano в роли judge — сравнить с текущим full-cloud baseline. Это покажет, можно ли выносить production-нагрузку на local.
- **Context window stress-test**: q02/q03 использовали <100 prompt tokens. Надо прогнать 4k+ context — у Qwen 7B marginal VRAM уже может уйти в OOM, у Llama 3B — пока OK.

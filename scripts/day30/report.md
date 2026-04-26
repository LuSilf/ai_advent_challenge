# Day 30 — Local LLM HTTP service load-test report

Generated at: 2026-04-26T17:24:47.997Z
Base URL:     http://localhost:8080
Model:        llama3.2:3b
Hardware:     CPU: unknown CPU | unknown RAM | GPU: no GPU
/health:      ok, ollama=up

## Summary

| Scenario              | Verdict |
|-----------------------|---------|
| Smoke (1 request)     | ✅ PASS |
| Concurrency ladder    | ✅ PASS |
| Rate limit (1 key)    | ✅ PASS |
| Max context reject    | ✅ PASS |
| Bad auth → 401        | ✅ PASS |
| Bad model → 400       | ✅ PASS |

## 1. Smoke

- HTTP status: `200`
- Latency: `505 ms`
- Verdict: ✅ PASS

## 2. Concurrency ladder

Запросы прогоняются параллельно через `Promise.all`. Перед каждой фазой —
15s паузы для пополнения rate-limit корзины.
Latency приведена для успешных запросов (HTTP 200), мс.

| N parallel | OK | Errors | Wall-time, ms | Mean | p50 | p95 | p99 | Error statuses |
|-----------:|---:|-------:|--------------:|-----:|----:|----:|----:|:---------------|
| 1 | 1 | 0 | 422 | 421 | 421 | 421 | 421 | — |
| 2 | 2 | 0 | 372 | 311 | 251 | 372 | 372 | — |
| 5 | 5 | 0 | 706 | 487 | 486 | 706 | 706 | — |
| 10 | 10 | 0 | 1510 | 1018 | 963 | 1509 | 1509 | — |

> Wall-time = время от старта batch'а до возврата всех ответов. На single-GPU
> Ollama сериализует инференс — wall-time растёт ~линейно с N.

## 3. Rate limit hit (single key)

Параллельно отправлено `15` запросов на один ключ.

- HTTP 200: `10`
- HTTP 429: `5`
- Все коды: `200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 429, 429, 429, 429, 429`
- Verdict: ✅ PASS (хотя бы один 429 ожидается при default capacity=10)

## 4. Max context reject

Отправлен запрос с `messages[0].content` ≈ 10K токенов.

- HTTP status: `413` (ожидается 413)
- Body: `{"error":{"message":"Input too large: 20008 tokens exceeds limit of 6000","type":"input_too_large","limit":6000,"got":20008}}`
- Verdict: ✅ PASS

## 5. Bad auth → 401

Запрос с `Authorization: Bearer this-is-not-a-valid-key`.

- HTTP status: `401` (ожидается 401)
- Body: `{"error":{"message":"Unauthorized: missing or invalid Bearer token","type":"unauthorized"}}`
- Verdict: ✅ PASS

## 6. Bad model → 400

Запрос с моделью, не входящей в allowlist.

- HTTP status: `400` (ожидается 400)
- Body: `{"error":{"message":"Model 'definitely-not-a-real-model:0.0' is not allowed. Allowed models: llama3.2:3b, qwen2.5-coder:7b","type":"model_not_allowed","allowed":["llama3.2:3b","qwen2.5-coder:7b"]}}`
- Verdict: ✅ PASS

---

Raw данные (latency-массивы и тела ответов) сохранены в
`scripts/day30/raw/load-test-2026-04-26T17-23-23-639Z.json`.

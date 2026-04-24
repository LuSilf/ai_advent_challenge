# Day 29 — Отчёт по оптимизации локальной LLM

Generated at: 2026-04-24T05:04:17.941Z
Выборка: 5 вопросов (q03, q10, q11_oos, q12_oos, q13_oos) × 2 режима (baseline, rag-full) × 2 runs × 1 backend (local)
Guard-rail: in-scope cloud-judge avg >= 1.43 (baseline − 0.2)

## Executive summary

**На Парето-фронте: c0, c2.**

## Главный результат по цели дня

Цель: поднять refusal rate q11_oos с 0/4 до 2-4/4. Результат:

| config | q11_oos | q12_oos | q13_oos | OOS total |
|---|---|---|---|---|
| c0 | 0/4 | 0/4 | 0/4 | 0/12 |
| c1 | 0/4 | 0/4 | 0/4 | 0/12 |
| c2 | 0/4 | 0/4 | 0/4 | 0/12 |
| c3 | 0/4 | 0/4 | 0/4 | 0/12 |

## Таблица по 4 осям Парето

| config | refusal | in-scope C-avg | p50 latency | VRAM (MB) | verdict |
|---|---|---|---|---|---|
| c0 | 0/12 | 1.63 | 25.8s | 3235 | ✅ on-front |
| c1 | 0/12 | 1.38 | 24.8s | 3237 | ❌ rejected (in-scope 1.38 < floor 1.43) |
| c2 | 0/12 | 1.63 | 23.9s | 3237 | ✅ on-front |
| c3 | 0/12 | 1.25 | 69.6s | 3257 ⚠partial | ❌ rejected (in-scope 1.25 < floor 1.43) |

## Детально по конфигам

### c0 — baseline (day28 defaults, soft prompt, q4_K_M)

- model: `qwen3:4b-instruct-2507-q4_K_M` · promptVariant: **soft** · temp=0.2 · max=800 · num_ctx=default
- overall cloud-judge avg: **1.20**, local-judge avg: **0.65**
- in-scope (q03+q10) C-avg: **1.63**, OOS C-avg: 0.92
- refusal: **0/12** (0%)
- per-question C-avg: q03=2.75, q10=0.50, q11_oos=0.75, q12_oos=0.75, q13_oos=1.25
- latency p50: **25.8s**, p95: 60.1s, gen elapsed: 621s
- VRAM peak: **3235 MB**

### c1 — c0 + strict refusal prompt

- model: `qwen3:4b-instruct-2507-q4_K_M` · promptVariant: **strict** · temp=0.2 · max=800 · num_ctx=default
- overall cloud-judge avg: **0.85**, local-judge avg: **0.45**
- in-scope (q03+q10) C-avg: **1.38**, OOS C-avg: 0.50
- refusal: **0/12** (0%)
- per-question C-avg: q03=2.25, q10=0.50, q11_oos=0.25, q12_oos=0.50, q13_oos=0.75
- latency p50: **24.8s**, p95: 58.3s, gen elapsed: 576s
- VRAM peak: **3237 MB**

### c2 — c1 + tight params (temp=0, max=400, num_ctx=8192)

- model: `qwen3:4b-instruct-2507-q4_K_M` · promptVariant: **strict** · temp=0 · max=400 · num_ctx=8192
- overall cloud-judge avg: **1.05**, local-judge avg: **0.35**
- in-scope (q03+q10) C-avg: **1.63**, OOS C-avg: 0.67
- refusal: **0/12** (0%)
- per-question C-avg: q03=2.50, q10=0.75, q11_oos=0.25, q12_oos=0.50, q13_oos=1.25
- latency p50: **23.9s**, p95: 57.1s, gen elapsed: 597s
- VRAM peak: **3237 MB**

### c3 — c2 + q8_0 quantization (registry даёт только q4/q8/fp16)

- model: `qwen3:4b-instruct-2507-q8_0` · promptVariant: **strict** · temp=0 · max=400 · num_ctx=8192
- overall cloud-judge avg: **1.00**, local-judge avg: **0.55**
- in-scope (q03+q10) C-avg: **1.25**, OOS C-avg: 0.83
- refusal: **0/12** (0%)
- per-question C-avg: q03=2.25, q10=0.25, q11_oos=0.75, q12_oos=0.50, q13_oos=1.25
- latency p50: **69.6s**, p95: 177.8s, gen elapsed: 1483s
- VRAM peak: **3257 MB** **⚠ partial CPU/GPU offload**

## Выводы

Baseline C0 refusal rate: **0/12**. Цель дня (2-4/4) не достигнута ни одним из C1-C3. Ручной разбор — в `analysis.md`.

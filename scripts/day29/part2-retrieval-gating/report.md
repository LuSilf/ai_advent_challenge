# Day 29 part 2 — Retrieval-gating Отчёт

Generated at: 2026-04-24T06:51:30.517Z
Выборка: 5 вопросов (q03, q10, q11_oos, q12b_oos, q13_oos) × 2 режима × 2 runs × 1 backend (local)
Baseline: **d0**. Guard-rail: in-scope cloud-judge avg >= **1.18** (D0 baseline − 0.2).

## Executive summary

**На Парето-фронте: d0, d1.**

**Лучший по detector-refusal**: **d1** с 6/12 отказов.

Цель part1 (refusal 2-4/4 на q11_oos) — **ДОСТИГНУТА**.

## Главный результат по цели

| config | threshold | q11_oos | q12b_oos | q13_oos | Detector total | Judge total | Skipped LLM |
|---|---|---|---|---|---|---|---|
| d0 | — | 0/4 | 0/4 | 0/4 | 0/12 | 4/12 | 0/20 |
| d1 | 0.30 | 2/4 | 2/4 | 2/4 | 6/12 | 8/12 | 6/20 |
| d2 | 0.50 | 2/4 | 2/4 | 2/4 | 6/12 | 8/12 | 6/20 |
| d3 | 0.70 | 2/4 | 2/4 | 2/4 | 6/12 | 7/12 | 8/20 |

## Парето-таблица (4 оси)

| config | refusal | in-scope C-avg | p50 latency | VRAM (MB) | verdict |
|---|---|---|---|---|---|
| d0 | 0/12 | 1.38 | 28.7s | 3235 | ✅ on-front |
| d1 | 6/12 | 1.75 | 7.9s | 3237 | ✅ on-front |
| d2 | 6/12 | 1.63 | 8.5s | 3237 | ⬇ dominated by d1 |
| d3 | 6/12 | 1.71 | 10.0s | 3237 | ⬇ dominated by d1 |

## Детально по конфигам

### d0 — baseline (no gating, soft prompt, q4_K_M) — control, as part1 C0 but with q12b

- gating threshold: **disabled**
- overall cloud-judge avg: 1.35, local-judge avg: 1.15
- in-scope (q03+q10) C-avg: **1.38**, OOS C-avg: 1.33
- detector refusal: **0/12**, judge refusal: 4/12, skipped LLM: 0/20
- per-question C-avg: q03=2.25, q10=0.50, q11_oos=0.50, q13_oos=0.50, q12b_oos=3.00
- per-question refusal (detector | judge | skipped):
    - q11_oos: detector=0/4, judge=0/4, skipped=0/4
    - q13_oos: detector=0/4, judge=0/4, skipped=0/4
    - q12b_oos: detector=0/4, judge=4/4, skipped=0/4
- latency p50: **28.7s**, p95: 47.9s, gen elapsed: 605s
- VRAM peak: 3235 MB

### d1 — retrieval-gating, threshold=0.3 (soft)

- gating threshold: **0.30**
- overall cloud-judge avg: 1.85, local-judge avg: 1.85
- in-scope (q03+q10) C-avg: **1.75**, OOS C-avg: 1.92
- detector refusal: **6/12**, judge refusal: 8/12, skipped LLM: 6/20
- per-question C-avg: q03=3.00, q10=0.50, q11_oos=1.50, q13_oos=2.00, q12b_oos=2.25
- per-question refusal (detector | judge | skipped):
    - q11_oos: detector=2/4, judge=2/4, skipped=2/4
    - q13_oos: detector=2/4, judge=3/4, skipped=2/4
    - q12b_oos: detector=2/4, judge=3/4, skipped=2/4
- latency p50: **7.9s**, p95: 60.2s, gen elapsed: 451s
- VRAM peak: 3237 MB

### d2 — retrieval-gating, threshold=0.5 (main candidate)

- gating threshold: **0.50**
- overall cloud-judge avg: 1.90, local-judge avg: 1.75
- in-scope (q03+q10) C-avg: **1.63**, OOS C-avg: 2.08
- detector refusal: **6/12**, judge refusal: 8/12, skipped LLM: 6/20
- per-question C-avg: q03=2.75, q10=0.50, q11_oos=2.00, q13_oos=1.50, q12b_oos=2.75
- per-question refusal (detector | judge | skipped):
    - q11_oos: detector=2/4, judge=2/4, skipped=2/4
    - q13_oos: detector=2/4, judge=2/4, skipped=2/4
    - q12b_oos: detector=2/4, judge=4/4, skipped=2/4
- latency p50: **8.5s**, p95: 52.4s, gen elapsed: 398s
- VRAM peak: 3237 MB

### d3 — retrieval-gating, threshold=0.7 (aggressive)

- gating threshold: **0.70**
- overall cloud-judge avg: 1.84, local-judge avg: 1.85
- in-scope (q03+q10) C-avg: **1.71**, OOS C-avg: 1.92
- detector refusal: **6/12**, judge refusal: 7/12, skipped LLM: 8/20
- per-question C-avg: q03=2.75, q10=0.33, q11_oos=1.75, q13_oos=2.00, q12b_oos=2.00
- per-question refusal (detector | judge | skipped):
    - q11_oos: detector=2/4, judge=2/4, skipped=2/4
    - q13_oos: detector=2/4, judge=3/4, skipped=2/4
    - q12b_oos: detector=2/4, judge=2/4, skipped=2/4
- latency p50: **10.0s**, p95: 56.9s, gen elapsed: 425s
- VRAM peak: 3237 MB

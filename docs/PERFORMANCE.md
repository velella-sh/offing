---
title: Performance
description: Recorded scan-time and memory results for Offing — method, hardware, repositories, and the commands that reproduce them.
---

# Performance

This page publishes Offing's recorded performance results. Every number below comes from a documented run in this repository; none is estimated. Budgets, gates, and benchmark harness detail live in [Benchmarks](BENCHMARKS.md). Accuracy and corpus growth live in [Validation](VALIDATION.md).

Scan time means local Offing analysis only. Network and Git checkout time are reported separately when a harness measures them, and are never mixed into the scan figures below.

## Hardware

Unless a row names something else, the reference runs used the development machine:

| Field | Value |
| --- | --- |
| OS | macOS (Apple silicon) |
| Node.js | 22 (22.23 for the monorepo reference; 26 for the first-run reference) |
| Network during measurement | none — scans and synthetic fixtures stay offline |

Treat every duration as a reference point, not a cross-machine guarantee. CI enforces the ceilings in [Benchmarks](BENCHMARKS.md); those ceilings carry roughly an order of magnitude of margin over the reference so runner noise does not trip them.

## Repositories and fixtures

| Suite | What is scanned | Where it is pinned |
| --- | --- | --- |
| v0.1 public corpus | 20 public repositories at immutable commits (ten Node.js, nine Python, one Node.js / GitHub Actions) | [`benchmarks/public-repositories/`](../benchmarks/public-repositories/); method in [Validation corpus](validation/corpus.md) |
| Smoke fixture | `tests/fixtures/smoke` (known deprecated npm package and Node.js runtime) | committed fixture; timed by `benchmarks/perf-budget.ts` |
| Synthetic monorepo | Temporary ~100k-file npm workspaces tree built offline | `benchmarks/monorepo.ts` (not a public repository) |
| Real monorepo (CI gate) | [`babel/babel`](https://github.com/babel/babel) at commit `992afd97a0535c1fa8a3d9eb33e8b5fde4ad2c55` | `.github/workflows/ci.yml` (`perf-budget` job); wall clock is gated, not published as a reference row here |
| Source-usage corpus | 200 generated TypeScript files, plus this repository's `src/**/*.ts` for the engine comparison | `benchmarks/source-usage.ts` |

Adding more large public monorepos to the suite is tracked separately ([#51](https://github.com/velella-sh/offing/issues/51)).

## Results

### Public corpus (v0.1, 20 repositories)

Recorded on the development machine as part of the v0.1 validation run published in [Validation corpus: Results](validation/corpus.md#results). Scan time excludes checkout.

| Measure | Result |
| --- | ---: |
| Repositories | 20 |
| Expected findings | 27 |
| Median scan time | 8.19 ms |
| p95 scan time | 48.88 ms |
| Slowest scan | 49.73 ms |

### Fixed smoke fixture (performance budget)

Reference run 2026-10-28 (macOS, Apple silicon, Node.js 22), published in [Benchmarks — Scan performance budget](BENCHMARKS.md#scan-performance-budget). One warm-up, then three measured in-process scans with caches off.

| Measurement | Budget | Reference |
| --- | ---: | ---: |
| Mean wall time | 2,000 ms | 4–11 ms |
| Peak resident set size | 768 MB | 87 MB |

### Synthetic ~100k-file monorepo

Reference run 2026-10-29 (macOS, Apple silicon, Node.js 22.23), published in [Benchmarks — Large-monorepo performance](BENCHMARKS.md#large-monorepo-performance). Caches disabled (`noCache: true`).

| Measurement | Budget | Reference |
| --- | ---: | ---: |
| Mean wall time (≥100,000 files) | 5,000 ms | 716 ms |
| Peak resident set size | observational (CI ceiling 1,536 MB) | 132 MB |
| Findings (synthetic fixture) | > 0 | 9 |

### Time to first useful finding

Reference run 2026-10-28 (macOS, Apple silicon, Node.js 26) against the local build on the smoke fixture, published in [Benchmarks — Time to first useful finding](BENCHMARKS.md#time-to-first-useful-finding).

| Measure | Result |
| --- | ---: |
| Clean scan wall time | 0.28 s |
| Findings reported | 4 |

### CLI start-up

Reference on the development machine after the fast `--version` path, published in [Benchmarks — CLI start-up budget](BENCHMARKS.md#cli-start-up-budget). Median of seven runs after one warm-up; CI ceiling 400 ms.

| Measure | Before fast path | Reference |
| --- | ---: | ---: |
| `offing --version` median wall time | ~940 ms | ~22 ms |

### Source-usage analysis

Reference runs published in [Benchmarks — Source usage analysis](BENCHMARKS.md#source-usage-analysis).

| Run | Date | Result |
| --- | --- | --- |
| Controlled 200-file corpus (400 expected usages) | 2026-10-14 | precision 1.0, recall 1.0, 29.64 ms |
| Regex vs tree-sitter on `src/**/*.ts` (120 files, 15 runs after warm-up) | 2026-10-21 | regex median 26.93 ms / p95 31.86 ms; tree-sitter median 131.70 ms / p95 151.55 ms (cold first run 240.60 ms) |

## Method

1. **Corpus scans** check out each pinned commit, run every built-in detector offline, compare findings to ground truth, and report per-repository scan time separately from checkout time ([Validation corpus](validation/corpus.md#method)).
2. **Budget benchmarks** copy or synthesize a fixture, disable scan caches, run a warm-up, then measure wall time and peak RSS in-process (`benchmarks/perf-budget.ts`, `benchmarks/monorepo.ts`). A scan that reports no findings fails the gate.
3. **Start-up** spawns the built CLI with `--version` only (`benchmarks/startup.ts`).
4. **First useful finding** times a clean scan of the smoke fixture (`benchmarks/first-run.ts`).
5. No suite executes repository code or uses the network during the timed scan itself.

## Reproduce

Requires Node.js 22 or newer. Corpus validation needs network once to fetch pinned repositories (or a warmed `OFFING_CORPUS_CACHE`); every other command below is offline after `npm ci`.

```bash
npm ci
npm run build --silent

# Smoke-fixture performance budget (CI gate).
npm run benchmark:perf-budget -- --check

# Synthetic ~100k-file monorepo (CI gate).
npm run benchmark:monorepo -- --check

# CLI start-up budget.
npm run benchmark:startup

# Time to first useful finding.
npm run benchmark:first-run

# Source-usage precision, recall, and engine comparison.
npm run benchmark:usage

# Public corpus (scan times appear in the harness summary; warm the cache first).
export OFFING_CORPUS_CACHE=~/.cache/offing-corpus
npm run corpus:warm   # once
npm run validate:public-repos -- --offline
```

## Artefacts

- Budget harnesses: [`benchmarks/perf-budget.ts`](../benchmarks/perf-budget.ts), [`benchmarks/monorepo.ts`](../benchmarks/monorepo.ts), [`benchmarks/startup.ts`](../benchmarks/startup.ts), [`benchmarks/first-run.ts`](../benchmarks/first-run.ts), [`benchmarks/source-usage.ts`](../benchmarks/source-usage.ts)
- Corpus harness and pins: [`benchmarks/public-repositories.ts`](../benchmarks/public-repositories.ts), [`benchmarks/public-repositories/`](../benchmarks/public-repositories/)
- Methodology and ceilings: [Benchmarks](BENCHMARKS.md)
- Accuracy record: [Validation](VALIDATION.md), [Validation corpus](validation/corpus.md)

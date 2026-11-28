# Agent staleness benchmark

Measures how often coding agents write end-of-life or deprecated choices when they produce common project files, with and without Offing's agent hook.

## Layout

| Path | Role |
| --- | --- |
| `tasks.json` | Prompt set (≥40 tasks). Prompts never name versions. |
| `run.ts` | Benchmark entry point for task listing, isolated replay and static rescoring. |
| `score.ts` | Offline scorer: restores scanner-neutral fixture names, then scores repository findings and removed source APIs offline. |
| `outputs/<agent>/<arm>/<task>/` | Produced files plus `meta.json`. |
| `results.json` | Last offline score (`npm run bench:staleness:score -- --write`). |

Arms:

- `plain` — empty temporary directory; no Offing setup.
- `hooks` — same task after `offing init --agents` and, when the host supports it, `init --hooks-for <host>`.

The `outputs/seed/` tree is **hand-written seed data** for offline tests. It is not a real agent run. Manifest-shaped files there use scanner-neutral names (`image.fixture`, `package.json.fixture`); the scorer restores real names in a temporary copy before scanning (decision 0027). Replace or extend the tree when the maintainer commits the first measured run (at least three agents, both arms).

Use the [recorded experiment harness](../agent-harness/README.md) to replay model-qualified attempts, compare compatible Ebb and Offing pins, or collect fixture evidence without a provider key.

## Commands

```bash
npm ci
npm run build --silent

# Offline score (also exercised by unit tests in npm run check):
npm run bench:staleness:score
npm run bench:staleness:score -- --write   # refresh results.json

# List tasks for a replay plan:
npm run bench:staleness:run -- --list
```

Use the [recorded replay instructions](../agent-harness/README.md) to run or score captured edits. Live `--agent` invocations are disabled until the vendor path can enforce task isolation.

Method, limits, and the published table live in [docs/BENCHMARKS.md](../../docs/BENCHMARKS.md#agent-staleness-benchmark).

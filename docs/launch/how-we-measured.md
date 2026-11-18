---
title: How we measured the Offing guardrail
description: How the hooks-on and hooks-off guardrail benchmark was run and how to reproduce it.
---

# How we measured the Offing guardrail

We ran 100 tasks on each of Codex and Cursor, with hooks off and on, for 400 scored live attempts. Each pair used the same model and prompt. The tasks cover packages, runtime images, GitHub Actions, and deprecated or removed APIs. With the hooks installed, Offing denied **153 of 160 requested risky edits (95.6%)** and **0 of 40 clean controls**.

The benchmark measures proposed and completed writes to one file at a time. We count a denial when the hook logs that it blocked the requested edit. We score explicit refusals, accepted replacements, and false blocks separately. The benchmark covers these two host and model combinations. Dependency installation, builds, and application behavior are outside its scope.

Run `./benchmarks/agent-guardrail/reproduce.sh` from the repository root for a five-task offline check. The [benchmark report](../BENCHMARKS.md#agent-guardrail-benchmark) links the live results and shows how to rerun the comparison and recalculate the headline.

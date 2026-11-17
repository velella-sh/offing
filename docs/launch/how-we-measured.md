---
title: How we measured the Offing guardrail
description: How the hooks-on and hooks-off guardrail benchmark was run and how to reproduce it.
---

# How we measured the Offing guardrail

We ran 100 tasks twice in Cursor, for 200 live attempts. Each pair used the same model and prompt. The tasks cover packages, runtime images, GitHub Actions, and deprecated or removed APIs. With the hooks installed, Offing denied **76 of 80 requested risky edits (95%)** and denied **0 of 20 clean controls**. The companion Codex run reached its account quota and is reported separately.

The benchmark measures proposed and completed writes to one file at a time. It tracks explicit refusals, accepted replacements, and false blocks separately. It leaves alternative implementations, dependency installation, and application behavior outside the headline.

Run `./benchmarks/agent-guardrail/reproduce.sh` from the repository root for a five-task offline check. The [benchmark report](../BENCHMARKS.md#agent-guardrail-benchmark) links the live results and shows how to rerun the comparison and recalculate the headline.

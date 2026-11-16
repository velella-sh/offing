---
title: How we measured the Offing guardrail
description: How the hooks-on and hooks-off guardrail benchmark was run and how to reproduce it.
---

# How we measured the Offing guardrail

We replayed 100 proposed edits per host with the Offing hooks off and on. The suite covers package declarations, runtime images, GitHub Actions, and deprecated or removed APIs. In the hooks-on replay, each host's hook blocked 78 of 80 risky edits (97.5%) and allowed all 20 clean controls.

These results describe scripted edit decisions on single-file fixtures. Measurements of live agent refusals and replacement choices are pending. The replay also leaves package installation, builds, and other editing tools outside its scope.

To reproduce the five-task smoke run, run `./benchmarks/agent-guardrail/reproduce.sh` from the repository root. See the [benchmark report](../BENCHMARKS.md#agent-guardrail-benchmark) for the full command, scoring method, and raw JSON.

---
title: Guarded Autopilot replay preparation
---

# 0079 Guarded Autopilot replay preparation

**Status:** Accepted

An explicit replay recording can be applied during `autopilot --prepare`.
It uses the existing isolated worktree and records the agent-turn phase
before stopping. A successful replay leaves reviewable edits and a
`replay-prepared` stop reason. It does not produce a successful
migration verdict.

The v1 recording accepts optional per-turn usage. Missing usage preserves
the existing free replay accounting. Check the remaining run and turn
budgets before writes. If the clock expires during an edit, restore that
turn’s original files and record the controlling cap. Hold the default scope
to selected migration-packet files and tracked test files, with protected
paths and credential text refused before edits.

The replay interpreter launches no agent, shell, or test process.

---
title: Offing fix evaluation
description: Deterministic patches and agent migration outcomes on pinned public repository commits.
layout: doc
---

# Fix evaluation

On :field[date], Offing measured :field[measured] of :field[selected] pinned repositories. The other :field[excluded] are listed with exclusion reasons in the run report. The runner used Offing commit :field[revision] and bundled Ebb :field[ebb].

:field[evidence]

[Evaluation method](/FIX_EVALS_METHOD/)

## Deterministic fixes

Build results include the pinned validator for static infrastructure profiles. Separate test counts only apply to profiles that ran tests. The table shows counts for every fixer. A percentage requires at least five applicable cases for that metric.

::bar-chart{from="fix-evals.charts" category="label" value="percent" title="Build or validation remained green (%)"}

::record-table{from="fix-evals-fixers" caption="Outcomes by registered fixer" columns='[{"field":"id","label":"Fixer"},{"field":"cases","label":"Cases","kind":"number"},{"field":"status","label":"Evidence"},{"field":"deterministic","label":"Deterministic"},{"field":"applied","label":"Applied"},{"field":"resolved","label":"Resolved"},{"field":"noNewFinding","label":"No new finding"},{"field":"idempotent","label":"Idempotent"},{"field":"buildKeptGreen","label":"Build or validation"},{"field":"testsKeptGreen","label":"Tests"}]'}

### Failed metrics

:field[failureLinks]

## Agent migrations

Each task used a bare prompt and a migration packet in separate worktrees. The earlier run used static checks. The later run also exercised upstream project builds and tests for a subset with a passing clean baseline.

::record-table{from="fix-evals-agent" caption="Agent outcomes by verification profile and prompt" columns='[{"field":"date","label":"Run date"},{"field":"agent","label":"Agent"},{"field":"profile","label":"Verification profile"},{"field":"arm","label":"Prompt"},{"field":"static","label":"Static criteria"},{"field":"project","label":"Project check"},{"field":"both","label":"Both criteria"}]'}

:field[agentLinks]

---
title: Autopilot fixture scoreboard
description: Replay results from synthetic repositories used to check the Autopilot evaluation report.
layout: doc
---

# Autopilot fixture scoreboard

This preview uses :field[total] recorded cases from synthetic repositories and an offline replay driver. The public-repository evaluation is tracked separately. [Evaluation status](https://github.com/velella-sh/offing/issues/948)

## Outcomes

::record-table{from="autopilot-evals-outcomes" caption="Recorded fixture outcomes" columns='[{"field":"label","label":"Outcome"},{"field":"count","label":"Cases","kind":"number"},{"field":"rate","label":"Rate"}]'}

::bar-chart{from="autopilot-evals-outcomes" category="label" value="count" title="Recorded fixture outcomes"}

## Recorded medians

- Replay turns — :field[turns]
- Elapsed time — :field[time]
- Provider cost during replay — :field[cost]

## Last failure evidence

:field[failureLinks]

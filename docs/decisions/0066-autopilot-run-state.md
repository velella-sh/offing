# 0066 Autopilot run state

Status: Accepted

## Context

Autopilot will link a migration plan, test runs, agent turns and verification.
An interrupted or partially available run needs an explicit phase and a reason
for stopping so it cannot be confused with a verified migration.

## Decision

Use `offing.autopilot-run.v1` for the current phase and every phase entered,
with the selected wave, optional upgrade target and local checkout identity.
Start with a scan and then plan. Baseline tests precede changes. Codemods
precede the first agent turn. Each turn leads to a test run. Verification
precedes success and can identify work for another turn. A stopped run records
the reason.

Dry runs print the candidate commands and prompt without launching them.
Preparation uses an isolated local branch from a clean committed Git tree and
stores the run record outside the checkout. The CLI stops at baseline tests
until an isolated execution backend is available.

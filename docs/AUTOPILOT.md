---
title: Autopilot
description: Preview an Offing migration wave and prepare an isolated Git worktree for review.
---

# Autopilot

`offing autopilot --dry-run` prints the first migration wave from `offing plan`,
the proposed setup, build and test commands, and the first agent prompt
preview. It scans the current files and starts no agent, test or Git process.

```sh
offing autopilot . --dry-run --to nodejs@22
offing autopilot . --dry-run --wave 1
offing autopilot . --dry-run --finding <finding-id>
```

Waves start at zero. Select one wave or one finding. `--to` accepts the same
runtime and version as `offing upgrade-check` and includes its verdict. The
preview shows configured `autopilot.tests` commands when present and otherwise
uses the static test plan. `--agent` changes the driver named in the preview.

`offing autopilot . --prepare` requires a clean Git working tree and a commit.
It creates a temporary worktree from `HEAD` on a local `offing/autopilot/<run>`
branch and prints the path to its [run record](SCHEMAS.md#autopilot-run).
The record ends at a stop before test execution. Review the branch and plan
locally while the isolated test backend is pending.

```sh
offing autopilot . --undo <run>
```

Undo can infer the run when the repository has one prepared worktree. If it has
several, pass the ID from the branch name. Undo refuses an advanced branch or
a worktree containing local changes. It removes the prepared worktree, branch
and run record.

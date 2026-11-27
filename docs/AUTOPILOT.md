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
preview uses the same [test plan](https://velella.sh/offing/TEST_RUNNERS/) as `offing doctor --tests`.
A nonempty `autopilot.tests` list replaces detected commands. `--agent` changes the driver named in the preview.

`offing autopilot . --prepare` requires a clean Git working tree and a commit.
It creates a temporary worktree from `HEAD` on a local `offing/autopilot/<run>`
branch and prints the path to its [run record](SCHEMAS.md#autopilot-run).
The record ends at a stop before test execution. Review the branch and plan
locally while the isolated test backend is pending.

`offing autopilot . --prepare --replay /path/to/turns.json` applies a
trusted recording as data in the prepared checkout. The replay launches
no agent or repository commands. The default edit scope is the selected
migration packets’ files and tracked test files. GitHub workflows, dotenv
files, private keys, and lockfiles remain protected even with an explicit
allowlist. Replay refuses recorded secret text and records the stopping
guard in the run record.

A recording uses `offing.agent-replay.v1` with a `turns` array of
path-to-text objects. An optional `turnUsage` array supplies one object
with integer `turns`, `tokens` and `costCents` per recorded turn for
reproducing budget decisions. Older recordings count as one turn with
zero tokens and cost per edit object. An over-budget turn leaves the
previously accepted edits intact. A prepared replay still needs separate
test execution and verification.

```sh
offing autopilot . --undo <run>
```

Undo can infer the run when the repository has one prepared worktree. If it has
several, pass the ID from the branch name. Undo refuses an advanced branch or
a worktree containing local changes. It removes the prepared worktree, branch
and run record.

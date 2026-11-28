---
title: Let Autopilot do the upgrade
description: Follow a recorded migration through a preview, an isolated worktree, and a verified result.
layout: guide
---

# Let Autopilot do the upgrade

Autopilot groups lifecycle findings into migration waves. This example replays reviewed edits for one wave in
a private Git worktree. The recording removes a deprecated npm dependency from a disposable fixture and
runs the same approved test on the original and updated versions.

The example uses a packed Offing source candidate with replay support. Check the
[published CLI releases](https://github.com/velella-sh/offing/releases/latest) for availability.

## Preview and replay a wave

Use a clean Git checkout with a committed `autopilot.tests` command, Docker, and the pinned test image.
The [terminal tape](https://github.com/velella-sh/offing/blob/main/demos/autopilot.tape) uses the
`offing_demo_autopilot` helper in `demos/colorize.sh` to create the disposable project and its
`../turns.json` recording.

```sh
offing autopilot . --dry-run --wave 0
```

The preview shows the candidate commands and migration prompt. In the recorded run, the replay checks the baseline,
applies eligible codemods and recorded edits, and reruns the approved tests in a network-disabled container.

:::cli-demo
$ offing autopilot . --agent replay --run-replay ../turns.json --wave 0
Wave findings: 0 remaining, 0 introduced.
:::

The replay uses no model key. A successful run reports `Replay verified` and names the worktree, branch
and evidence record. The [hosted replay fixture](https://github.com/velella-sh/offing/actions/runs/46099001311)
covers both passing and stopped waves and uploads their proof and test logs.

## Read the outcome

Review `final-verify-result.json` for the selected findings and test commands. The numbered test and agent
records sit beside the checkout. For the verified wave, the approved tests pass, the selected findings
clear, and the scan finds no newly introduced lifecycle findings.

The committed [guardrails](../AUTOPILOT_SAFETY.md) bound wall time, turns, tokens and cost and protect
files such as workflows, lockfiles, dotenv files and private keys. An unapproved red baseline, exhausted
budget, refused edit or repeated diff with the same test failures stops the run. Review the recorded
reason and commit range before continuing or removing the worktree.

See the [CLI walkthrough](../AUTOPILOT.md) for evidence files and local cleanup. For the optional CI
path, use the [Autopilot Action guide](../AUTOPILOT_ACTION.md).

---
title: Migrate with a local agent
description: Give an installed agent a migration packet and review its work on a local branch.
---

# Migrate with a local agent

When a finding has no deterministic fix, use `offing migrate` with a command for an agent you have already installed and configured. Offing starts from a clean Git checkout, prepares a separate worktree and gives the command the absolute prompt path in `OFFING_MIGRATION_PROMPT_FILE`. The command runs in the worktree. It uses your local setup and its normal permissions.

Get the finding ID from `offing scan . --json`, then pass it to the command.

```sh
offing migrate '<finding-id>' . --agent 'my-agent "$OFFING_MIGRATION_PROMPT_FILE"'
```

Use `--from-refusals` to select findings that `offing fix` declines or has no deterministic patch for. Each finding gets an independent worktree from the same clean commit.

```sh
offing migrate --from-refusals . --agent 'my-agent "$OFFING_MIGRATION_PROMPT_FILE"'
```

The agent should leave edits uncommitted. Offing refuses paths outside the packet and its companion lockfiles, rescans the change, and commits it on a local `offing/migrate/<finding>` branch. Offing leaves your checkout in place. Review the branch and the printed verification result path before integrating the changes. The `Offing-Verify-Result` commit trailer contains the same JSON. Suggested verification commands have status `not-run` until you run them separately. A timeout or an agent error leaves no migration branch. The default timeout is 30 minutes and `--timeout-ms` sets a different limit.

## Replay a reviewed patch

The deterministic sample driver lives at `dist/src/migrate/replay.js` in the Offing package. Point it at an absolute path to a patch you reviewed. For an npm install in the current project, resolve the package location and make the patch path absolute before starting.

```sh
replay="$(npm root)/@velella/offing/dist/src/migrate/replay.js"
patch="$(pwd)/reviewed.patch"
offing migrate '<finding-id>' --agent "node \"$replay\" \"$patch\""
```

The example applies the patch without network access. The worktree isolation keeps Offing's writes out of your checkout. Choose an agent command you trust with your account and filesystem.

See the [migration packet format](https://velella.sh/offing/MIGRATION_PACKETS/) for the scope, evidence and verification suggestions passed to the agent.

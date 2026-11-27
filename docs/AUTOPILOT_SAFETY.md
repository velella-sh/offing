---
title: Autopilot safety
description: Review what an Autopilot run can access and how a run stops.
---

# Autopilot safety

Start with `offing autopilot ./project --dry-run` to review the migration plan and candidate tests. It reads local metadata and starts no agent or test process. It redacts known secret patterns and the values of environment variables named in `autopilot.secretEnv`. Review the committed project and the commands before requesting an execution mode.

| Command | Execution boundary |
| --- | --- |
| `offing autopilot ./project --dry-run` | Local, read-only planning. |
| `offing autopilot ./project --prepare` | Creates a separate clean Git checkout and writes a local run record. |
| `offing autopilot ./project --prepare --replay turns.json` | Runs the bundled recorded replay worker in the pinned Node Docker image. Offing checks the worker's file digests before applying approved edits to the separate checkout. |
| `offing autopilot ./project --test-only` | Runs approved commands for the committed snapshot in a pinned Docker profile. `--container` explicitly selects the same runtime. |
| `offing autopilot ./project --undo RUN_ID` | Removes a clean, unadvanced prepared worktree and its run record. |

Replay and test-only execution require Docker. An unavailable runtime stops the operation. Docker receives a bounded input stream into an unprivileged, network-isolated container. Its writable files are temporary and it receives no host mounts or credentials. The replay worker receives only approved recorded edits and their limits. The test worker receives the committed snapshot it needs to run the approved commands. Image retrieval happens before container execution.

## Scope, secrets, and cost

The default write scope includes paths named by the migration packets and tracked test files. The scope excludes workflow files, `.env*`, key files, and direct lockfile writes. Offing checks recorded edits for both secret-shaped strings and the marked environment values before it stages them for the replay worker. Proof publication applies the same redaction before generating Markdown and writing evidence files.

Replay uses recorded usage to exercise per-turn and run limits for wall time, turns, tokens, and cost. It makes no model request and incurs no model charge. Test-only uses the configured wall-time budget and the sandbox's resource bounds. The public [Autopilot guide](AUTOPILOT.md) describes the modes and the [test runner guide](TEST_RUNNERS.md) covers offline tool dependencies.

## Stop and undo

The run record gives the last phase and reason when a guard stops a replay. Stop a foreground command with `Ctrl+C`. Review the path printed for the prepared checkout. Preserve any local edits you want before removing that checkout. Undo refuses a checkout with changes or an advanced branch, so restore the recorded checkout to a clean state first, then run `offing autopilot ./project --undo RUN_ID`.

The `acc-guardrails` package smoke uses an owned disposable repository to exercise denied paths, marked and pattern-shaped secret values, budget refusals, pinned replay and tests, and clean versus dirty undo. It needs Docker and no model key.

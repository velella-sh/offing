# 0078 Explicit pinned container tests

Status: Accepted

## Context

Doctor and Autopilot preview identify candidate test commands. An operator needs a separate action to test a reviewed checkout without giving repository commands access to the host.

## Decision

`offing autopilot <path> --test-only` uses a pinned Docker runtime by default. `--container` and `autopilot.testRuntime: "container"` explicitly select the same runtime. Reading config alone cannot start a test. Test-only takes a clean committed snapshot, reads that snapshot's config, and reuses the Fix Evals sandbox. Configured argv replaces detected test commands. The pinned runtime receives the snapshot through a bounded stream and no host mounts, credentials, or network access. Tool-image retrieval happens before sandbox execution.

`--prepare --replay` uses the pinned Node sandbox for the bundled recorded replay worker. Host preflight verifies scope, secret values, and the first turn's budget before staging edits. Offing checks the file digests returned by the worker before materializing the approved edits in the private checkout. Both execution modes stop when the runtime is unavailable. Host execution requires a separate owner decision.

Evaluate the same command from a fresh snapshot on retry. The sandbox sets `OFFING_TEST_ATTEMPT` to `1` or `2`. An earlier failing case is classified as flaky only when a report shows that the same case passed on retry. Tests without sufficient report evidence keep their exit-status result.

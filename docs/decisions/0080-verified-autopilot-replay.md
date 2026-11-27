---
title: Verify recorded Autopilot migrations locally
---

# 0080 Verify recorded Autopilot migrations locally

**Status:** Accepted

Add `autopilot --run-replay <recording>` with optional repeated
`--allow-red-baseline <exact-test-name>`. The command runs the approved test
plan in the existing pinned, isolated container backend before edits. Red
baselines are eligible only when their structured failures can all be matched
to the supplied exact names.

Reuse the prepared local Git checkout, replay edit guards, scan verification
and run-state schema. Commit eligible codemods separately, give each nonempty
accepted replay turn its own numbered commit, and persist the most recent test
feedback and remaining migration context with the run. Stop when the same
net diff and failure set recur. Successful runs require passing tests and a
fresh scan that clears the selected findings without introducing others.

Recorded edits are deterministic local input. The existing test runner is the
only executor for approved project test commands.

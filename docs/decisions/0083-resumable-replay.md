---
title: Resume a recorded Autopilot migration
---

# 0083 Resume a recorded Autopilot migration

**Status:** Accepted

Add optional replay progress and checkpoint fields to
`offing.autopilot-run.v1`. Older run records remain valid, and can be
reviewed or verified without a checkpoint. The transition list retains
a stop between recording segments and resumes at the tests phase.

Resume requires an exhausted recording, a clean worktree bound to its
recorded branch and HEAD, and the original test policy and lifecycle data.
Use a new recording containing only the remaining turns. Keep the
original baseline, count and budget, preserve existing evidence and
recheck approved tests in pinned Docker before applying more edits.

A completed replay writes wave-scoped verification evidence with the
original and final commit identities. Tests must pass, all selected
findings must clear, and the fresh scan must introduce no findings.

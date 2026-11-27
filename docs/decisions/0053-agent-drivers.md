---
title: Version the local Agent Driver contract
status: accepted
---

# Version the local Agent Driver contract

Publish `offing.agent-run.v1` with explicit process status, paths, turns and
nullable reported metrics. Offing passes the prompt, worktree, allowlist,
deadline and result file to a local driver. The standalone suite exercises
an edit, an outside-path sentinel and process cancellation.

Preserve the existing `migrate --agent` command and prompt environment
alias. Register vendor drivers behind explicit selection and version
checks. Vendor commands use fixed arguments and, where available, their own
permission controls. Scope validation still gates Offing's local commit.
Replay consumes reviewed JSON file edits in deterministic order.

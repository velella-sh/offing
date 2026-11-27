---
title: Local agent migration and benchmark result evidence
status: accepted
---

# Local agent migration and benchmark result evidence

The CLI advertises `migration.execute` as experimental. `offing migrate` takes an explicit local command, supplies an `offing.context.v1` prompt through a file and starts the command in a detached worktree. The command uses its own credentials and permissions. Offing accepts only packet paths and their companion lockfiles for the commit. Existing worktree changes and local branches are preserved. No migration is pushed.

The local commit trailer `Offing-Verify-Result` contains `offing.verify-result.v1` JSON, also written to a standalone file. Its before identity records the original commit. Its after identity leaves the commit null because the post-edit scan preceded the commit that embeds the result. Commands retain `not-run` status because Offing only rescans the worktree.

Benchmark `offing.agent-migrations.v1` run records add the agent name and optional version, plus per-condition `findingResolved` and `noNewFinding` booleans. The existing verification, changed files and duration measurements continue to represent the recorded command results, paths and elapsed wall time. Live result summaries omit raw prompts, agent output and absolute workstation paths.

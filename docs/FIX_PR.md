---
title: Scheduled lifecycle fix pull requests
---

# Scheduled lifecycle fix pull requests

Copy [the workflow template](https://github.com/velella-sh/offing/blob/main/templates/workflows/offing-fix-pr.yml) into `.github/workflows/`. The template targets `v1` once that Action ref is published. The feature needs an Action release that includes the [fix PR inputs and outputs](https://velella.sh/offing/spec/action/v1/). Run it from the default branch each Monday or manually through **Run workflow**.

The job needs `contents: write` for the fix branch and `pull-requests: write` for its pull request. The repository must allow GitHub Actions to create pull requests. The template checks out full history so Offing can inspect every branch-only commit. With a shallow checkout, Offing fetches the missing history before inspecting an existing fix branch.

- `fix-pr: "true"` opens or refreshes one pull request from `offing/fixes`. A run without applicable patches closes the bot's open PR.
- `fix-pr-labels` accepts a comma-separated list of existing labels. Successful creation and update add them alongside existing labels.
- `fix-pr-url` and `fix-pr-number` identify the pull request opened, refreshed or closed by the current run.

The pull request begins with its evidence table, then lists patches by fixer, refusals with context commands, and the receipt and `offing.verify-result.v1` document. The workflow run links the full verify JSON, patch and fix plan with refusals as one artifact. GitHub retains it for 14 days. Review the changes and run the suggested checks before merging.

A later run updates the bot branch only when all its extra commits match the bot's recorded author, committer and fix subject. An explicit Git lease rejects a branch changed after inspection. A human commit causes a notice on the open PR. Fork runs and rejected writes are explained in the job summary.

[Offing's dry-run workflow](https://github.com/velella-sh/offing/blob/main/.github/workflows/offing-fix-pr.yml) runs a read-only fix plan on Offing's tracked files and reports the result in the job summary. It excludes the intentionally outdated test fixtures, examples and benchmark outputs. In the same run, the candidate Action opens and updates one fixture PR through a local Git remote and stubbed GitHub responses. Download `acc-fix-pr-evidence-<attempt>` from the run's **Artifacts** section to inspect the fixture's verification result, patch, fix plan and summary.

---
title: Run Autopilot in GitHub Actions
description: Configure a guarded migration workflow and review the proof behind its wave pull requests.
---

# Run Autopilot in GitHub Actions

Copy [`templates/workflows/offing-autopilot.yml`](https://github.com/velella-sh/offing/blob/main/templates/workflows/offing-autopilot.yml)
into your repository's `.github/workflows/` directory. Review the proposed test commands with `offing doctor --tests`
and commit the approved argument arrays in `.offing.json`.

When the installed Offing package includes this template, you can copy the
matching file from `node_modules/@velella/offing/templates/workflows/`.
Dispatch requires the GitHub Action tag `velella-sh/offing@v1` to be available.

```json
{"autopilot":{"tests":[["npm","test"]]}}
```

Use a project whose approved tests can run in the pinned offline Docker environment.
[Review runner detection and offline dependencies](TEST_RUNNERS.md).

The template gives only the migration job `contents: write` and `pull-requests: write`. The repository must also
allow GitHub Actions to open pull requests. Use the job's GitHub Actions token so future runs can recognize its
pull requests. Install the pinned Claude CLI shown in the template. Set the GitHub
secret named in `agent-key-secret` and map that one secret into the Action step as
`OFFING_ACTION_AUTOPILOT_KEY`. Dispatch the workflow on the default branch. Enable the commented weekly schedule
after the repository owner approves it and the provider spend limit.

To exercise the path with zero provider cost, use `agent: replay` and point `autopilot-recording` at a committed
`offing.agent-replay.v1` JSON recording. Replay uses the pinned container and requires no provider key.
Both drivers use the same [Autopilot guardrails](AUTOPILOT_SAFETY.md).

## Review a wave

Each wave publishes to `offing/autopilot/<wave>`. When the bot still owns that branch and pull request, the next
run updates the same open pull request. A human commit stops branch updates. Once a wave verifies with no edits,
Offing closes its stale bot pull request. A stopped run with edits and verification evidence can open a draft
when `autopilot-open-red` is enabled.

Read the result, test claims and budget in the pull request and Job Summary. The body includes the migration proof
or its SHA-256 and a link to the workflow artifacts. Download the proof and logs from the run, check out the
recorded head, then run the proof verifier.

```bash
offing proof verify ./offing-proof.json --repo ./project
```

The [Action v1 contract](spec/action/v1.md#autopilot) lists the input defaults, outputs and exit behavior.

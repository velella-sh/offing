---
title: Offing Action v1 conformance
---

# Offing Action v1 conformance

The [v1 contract](../v1.md) is exercised on a clean tree and a tree with a dated
GitHub Actions runtime finding. The fixtures verify a passing scan with defaults,
the failure gate and its outputs, and local SARIF without code scanning
permissions. The workflow validates the [lifecycle SARIF profile](../../sarif/v1.md)
and compares the SARIF result IDs with the JSON report. For Action revisions with
agent review inputs, `acc-ai-pr-review` runs the tested bundle against a local GitHub
API fixture. It checks disabled, informational and request-changes review modes,
recorded agent attribution, and the fork workflow’s separate read and write stages.

## Run from a consumer repository

Add the following job to a workflow and select a tag or commit that implements
the v1 contract. Use a release tag to test the packaged Action or set
`build: true` to test a source revision. On GitHub.com, the checker defaults
to the reusable workflow's own commit. Pin the workflow ref to a reviewed SHA
to pin both, or set `contract_ref` to select a different checker explicitly.
On GitHub Enterprise Server, set `contract_ref` to pin the checker independently.

```yaml
name: Offing Action conformance
on: workflow_dispatch
permissions:
  contents: read
jobs:
  conformance:
    uses: velella-sh/offing/.github/workflows/action-conformance.yml@main
    with:
      action_repository: velella-sh/offing
      action_ref: "<published v1-compatible ref>"
```

Use an isolated workflow without secrets or write permissions when checking a
third-party candidate. The `acc-action-v1` job summary records the repository,
selected ref, resolved Action and checker commits, and package version. Link the passing release
run from the release acceptance record.

## Exercise the reusable workflow from Offing source

The Package Smoke workflow can invoke the same reusable workflow on an Offing branch.
It builds the Action from that branch and runs the clean, severity-gate and local SARIF
checks in the caller's workflow. Select the candidate branch in place of `BRANCH`.

```sh
gh workflow run package-smoke.yml --ref BRANCH -f action_conformance_only=true
```

## Run against an Offing release tag

From the Offing repository, dispatch the workflow with the exact published
Action tag you want to test. The workflow reads the packaged Action from the
selected tag and records its commit and package version in the run summary.
Replace `RELEASE_TAG` with the tag to test.

```sh
gh workflow run action-conformance.yml -f action_ref="refs/tags/RELEASE_TAG"
```

## Run the verifier directly

Download [run.mjs](run.mjs). It needs Node.js and reads the JSON object of Action
outputs from standard input. Run it on the same runner so the absolute paths in
the outputs still point to their reports.

```sh
node run.mjs clean success < clean-outputs.json
node run.mjs gate failure < gate-outputs.json
```

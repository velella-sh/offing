---
title: GitHub code scanning
description: Upload Offing lifecycle findings as SARIF and inspect the resulting alerts on GitHub.
---

# GitHub code scanning

Offing can send lifecycle findings to a GitHub repository's **Security → Code scanning** page. The Action uploads SARIF under the `offing` category. Each alert identifies the rule, the affected file and line, and the available evidence and migration guidance.

## Enable uploads

Enable code scanning for the repository. In a workflow that runs on pushes to the default branch, give the job `security-events: write` and set `upload-sarif: true` on the Offing Action. The following are job-level settings and steps.

```yaml
permissions:
  contents: read
  security-events: write

steps:
  - uses: actions/checkout@v7
  - uses: velella-sh/offing@v0.1.1
    with:
      upload-sarif: true
```

A fork pull request's default token is read-only. For a workflow that also runs on pull requests, use `upload-sarif: ${{ github.event_name == 'push' }}` to upload only on pushes. See the [Action reference](https://velella.sh/offing/GITHUB_ACTION/#code-scanning) for setup and the SARIF field mapping.

## Read an alert

Filter code scanning alerts by the **Offing** tool. Open a result to see the finding and its location. GitHub displays surrounding code from the repository. The SARIF file contains the location and Offing's finding text.

The screenshot shows a real Offing alert for a PowerShell container reference in the repository's own example workflow. GitHub now marks the alert **Fixed**. [Offing code scanning alert #1](https://github.com/velella-sh/offing/security/code-scanning/1)

![Offing alert 1 in GitHub Code scanning, marked Fixed, with the PowerShell container reference highlighted on line 14.](https://velella.sh/offing/assets/code-scanning/offing-alert-1.webp)

## Check a SARIF report

With an Offing build that supports the [lifecycle SARIF v1 profile](https://velella.sh/offing/spec/sarif/v1/), generate a report locally. Download the [standalone checker](https://velella.sh/offing/spec/sarif/conformance/check.mjs) as `check.mjs` and run it with Node.js 22 or newer.

```sh
offing scan . --format sarif > offing.sarif
node check.mjs offing.sarif
```

A conforming report produces `acc-sarif-profile: profile v1 passed`. GitHub also accepted the SARIF upload from [Offing's CI on main](https://github.com/velella-sh/offing/actions/runs/45906811334) without warnings.

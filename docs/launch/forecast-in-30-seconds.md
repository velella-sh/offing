---
title: Forecast your stack in 30 seconds
description: Find the deadlines in a repository and check them on pull requests.
---

# Forecast your stack in 30 seconds

With [Node.js 22 or newer](https://velella.sh/offing/INSTALL/), run this from your repository root.
The first invocation may download Offing from npm.

```bash
npx --yes @velella/offing forecast .
```

An **affecting this repository** event names the deadline and the file that
uses the affected version. **Elsewhere** counts dated events in the same
window that Offing did not match to this repository.

![A 12-month Offing forecast flags the September 23 checkout runtime deadline and points to the workflow line](https://velella.sh/offing/launch/img/forecast-release-0.1.1.webp)

This frame shows the [0.1.1 forecast recording](https://velella.sh/offing/demos/forecast.mp4) for its demo checkout.
The example below uses a separate checkout and a shorter window.

In the [GitHub Actions example](https://github.com/velella-sh/offing/tree/main/examples/forecast/actions-before),
running `offing forecast . --as-of 2026-08-01 --months 3` inside the
example directory prints these lines with bundled data.

```text
  2026-09-23  Unsupported actions/checkout runtime [high] (github-actions.checkout.node20)
    .github/workflows/build.yml:7
```

For a scan on every pull request, save this workflow as
`.github/workflows/offing.yml`. The severity threshold applies to scan
findings.

```yaml
name: Offing lifecycle scan
on: pull_request
permissions:
  contents: read
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: velella-sh/offing@v0.1.1
        with:
          fail-on-severity: high
```

See the [forecast reference](https://velella.sh/offing/forecast/) for timelines and calendar exports
and the [Action reference](https://velella.sh/offing/GITHUB_ACTION/) for reports and permissions.

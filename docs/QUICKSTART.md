---
title: "Quickstart"
description: "Five copy-paste steps, from the first scan to a baseline in CI. You need Node.js 22 or newer and a repository to scan. Every command runs locally; nothing is uploaded."
---

# Quickstart

Five copy-paste steps, from the first scan to a baseline in CI. You need Node.js 22 or newer and a repository to scan. Every command runs locally; nothing is uploaded.

> [!NOTE]
> Scans run locally and upload nothing. `npx` may download Offing and its dependencies before the scan starts.

## 1. Run Offing without configuration

From the directory you want to scan:

```bash
npx --yes @velella/offing
```

No subcommand is needed. Offing scans the current directory and prints the top findings and upcoming lifecycle deadlines. After installation, it reads repository files such as manifests, lockfiles, workflows, and source files, plus local Ebb lifecycle data. The first run never prompts, writes files, or uses the network. If Git history is unavailable, it still scans the files on disk. For the full report with finding IDs, replacements, and evidence, run `npx --yes @velella/offing scan .`. Use `npx --yes @velella/offing --json` for the structured forecast without the next-step hints.

The bare invocation starts working with the release that includes this change. To try it before then, use a checkout of Offing as shown below.

### Try the demo

From a checkout of [Offing](https://github.com/velella-sh/offing), run:

```bash
npm ci
npm run example --silent -- demo --as-of 2026-10-25
```

The example runner copies the demo into a temporary directory and runs Offing there without a subcommand. The fixed date makes the output reproducible:

```text
Weather: clear
Forecast: 2026-10-25 to 2027-10-25
Lifecycle findings: 5; upcoming deadlines: 0; no data: 0.
  HIGH Unsupported actions/checkout runtime (.github/workflows/ci.yml:9)
  MEDIUM Node.js 18 is end-of-life (package.json:5)
  MEDIUM Node.js 19 is end-of-life (package.json:5)
Git history is not available; Offing scanned the files on disk.

Next: offing forecast
Next: offing init --hooks
Next: offing init --agents (add agent guard instructions)
```

### First download size

On macOS arm64 with Node.js 22.23.1 and npm 10.9.8, a clean-cache `npx` install of the published `@velella/offing@0.1.1` downloaded **5,208,351 compressed bytes** (about 5.21 MB) across 12 package tarballs, including dependencies. This excludes registry metadata and protocol overhead; the exact size can vary by platform and dependency versions. To remeasure from the Offing checkout, run `npm run benchmark:first-run -- --npx-size`.

### Time to the first forecast

A locally packed candidate on macOS arm64 reached its first forecast at these times, with a fresh npm cache for each repository. The candidate tarball was already on disk. These timings include dependency downloads, installation, and the first forecast. The weekly run uses an exact published npm version and also measures transfer of the Offing tarball itself.

| Pinned repository | Node.js 22.23.1 | Node.js 24.22.3 |
| --- | ---: | ---: |
| koa | 5.477 s | 4.324 s |
| sampleproject | 4.144 s | 4.479 s |
| bubbletea | 4.286 s | 4.207 s |

The release run measures the candidate tarball before publication and records each runner's results even when a check fails. It requires the first forecast in under 10 seconds on Linux, macOS, and Windows with Node.js 22 and 24. Offing requires Node.js 22 or later. Downloads and installation overlap, so the reports show the tarball download span, npm's full install phase, and the time after install separately. [First minute workflow](https://github.com/velella-sh/offing/actions/workflows/first-minute.yml)

## 2. Check one dependency before adding it

```bash
npx @velella/offing check pkg:npm/request@2.88.2
```

The command prints the lifecycle problem, the replacement, and the evidence. It exits `1` when a rule at or above `--fail-on` (default `high`) applies and `0` otherwise. `no-data` means Offing has no rule for the package, not that it is safe.

## 3. Read the evidence for one finding

Take a finding ID from the full `scan .` report in step 1 and inspect it:

```bash
npx @velella/offing explain '<finding-id>' .
```

For structured context an agent can follow, including affected files, usages, constraints, and verification commands:

```bash
npx @velella/offing context '<finding-id>' . --json
```

Offing suggests verification commands; it never runs migration commands for you.

## 4. Add the check to CI

Create `.github/workflows/offing.yml`:

```yaml
name: Offing

on:
  pull_request:

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

The action annotates the pull request, can upload SARIF to code scanning, and fails the job on a finding at or above the chosen severity. See the [GitHub Action guide](GITHUB_ACTION.md) for inputs, permissions, and artifacts.

## 5. Add a baseline

Accept the findings you already know about, then report only new regressions:

```bash
npx @velella/offing baseline .
npx @velella/offing scan . --baseline .offing-baseline.json
```

Commit `.offing-baseline.json`. The action reads the same file with `baseline: .offing-baseline.json`.

## Next

- [Install Offing on every channel](INSTALL.md)
- [Use it with an agent](AGENT_SKILLS.md) through the Agent Skill or the [local MCP server](MCP.md)
- [Lifecycle rules](RULES.md) and the [evidence policy](../CONTRIBUTING.md#evidence-policy)
- [Contribute](../CONTRIBUTING.md)

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

If the first Autopilot wave has confirmed offline codemods, the forecast ends with their count. Run `npx --yes @velella/offing autopilot . --dry-run --wave 0` to see which findings have a deterministic edit available. The preview uses the current files without applying patches or running tests. If the wave has no offline fixes, the forecast says there is nothing for Autopilot to fix and omits the preview command.

The bare invocation requires Offing 0.1.2 or later. Use a checkout of Offing to try it before release.

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

A hosted release dry run measured a local candidate tarball on three pinned public repositories. Each run used a fresh npm cache and measured dependency downloads, installation, and the first forecast. The weekly run uses an exact published npm version and also measures transfer of the Offing tarball itself.

| Hosted runner | Node.js 22.23.5 | Node.js 24.22.3 |
| --- | ---: | ---: |
| Linux x64 | 2.875–3.310 s | 3.961–4.513 s |
| macOS arm64 | 4.761–5.152 s | 3.003–4.766 s |
| Windows x64 | 10.987–12.888 s | 7.067–8.798 s |

The dry run and weekly benchmark require each first forecast in under 10 seconds and retain timings when a runner misses. In this candidate run, Windows with Node.js 22 exceeded the budget. Downloads and installation overlap, so the reports show the tarball download span, npm's full install phase, and the time after install separately. [Candidate timing evidence](https://github.com/velella-sh/offing/actions/runs/45940201878) · [Weekly First minute runs](https://github.com/velella-sh/offing/actions/workflows/first-minute.yml)

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

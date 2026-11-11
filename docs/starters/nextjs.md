---
title: Starter kit — Next.js
---

# Starter kit: Next.js

A copy-paste setup that checks the Node.js runtime, the Next.js version, and GitHub Actions in a Next.js repository. Scans stay offline: the Action and CLI read the repository and bundled lifecycle data only.

**Example:** [velella-sh/offing-starter-nextjs](https://github.com/velella-sh/offing-starter-nextjs) runs this kit in CI.

## What it checks

| Surface | Typical evidence | Why it matters for Next.js |
| --- | --- | --- |
| Node.js runtime | `package.json` `engines`, `.nvmrc`, `.node-version`, CI `setup-node` | Next.js majors require a supported Node line; an end-of-life runtime fails the gate. |
| Next.js package | `dependencies` / `devDependencies` on `next` | Unsupported majors (for example Next.js 15 after its support window) are high severity. |
| GitHub Actions | `.github/workflows/*.yml` `uses:` pins | Deprecated or retired Actions in the app’s own CI show up next to app dependencies. |

Use a supported Next.js major (Active LTS) and Node.js 22 or later before you turn the gate on. Check a candidate with:

```bash
npx @velella/offing check pkg:npm/next@16.0.0
npx @velella/offing check pkg:generic/nodejs@22.0.0
```

## 1. Pull-request workflow

Copy [`examples/starters/nextjs/.github/workflows/offing.yml`](https://github.com/velella-sh/offing/blob/main/examples/starters/nextjs/.github/workflows/offing.yml) to `.github/workflows/offing.yml`:

```yaml
name: Offing

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  lifecycle:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: velella-sh/offing@v0.7.1
        with:
          baseline: .offing-baseline.json
          fail-on-severity: high
```

`contents: read` is enough. The scan makes no network requests. Pin a release tag (here `v0.7.1`) so every pull request runs the same rules; see [GITHUB_ACTION.md](../GITHUB_ACTION.md) for inputs, SARIF upload, and SHA pins.

## 2. Baseline

Copy [`examples/starters/nextjs/.offing-baseline.json`](https://github.com/velella-sh/offing/blob/main/examples/starters/nextjs/.offing-baseline.json) to the repository root, or generate one from a first scan of findings you have accepted:

```bash
npx @velella/offing baseline . --output .offing-baseline.json
```

An empty baseline (as in the kit) fails CI on any high or critical finding. Add an `owner`, `reason`, and `expires` on every accepted entry; see [GITHUB_ACTION.md](../GITHUB_ACTION.md#pull-request-workflow).

## 3. Agent snippet

So coding agents check before they add a package, Action, or runtime, copy the Cursor files from [`examples/starters/nextjs/.cursor/`](https://github.com/velella-sh/offing/tree/main/examples/starters/nextjs/.cursor):

1. `.cursor/mcp.json` — local MCP server for `@velella/offing@0.1.0`
2. `.cursor/rules/offing.mdc` — always-on rule that calls `check_dependency` first

Restart Cursor and enable the `offing` server under Settings → MCP. Other hosts use the same instruction text under [`examples/agents/`](https://github.com/velella-sh/offing/tree/main/examples/agents); see [AGENT_SKILLS.md](../AGENT_SKILLS.md).

## Verify locally

```bash
npx @velella/offing scan . --baseline .offing-baseline.json --fail-on high
```

Exit code 0 means nothing at or above the gate is uncovered by the baseline. The example repository keeps that command green in GitHub Actions on every push to `main`.

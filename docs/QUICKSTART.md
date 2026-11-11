# Quickstart

Five copy-paste steps, from the first scan to a baseline in CI. You need Node.js 22 or newer and a repository to scan. Every command runs locally; nothing is uploaded.

## 1. Run the first scan

```bash
npx @velella/offing scan .
```

Each finding names its severity, the exact file and line, the replacement, and the source. The first lines look like this on the demo project:

```text
Found 5 lifecycle risks. The most urgent:
  HIGH Unsupported actions/checkout runtime (.github/workflows/ci.yml:9)
  MEDIUM Node.js 18 is end-of-life (package.json:5)
  …
```

Add `--json` for machine-readable output, or `--format compact` for one line per finding when an agent reads the result.

## 2. Check one dependency before adding it

```bash
npx @velella/offing check pkg:npm/request@2.88.2
```

The command prints the lifecycle problem, the replacement, and the evidence. It exits `1` when a rule at or above `--fail-on` (default `high`) applies and `0` otherwise. `no-data` means Offing has no rule for the package, not that it is safe.

## 3. Read the evidence for one finding

Take a finding id from step 1 and inspect it:

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
      - uses: velella-sh/offing@v0.7.1
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

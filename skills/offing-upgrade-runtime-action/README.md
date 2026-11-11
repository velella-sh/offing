# Offing upgrade runtime or Action

Use Offing when an agent upgrades an already-declared runtime or GitHub Action. The Skill maps that moment to scan, check, migrate, and verify commands and leaves lifecycle rules inside Offing.

## Install and update

Install from the Offing monorepo:

```bash
npx skills add velella-sh/offing --skill offing-upgrade-runtime-action --yes
```

Or install every Skill:

```bash
npx skills add velella-sh/offing
```

Update an existing installation:

```bash
npx skills update offing-upgrade-runtime-action
```

## Example requests

- “Upgrade our Node.js runtime to the current LTS.”
- “Bump actions/checkout and actions/setup-node.”
- “Migrate .nvmrc from Node 14 to a maintained LTS.”
- “Replace the sunset actions/cache@v1 with a supported version.”

Adding a new dependency belongs to `offing-check-before-add`. Whole-repository lifecycle discovery without an upgrade ask belongs to `offing`.

## Execution path

The Skill needs either the local `offing mcp` stdio server or the `offing` CLI on `PATH`. It contains instructions and evaluation data only: no executable Skill scripts, credentials, hooks, or pre-approved tools.

See the [Agent Skill guide](../../docs/AGENT_SKILLS.md) for trigger evaluation and limits.

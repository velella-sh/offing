# Offing check-before-add

Use Offing at the moment an agent adds or chooses a package, runtime, or GitHub Action. The Skill maps that intent to `check_dependency` (or `offing check`) and leaves lifecycle rules inside Offing.

## Install and update

Install from the Offing monorepo:

```bash
npx skills add velella-sh/offing --skill offing-check-before-add --yes
```

Or install both Skills:

```bash
npx skills add velella-sh/offing
```

Update an existing installation:

```bash
npx skills update offing-check-before-add
```

## Example requests

- “Add the request package to this project.”
- “npm install left-pad and use it for padding.”
- “Which package should I use for date handling?”
- “Add actions/checkout@v4 to the CI workflow.”

Repository lifecycle scans, finding migration, verification, routine upgrades of already-declared dependencies, and removals belong to other workflows (see `offing`).

## Execution path

The Skill needs either the local `offing mcp` stdio server or the `offing` CLI on `PATH`. It contains instructions and evaluation data only: no executable Skill scripts, credentials, hooks, or pre-approved tools.

See the [Agent Skill guide](../../docs/AGENT_SKILLS.md) for trigger evaluation and limits.

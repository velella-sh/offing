# Offing

Use Offing's evidence-backed lifecycle workflows from a compatible coding agent. One Skill covers three moments: scanning a repository and explaining, migrating, and verifying its findings; checking a package, runtime, or GitHub Action before adding it; and upgrading a runtime or Action the repository already declares.

## Install and update

Install the Skill from the Offing monorepo:

```bash
npx skills add velella-sh/offing
```

To select the Skill explicitly or automate installation:

```bash
npx skills add velella-sh/offing --skill offing --yes
```

Update an existing installation:

```bash
npx skills update offing
```

## Example requests

- “Scan this repository for deprecated runtimes, packages, and GitHub Actions.”
- “Explain this Offing finding and show its lifecycle evidence.”
- “Create migration context for this finding and migrate the affected usages.”
- “Verify that the reported deprecation is gone after these changes.”
- “Add the request package to this project.” (checks it first)
- “Upgrade our Node.js runtime to the current LTS.”

Routine package upgrades, removals, vulnerability audits, deprecated application APIs, and unrelated modernization should use other workflows.

## Execution path

The Skill needs either the local `offing mcp` stdio server or the `offing` CLI on `PATH`. It contains instructions and evaluation data only: no executable Skill scripts, credentials, hooks, or pre-approved tools.

Offing reads repository files locally and makes no hosted Offing request. Structured results can contain file paths and short source excerpts; the selected agent host handles those results under its own privacy policy. Migration packets may suggest verification commands, but the host's normal permission rules still apply before execution.

## Compatibility

Installation from `velella-sh/offing` was validated with the skills CLI on 2026-10-15 for:

| Host | CLI target | Result |
| --- | --- | --- |
| Codex | `codex` | Installed |
| Claude Code | `claude-code` | Installed |
| Cursor | `cursor` | Installed |
| GitHub Copilot | `github-copilot` | Installed |
| Gemini CLI | `gemini-cli` | Installed |

See the [full Agent Skill guide](../../docs/AGENT_SKILLS.md) for the reproducible trigger evaluation and detailed limits.

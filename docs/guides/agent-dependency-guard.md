---
title: Stop your coding agent from adding deprecated packages
---

# Stop your coding agent from adding deprecated packages

Coding agents often reach for a familiar package without knowing it is deprecated. Offing's `offing` Skill (its "Check before adding" workflow) makes the agent check a Package URL against bundled lifecycle rules before it adds anything. The check stays offline after the package is cached; no account or API key is required.

## The problem, with a real package

Ask an agent without the Skill to "add the `request` package so we can call this HTTP API." Many models still reach for [`request`](https://www.npmjs.com/package/request), which has been fully deprecated since 2020. You can see the same lifecycle verdict Offing would give the agent:

```bash
npx @velella/offing check pkg:npm/request@2.88.2
```

Expected output (abbreviated):

```text
Offing check
pkg:npm/request@2.88.2
Status: affected (high)

pkg:npm/request@2.88.2: request is deprecated. The package is fully deprecated and no new changes are expected. Replacement: Native fetch or a maintained HTTP client.

HIGH request is deprecated
Replacement: Native fetch or a maintained HTTP client
Source: https://www.npmjs.com/package/request
```

Status `affected` means do not add it; prefer the named replacement and cite the source. `version-dependent` means check again with the exact version you intend to use. `no-data` means Offing has no rule for that package — not that it is safe.

## Install the Skill

Install both Offing Skills into your coding agent (lifecycle scans and the check-before-add guardrail):

```bash
npx skills add velella-sh/offing --yes
```

To install it explicitly:

```bash
npx skills add velella-sh/offing --skill offing --yes
```

Confirm it is present:

```bash
npx skills list
```

You should see `offing`. Restart the agent host (Cursor, Claude Code, Codex, or VS Code Copilot) so it reloads Skills.

One-command installs for each host, plus how to wire the local MCP server or CLI, are in the [Agent Skills guide](../AGENT_SKILLS.md#one-command-install-per-host).

## Show the result

In a fresh agent session, ask:

> Add the `request` package to this project.

With the Skill loaded, the agent should call `check_dependency` (or run `npx @velella/offing check pkg:npm/request`) before editing `package.json`. It reports the deprecation, names a replacement such as native `fetch` or a maintained HTTP client, and links the npm evidence — instead of adding `request`.

You can drive the same check yourself anytime:

```bash
npx @velella/offing check pkg:npm/request@2.88.2
npx @velella/offing check pkg:pypi/nose
npx @velella/offing check pkg:github/actions/checkout@v4
```

## Stronger options: hooks and MCP

The Skill is an instruction the agent follows. For hosts that can enforce a check, or for tools the agent calls directly:

- **Claude Code pre-install hook** — denies `npm` / `pip` installs that name a deprecated package. See [Hooks](../HOOKS.md#claude-code-pre-install).
- **Cursor rule and Copilot instructions** — always-on text that tells the agent to check first. See [Hooks](../HOOKS.md#cursor-rules) and [Hooks](../HOOKS.md#github-copilot-instructions).
- **Local MCP server** — expose `check_dependency` (and the full scan / migrate / verify tools) over stdio with no network listener. See [MCP](../MCP.md).

To put the same rule in any project's `AGENTS.md` or `CLAUDE.md`, copy the snippet from [examples/agents-snippet.md](../../examples/agents-snippet.md).

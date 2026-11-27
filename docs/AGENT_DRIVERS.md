---
title: Agent drivers
description: Discover, test and invoke local migration drivers.
---

# Agent drivers

`offing drivers list` displays installed CLI versions, alongside the generic
`command` driver and the deterministic `replay` driver. Select a vendor
explicitly for a migration or a live conformance check.

```sh
offing drivers list
offing drivers test replay
offing drivers test 'node /absolute/path/to/driver.mjs'
offing migrate <finding-id> --driver codex
offing migrate <finding-id> --driver replay --replay turns.json
```

The existing `offing migrate --agent 'my-command'` entry point still invokes
a trusted local shell command. The
[Agent Driver v1 protocol](https://velella.sh/offing/spec/agent-driver/v1/)
defines the environment, exit statuses and JSON result for a conforming
command. Follow that protocol and test your executable. A driver can live
with your other local executables.

## Built-in commands

| Driver | Supported versions | Controls |
| --- | --- | --- |
| Claude Code | 2.1.330 to before 2.2 | Print mode with restricted workspace file tools and no configured MCP servers. |
| Codex CLI | 0.171.x, including the verified 0.171.0-alpha.13.2 | Non-interactive exec with workspace-write sandbox and no extra writable roots. |
| Gemini CLI | 0.71.x | Headless prompt mode with sandbox and automatic edit approval only. |
| Aider | 0.86.x starting at 0.86.2 | Message-file mode with explicit editable files, automatic commits, lint and tests disabled. |

Unsupported versions are rejected before a prompt is sent. The Codex,
Gemini and Aider adapters refuse local configuration that could change
the process permissions, load hooks or enable tools. Review repository
configuration before selecting a trusted command explicitly. Vendor CLIs
use their local credential configuration. Node package-manager shims on
Windows can be invoked with the generic command entry point when direct
executable discovery is unavailable. For the documented flags, see the
[Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference),
[Codex CLI reference](https://developers.openai.com/codex/cli/reference),
[Gemini CLI reference](https://geminicli.com/docs/cli/cli-reference/) and
[Aider options](https://aider.chat/docs/config/options).

Claude's machine output supplies reported token counts and USD cost.
Codex JSONL and Gemini JSON supply reported token counts. Aider's current
message-file mode provides human-readable usage, so its structured metrics
are `null`.

## Replay recorded turns

Each replay turn is an object mapping an approved repository-relative path
to its complete UTF-8 replacement contents. Turns apply in order.

```json
{
  "schemaVersion": "offing.agent-replay.v1",
  "turns": [{ "package.json": "{\"dependencies\":{}}\n" }]
}
```

Replay is useful for regression tests and demonstrations that require no
agent login. Offing creates the local migration branch and verification
receipt after the replay, using the same path and rescan checks as a command.

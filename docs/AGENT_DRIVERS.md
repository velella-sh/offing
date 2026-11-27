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

## Claude Code for Action Autopilot

Use a Linux runner on the trusted default branch of a non-fork repository with a
`workflow_dispatch` trigger, `contents: read`, a clean checkout with
`persist-credentials: false`, and Docker. Configure an approved
`autopilot.tests` list in the committed Offing configuration. Install the
supported CLI before the Offing step.

```yaml
- name: Install the pinned migration driver
  env:
    DRIVER_DIR: ${{ runner.temp }}/offing-action-driver
  shell: bash
  run: |
    npm install --prefix "$DRIVER_DIR" --no-audit --no-fund @anthropic-ai/claude-code@2.1.330
    "$DRIVER_DIR/node_modules/.bin/claude" --version
    printf '%s\n' "$DRIVER_DIR/node_modules/.bin" >> "$GITHUB_PATH"

- name: Run a local Autopilot wave
  uses: velella-sh/offing@<reviewed-ref-with-autopilot>
  env:
    OFFING_ACTION_AUTOPILOT: "true"
    OFFING_ACTION_AUTOPILOT_SECRET_NAME: MIGRATION_AGENT_KEY
    OFFING_ACTION_AUTOPILOT_KEY: ${{ secrets.MIGRATION_AGENT_KEY }}
```

Use the same secret name in both lines. The Action reads only the value wired
to its step and passes it to the pinned driver as `ANTHROPIC_API_KEY` in a
fresh environment. Claude Code proposes replacements for scoped text files
with command and file tools disabled. Offing checks paths, secret content
and the reported budget before applying edits in its own worktree. Tests
run separately in pinned Docker. The resulting branch is local to the
runner. Claude Code's spend limit is an estimate. Use provider-side budget
controls for the key.

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

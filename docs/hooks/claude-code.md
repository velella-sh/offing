---
title: Claude Code edit hook
---

# Claude Code edit hook

Claude Code's `PostToolUse` hook runs after a tool finishes. Offing registers it for `Write`, `Edit`, and `MultiEdit`, reads `tool_input.file_path`, and answers in the protocol documented for Claude Code 2.1.316 (current stable, 2026-11-01) at <https://code.claude.com/docs/en/hooks>: `PostToolUse` cannot block a tool that already ran, and exit code `2` shows the hook's stderr to Claude so it can correct the file in the same turn. A scan with no findings exits `0` without output. Missing lifecycle data emits a warning and lets the session continue.

Offing's `PreToolUse` hook checks the proposed contents before Claude Code writes. A finding at the configured severity gate blocks the tool and shows its replacement. See [Check a snippet before writing](../check-snippet.md#agent-hooks).

## Install

Install Offing on the `PATH` that Claude Code uses to run hooks. A global install is one way to make the command available. From the project root, preview the proposed changes and then apply the setup.

```bash
npm install --global @velella/offing
offing init --hooks --list
offing init --hooks-for claude-code --dry-run
offing init --hooks-for claude-code
```

The command keeps every existing setting and hook — including the pre-install guard below — and adds `PreToolUse` and `PostToolUse` entries. Running it again changes nothing:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "offing hook claude-code",
            "timeout": 60
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "offing hook claude-code",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

The hook scans offline and has a ten-second scan budget.

## Remove

```bash
offing init --hooks --remove --hooks-for claude-code
```

Offing removes its edit hook entries and keeps the config file and other settings.

## Troubleshooting

If setup cannot detect Claude Code, open the host so it creates its home configuration, or make its CLI available on `PATH`, then run `offing init --hooks --list` from the project root.

If the host cannot start the hook, check that `offing --version` works with the host's `PATH`. An existing Offing hook using the older `npx` launcher can be refreshed by removing and reinstalling it.

Check that `disableAllHooks` is off. Open a new Claude Code session and edit a file with `Write` or `Edit` to verify the hook.

If Offing warns that lifecycle data is unavailable, check the installation and any `OFFING_DATA_VERSION` pin. Run `offing data status` to inspect the data selection.

The transcript below is real output from the built CLI on 2026-11-01, against the fixture repository in `tests/fixtures/agent-hooks/claude-code/repo` with the `PostToolUse` payload in `write.json`:

```console
$ cat Dockerfile
FROM node:16
WORKDIR /app
COPY . .
CMD ["node", "index.js"]

$ node dist/src/cli.js hook claude-code < posttooluse.json
Offing found 1 lifecycle issue in Dockerfile:
1) [high] Node.js image release lines 21 and older are end-of-life — Dockerfile:1
   Replacement: A node image on a supported release line, such as node:22
   Evidence: https://nodejs.org/en/about/eol

Fix this before continuing; nothing was changed automatically.
$ echo $?
2
```

Claude Code shows that stderr to the model, which rewrites the base image. The same payload then exits `0` with no output:

```console
$ sed -i 's/node:16/node:22/' Dockerfile

$ node dist/src/cli.js hook claude-code < posttooluse.json
$ echo $?
0
```

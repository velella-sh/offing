---
title: Cursor edit hook
---

# Cursor edit hook

Cursor's `afterFileEdit` hook runs after the Agent edits a file. Offing reads `file_path` and `workspace_roots` from the payload documented at <https://cursor.com/docs/hooks> (checked 2026-11-07 against the current Hooks reference; Cursor's project file is `.cursor/hooks.json` with `"version": 1`). **Limitation:** that reference documents no response fields for `afterFileEdit` that reach the agent — unlike Claude Code, Codex, and Gemini CLI, Cursor cannot feed findings back into the chat from this hook. Offing therefore:

1. Writes an always-applied instruction in `.cursor/rules/offing.mdc` only through `init` (never at hook time), so the agent still knows to check lifecycle status before adding a dependency.
2. Keeps the hook as an audit log on stderr and exits `0`. A scan with no findings exits `0` without output. Missing lifecycle data emits a warning and lets the session continue.

Offing's `preToolUse` hook checks proposed writes. A finding at the configured severity gate blocks the write and sends its replacement to the agent. See [Check a snippet before writing](../check-snippet.md#agent-hooks).

## Install

Install Offing on the `PATH` that Cursor uses to run hooks. A global install is one way to make the command available. From the project root, preview the proposed changes and then apply the setup.

```bash
npm install --global @velella/offing
offing init --hooks --list
offing init --hooks-for cursor --dry-run
offing init --hooks-for cursor
```

The command writes only the project-level file Cursor documents, `<repo>/.cursor/hooks.json` — never anything in your home directory — keeps every existing key and hook, adds `preToolUse` and `afterFileEdit` entries, and keeps (or creates) `.cursor/rules/offing.mdc`. Running it again changes nothing:

```json
{
  "version": 1,
  "hooks": {
    "afterFileEdit": [
      {
        "command": "offing hook cursor",
        "timeout": 60
      }
    ],
    "preToolUse": [
      {
        "command": "offing hook cursor",
        "timeout": 60,
        "matcher": "Write|Edit|StrReplace"
      }
    ]
  }
}
```

## Remove

```bash
offing init --hooks --remove --hooks-for cursor
```

Offing removes its edit hook entries and keeps the config file and other settings. Cursor keeps the shared project rule at `.cursor/rules/offing.mdc`. Use Cursor’s Rules settings to manage it.

## Troubleshooting

If setup cannot detect Cursor, open the host so it creates its home configuration, or make its CLI available on `PATH`, then run `offing init --hooks --list` from the project root.

If the host cannot start the hook, check that `offing --version` works with the host's `PATH`. An existing Offing hook using the older `npx` launcher can be refreshed by removing and reinstalling it.

Open Cursor’s **Settings → Hooks** and check the hook log after an Agent edit. Cursor writes findings and missing-data warnings there. The always-applied rule provides the instructions that the Agent reads.

If Offing warns that lifecycle data is unavailable, check the installation and any `OFFING_DATA_VERSION` pin. Run `offing data status` to inspect the data selection.

The transcript below is real output from the built CLI on 2026-11-07, against a repository holding the fixture Dockerfile from `tests/fixtures/agent-hooks/cursor/repo` with the `afterFileEdit` payload in `after-edit.json` (its `workspace_roots` pointed at that repository):

```console
$ cat Dockerfile
FROM node:16
WORKDIR /app
COPY . .
CMD ["node", "index.js"]

$ node dist/src/cli.js hook cursor < afterfileedit.json
Offing found 1 lifecycle issue in Dockerfile:
1) [high] Node.js image release lines 21 and older are end-of-life — Dockerfile:1
   Replacement: A node image on a supported release line, such as node:22
   Evidence: https://nodejs.org/en/about/eol

Fix this before continuing; nothing was changed automatically.
$ echo $?
0
```

That stderr is an audit log for the developer or CI watcher; Cursor does not inject it into the agent's context. The same payload for a file with no findings then exits `0` with no output:

```console
$ sed -i 's/node:16/node:22/' Dockerfile

$ node dist/src/cli.js hook cursor < afterfileedit.json
$ echo $?
0
```

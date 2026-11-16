---
title: Codex CLI edit hook
---

# Codex CLI edit hook

Codex CLI's `PostToolUse` hook runs after a tool finishes and matches the patch tool as `apply_patch` (the same tool is also matched as `Edit` or `Write`). Offing reads the patch in `tool_input.command`, scans every file it adds or updates, and answers with the JSON documented for the current stable Codex CLI rust-v0.166.0 (2026-10-29) at <https://developers.openai.com/codex/hooks> (redirects to <https://learn.chatgpt.com/docs/hooks>): `hookSpecificOutput.additionalContext` is added to the model's context, `systemMessage` is surfaced as a warning, and the hook exits `0` — the patch has already applied, so this is feedback the model acts on in the next request, never an error. A scan with no findings exits `0` without output. Missing lifecycle data emits a warning and lets the session continue.

Offing's `PreToolUse` hook previews the proposed patch. A finding at the configured severity gate blocks `apply_patch` and shows its replacement. See [Check a snippet before writing](../check-snippet.md#agent-hooks).

## Install

Install Offing on the `PATH` that Codex uses to run hooks. A global install is one way to make the command available. From the project root, preview the proposed changes and then apply the setup.

```bash
npm install --global @velella/offing
offing init --hooks --list
offing init --hooks-for codex --dry-run
offing init --hooks-for codex
```

The command writes only the project-level file Codex documents, `<repo>/.codex/hooks.json` — never anything in your home directory — keeps every existing key and hook, and adds `PreToolUse` and `PostToolUse` entries. Running it again changes nothing:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "apply_patch",
        "hooks": [
          {
            "type": "command",
            "command": "offing hook codex",
            "timeout": 60
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "apply_patch",
        "hooks": [
          {
            "type": "command",
            "command": "offing hook codex",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

## Remove

```bash
offing init --hooks --remove --hooks-for codex
```

Offing removes its edit hook entries and keeps the config file and other settings.

## Troubleshooting

If setup cannot detect Codex, open the host so it creates its home configuration, or make its CLI available on `PATH`, then run `offing init --hooks --list` from the project root.

If the host cannot start the hook, check that `offing --version` works with the host's `PATH`. An existing Offing hook using the older `npx` launcher can be refreshed by removing and reinstalling it.

Start Codex in the project and approve the registration in `/hooks` if it is pending. The project must be trusted for Codex to load `.codex/hooks.json`. An `apply_patch` edit with findings adds context to the session.

If Offing warns that lifecycle data is unavailable, check the installation and any `OFFING_DATA_VERSION` pin. Run `offing data status` to inspect the data selection.

The transcript below is real output from the built CLI on 2026-11-04, against a repository holding the fixture Dockerfile from `tests/fixtures/agent-hooks/codex/repo` with the `PostToolUse` payload in `patch-update.json` (its `cwd` pointed at that repository):

```console
$ cat Dockerfile
FROM node:16
WORKDIR /app
COPY . .
CMD ["node", "index.js"]

$ node dist/src/cli.js hook codex < posttooluse.json
{
  "systemMessage": "Offing found 1 lifecycle issue in the files just changed.",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Offing found 1 lifecycle issue in Dockerfile:\n1) [high] Node.js image release lines 21 and older are end-of-life — Dockerfile:1\n   Replacement: A node image on a supported release line, such as node:22\n   Evidence: https://nodejs.org/en/about/eol\n\nFix this before continuing; nothing was changed automatically."
  }
}
$ echo $?
0
```

Codex adds that `additionalContext` to the model's context, which rewrites the base image. The same payload for a file with no findings then exits `0` with no output:

```console
$ sed -i 's/node:16/node:22/' Dockerfile

$ node dist/src/cli.js hook codex < posttooluse.json
$ echo $?
0
```

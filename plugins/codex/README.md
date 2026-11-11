# Offing for Codex

Offing finds, explains, and verifies supported software lifecycle risks in local repositories. The plugin combines the canonical Offing Skill with a read-only local MCP server and requires no Offing account.

Repository analysis runs on the user's computer. Offing does not upload repository contents, execute migration commands, edit files, or open a network listener. The host still controls filesystem access, approvals, and any later edits an agent makes.

## Install

From the Offing repository, run:

```sh
codex plugin add offing@offing-codex
```

Node.js 22 or newer is required. See the [Codex installation and management guide](https://velella.sh/offing/CODEX_PLUGIN.html) for installation, updates, validation, privacy boundaries, and removal.

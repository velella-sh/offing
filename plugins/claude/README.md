# Offing for Claude

Offing helps Claude find, explain, migrate, and verify software lifecycle risks without duplicating detector logic in the plugin. Its Skill guides the workflow while the bundled local MCP configuration starts the exact Offing npm release declared by this plugin. Repository contents stay local unless you explicitly choose to share them.

## Install

From a Claude Code session:

```text
/plugin install offing --marketplace velella-sh/offing
```

## What you get

- Evidence-backed scans for supported runtimes, dependencies, and GitHub Actions.
- Clear explanations linked to the matching lifecycle rule.
- Migration context and local verification through one consistent workflow.
- The same scan, explain, context, and verify behavior used by the Codex adapter.
- A dependency guard that warns, with evidence and a replacement, when an edit adds a deprecated package or action.

Node.js 22 or newer is required for the local MCP server. See the [installation and management guide](https://velella.sh/offing/CLAUDE_PLUGIN.html) for marketplace, project, update, disable, and removal commands.

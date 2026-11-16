# Stable host hook payloads

The installed-hook tests replay these payloads after substituting the temporary workspace for `/Users/dev/app`.
Session identifiers, transcript paths, and user paths are anonymized. The checked files are temporary fixtures.

- `claude-code.json` reuses the Claude Code 2.1.316 recording in [the host fixtures](../agent-hooks/claude-code/README.md).
- `codex.json` records `PostToolUse` from Codex CLI 0.169.0-alpha.11.1 after an `apply_patch` edit.
- `cursor.json` records `afterFileEdit` from Cursor 3.30.14 after adding a comment through the Agent editor.

---
title: Stack context
description: Read reviewed runtime and dependency lifecycle evidence at agent session start.
---

# Stack context

Use the [MCP tool](MCP.md#tools) `stack_context` with an optional `repository_path`. The resource `offing://stack/context` reads the server's working directory. Both return the [stack context v1 document](spec/stack-context/v1.md). The server's startup instructions include a short summary when it finds a current cache for that directory.

Run these commands from your project before starting a new local agent session.

```sh
offing scan .
offing init --hooks --dry-run
offing init --hooks
```

The hook command is `offing hook session-start <host>`. It uses the host process's working directory as the project, checks the cached detector version and data release, and verifies the cached input digests. The scan must be from the current UTC day. A missing, stale, or unavailable cache prints one diagnostic and the hook returns success without rerunning detectors. The MCP tool and resource can run a fresh scan without modifying the project.

| Host | Event | Notes |
| --- | --- | --- |
| Claude Code | `SessionStart` | [Hook protocol](https://code.claude.com/docs/en/hooks#sessionstart) |
| Codex | `SessionStart` | Trust the project hook in the host. [Hook protocol](https://learn.chatgpt.com/docs/hooks#sessionstart) |
| Cursor | `sessionStart` | Local agent sessions. [Hook protocol](https://cursor.com/docs/hooks#sessionstart) |
| GitHub Copilot | `sessionStart` | Copilot CLI and cloud surfaces that honor session context. [Hook protocol](https://docs.github.com/en/copilot/reference/hooks-reference#sessionstart-hook) |
| Gemini CLI | `SessionStart` | [Hook protocol](https://geminicli.com/docs/hooks/reference/#sessionstart) |
| Devin CLI | `SessionStart` | [Hook protocol](https://docs.devin.ai/cli/extensibility/hooks/overview.md) |
| Cline | `TaskStart` | VS Code extension with hooks enabled. An existing custom TaskStart script is preserved. [Hook protocol](https://github.com/cline/cline/blob/main/.clinerules/hooks/README.md#taskstart-hook) |

Unknown hosts produce one diagnostic and no context. Some host surfaces skip session hooks or run them without consuming output, including Cursor cloud agents and Cline CLI/SDK configurations without blocking run-start hooks. MCP remains available on surfaces that can start the local server.

The JSON is limited to 1,000 estimated tokens and includes the count of entries omitted. Announced dates and replacements come from reviewed lifecycle rules. `no-data` signals a gap in the evidence. Use the source links in returned entries when making version decisions.

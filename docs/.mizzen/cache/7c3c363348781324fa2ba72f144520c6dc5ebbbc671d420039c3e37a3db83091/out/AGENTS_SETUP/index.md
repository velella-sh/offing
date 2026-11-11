
# Offing for your agent

Offing can tell a coding agent to check a dependency before it adds one. Each host below gets the same guardrail: an instruction file (and, where the host supports it, a local MCP server or a plugin hook). Setup stays offline after the first package fetch; no Offing account is required.

The fastest path when the repository already shows which host you use:

```bash
npx @velella/offing init agent --dry-run   # show the file it would write
npx @velella/offing init agent             # write or refresh it
```

`init agent` detects Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, Kilo Code, Windsurf, Cline, and Aider, and updates only the marked Offing section so your own rules stay intact. When nothing is detected, run `npx @velella/offing init --agents` to add the section to `AGENTS.md` or `CLAUDE.md`, or follow a host section below.

Every host shares the same verify prompt: ask the agent to `Add the request package to this project`, and confirm it checks `pkg:npm/request` (via `check_dependency` or `npx @velella/offing check`) and reports the deprecation with a replacement and sources instead of adding the package.

## Claude Code

**Setup.** Install the [Claude plugin](CLAUDE_PLUGIN.md) (`claude plugin install offing --marketplace velella-sh/offing`), or copy the PreToolUse hook from [`integrations/claude-code/`](https://github.com/velella-sh/offing/tree/main/integrations/claude-code) as described in [Hooks](HOOKS.md#claude-code-pre-install). `init agent` writes the instruction section to `CLAUDE.md` when it finds `.claude` or that file.

**Verify.** Start a new Claude Code session in a project with the plugin or hook installed and use the shared verify prompt above. With the plugin, confirm `claude plugin list` shows `offing` and that the agent can call the packaged MCP tools.

**Opt out.** `claude plugin disable offing@offing` (or `uninstall`) stops the Skill and MCP server. For the PreToolUse hook alone, set `OFFING_SKIP=1` for the session, or remove the hook entry from `.claude/settings.json` and the script under `.claude/hooks/`. Details: [Claude plugin](CLAUDE_PLUGIN.md#disable-and-re-enable), [Hooks](HOOKS.md#opt-out).

## Codex

**Setup.** Install the [Codex plugin](CODEX_PLUGIN.md) (`codex plugin add offing@offing-codex`). `init agent` writes the instruction section to `AGENTS.md` when it finds `.codex`. Trust the dependency-guard hook with `/hooks` after install; Codex does not run plugin hooks until you review them.

**Verify.** Restart the Codex session, run `codex plugin list --json`, then use the shared verify prompt. Confirm the agent calls `check_dependency` (or the Skill's CLI fallback) and refuses `request`.

**Opt out.** `codex plugin remove offing@offing-codex` removes the installed plugin cache. Leaving hooks untrusted, or setting `[features] hooks = false`, turns off only the PostToolUse guard while the Skill can still instruct a check. Details: [Codex plugin](CODEX_PLUGIN.md#remove).

## Cursor

**Setup.** Copy [`integrations/cursor/offing.mdc`](https://github.com/velella-sh/offing/blob/main/integrations/cursor/offing.mdc) to `.cursor/rules/` (Cursor reads only `.mdc` rules). For MCP, follow [`examples/agents/cursor/`](https://github.com/velella-sh/offing/tree/main/examples/agents/cursor). `init agent` writes the same rule when it detects `.cursor` or `.cursorrules`. Full copy steps: [Hooks](HOOKS.md#cursor-rules).

**Verify.** Restart Cursor, enable the `offing` server under Settings → MCP if you added it, then use the shared verify prompt.

**Opt out.** Delete `.cursor/rules/offing.mdc`, or set `alwaysApply: false` / remove the rule from the project. Disable or remove the `offing` entry in `.cursor/mcp.json` (or `~/.cursor/mcp.json`) if you added MCP.

## GitHub Copilot

**Setup.** Copy [`integrations/copilot/copilot-instructions.md`](https://github.com/velella-sh/offing/blob/main/integrations/copilot/copilot-instructions.md) to `.github/copilot-instructions.md`. For MCP in VS Code Copilot Chat or the coding agent, follow [`examples/agents/copilot/`](https://github.com/velella-sh/offing/tree/main/examples/agents/copilot). `init agent` refreshes the marked section when that file or `.github/instructions` is present. Full copy steps: [Hooks](HOOKS.md#github-copilot-instructions).

**Verify.** In Copilot Chat Agent mode (or the coding agent, once MCP is configured), use the shared verify prompt.

**Opt out.** Remove the Offing section from `.github/copilot-instructions.md` (or delete the file if it holds only that section). Remove the `offing` server from `.vscode/mcp.json` or the repository's Copilot coding-agent MCP settings.

## Gemini CLI

**Setup.** Use the extension under [`examples/agents/gemini/`](https://github.com/velella-sh/offing/tree/main/examples/agents/gemini) (`gemini extensions install` from that directory), or merge `settings.json` and `GEMINI.md` from there into `.gemini/` / `GEMINI.md`. `init agent` updates `GEMINI.md` when it finds `.gemini` or that file.

**Verify.** Start a new Gemini CLI session with the extension or settings loaded and use the shared verify prompt. Confirm the `offing` tools are listed before relying on them.

**Opt out.** Uninstall the extension, or remove the `offing` MCP entry from `.gemini/settings.json` and the Offing section from `GEMINI.md`.

## Kilo Code

**Setup.** Follow [`examples/agents/kilo/`](https://github.com/velella-sh/offing/tree/main/examples/agents/kilo): copy `kilo.jsonc` (or merge its `mcp.offing` entry) and `.kilo/rules/offing.md`. Older installs that use `.kilocode/` take the same files at those paths. `init agent` writes `.kilo/rules/offing.md` or `.kilocode/rules/offing.md` from the markers it finds.

**Verify.** Start a new Kilo chat and use the shared verify prompt. Confirm the Offing check-dependency tool is available.

**Opt out.** Delete `.kilo/rules/offing.md` (or the `.kilocode` copy) and remove the `offing` MCP entry from `kilo.jsonc`.

## Windsurf

**Setup.** Follow [`examples/agents/windsurf/`](https://github.com/velella-sh/offing/tree/main/examples/agents/windsurf): copy `.windsurf/rules/offing.md` and merge the `offing` entry from `mcp_config.json` into the MCP config Cascade opens. `init agent` writes the rule when it finds `.windsurf` or `.windsurfrules`.

**Verify.** Refresh MCP servers in Cascade, confirm the `offing` tools are listed, then use the shared verify prompt.

**Opt out.** Delete `.windsurf/rules/offing.md` and remove the `offing` entry from the Cascade MCP config file.

## Cline

**Setup.** Follow [`integrations/cline/`](https://github.com/velella-sh/offing/tree/main/integrations/cline): copy `.clinerules/offing.md` (or `.cline/rules/offing.md`) and merge `cline_mcp_settings.json` into Cline's MCP settings. `init agent` picks the path from whichever marker it finds. Details: [`integrations/cline/README.md`](https://github.com/velella-sh/offing/blob/main/integrations/cline/README.md).

**Verify.** Start a new Cline task, confirm the `offing` tools are listed, then use the shared verify prompt.

**Opt out.** Delete the Offing rule under `.clinerules/` or `.cline/rules/`, and remove the `offing` entry from Cline's MCP settings.

## Aider

**Setup.** Follow [`integrations/aider/`](https://github.com/velella-sh/offing/tree/main/integrations/aider): copy `CONVENTIONS.md` to the project root and load it via `.aider.conf.yml` (`read: CONVENTIONS.md`) or `aider --read CONVENTIONS.md`. Aider has no MCP path; the conventions call the CLI. `init agent` writes `CONVENTIONS.md` when it finds `.aider.conf.yml` or `.aider`. Details: [`integrations/aider/README.md`](https://github.com/velella-sh/offing/blob/main/integrations/aider/README.md).

**Verify.** Start a new aider session with the conventions loaded and use the shared verify prompt. Confirm it runs `npx @velella/offing check pkg:npm/request` and reports the deprecation.

**Opt out.** Stop loading `CONVENTIONS.md` (remove the `read` entry or delete the file), or remove only the Offing section if the file holds other conventions.

## Related pages

- [Agent Skill](AGENT_SKILLS.md) — portable skill install and trigger evaluation
- [Local MCP server](MCP.md) — tools and host-agnostic server config
- [Hooks](HOOKS.md) — Git pre-push, Claude Code PreToolUse, Cursor rule, Copilot instructions
- [Claude plugin](CLAUDE_PLUGIN.md) · [Codex plugin](CODEX_PLUGIN.md)
- [Playbook: agent-driven migrations](playbooks/agent.md)

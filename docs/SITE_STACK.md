---
title: Offing and Slipway
---

# Offing and Slipway

Two tools share the work on a [Slipway](https://github.com/arminazimi/slipway)-shaped Jekyll site for GitHub Pages. Each one owns a different question. Use them in order so an agent (or a human) does not mix lifecycle evidence with site layout concerns.

| Tool | Owns | Maturity |
| --- | --- | --- |
| **Offing** | Whether a gem, npm package, GitHub Action, or runtime line is deprecated or end-of-life, with evidence | Shipped (`offing` on npm) |
| **Slipway** | The Jekyll theme, layout, and Pages-oriented site stack | In planning and dogfooding; use only what its repository documents |

Offing runs locally against files on disk. It does not send your repository to a cloud service during a check or scan.

## The agent loop

Work in this order when you change dependencies or site content.

### 1. Before adding a gem, package, or Action

Check the dependency with Offing **before** you edit `Gemfile`, `package.json`, or workflow `uses:` pins.

```bash
npx @velella/offing check pkg:rubygems/jekyll@4.3.4
npx @velella/offing check pkg:npm/typescript@5.4.5
npx @velella/offing check pkg:github/actions/checkout@v4
```

Or, if the CLI is on your `PATH` as `offing`:

```bash
offing check pkg:rubygems/jekyll@4.3.4
```

- If the result is `affected`, prefer the replacement Offing names and cite its evidence links. Do not add the dependency without telling the user why.
- `version-dependent` means the answer depends on the version — call again with the version you intend to lock.
- `no-data` means Offing has no rule for that package; it is **not** a claim that the package is safe.

For Ruby gems on a Pages site, also keep an eye on the Ruby runtime line (`.ruby-version`, `Gemfile`, `Gemfile.lock`) — GitHub Pages builds with a fixed Ruby line that must still receive fixes.

### 2. Edit pages and configuration

Change Markdown, `_config.yml`, layouts, and workflows as the task requires. Slipway-specific behavior follows the Slipway repository and starter; do not assume features that are not documented there.

Copy the Offing CI starter when the site has no lifecycle gate yet: [examples/starters/slipway/](../examples/starters/slipway/).

## Which output to trust for what

| Question | Trust |
| --- | --- |
| Is this gem, package, or Action deprecated or end-of-life? | Offing `check` (or repository `scan`) — lifecycle rules with sources |
| What is already declared in this repo? | Offing `scan` on the tree — findings at exact paths |

Offing answers **lifecycle** questions with reviewed rules. A clean Offing scan does not mean the site's links work or that a new gem is safe in other ways.

## Wire this into your agent

Copy [examples/agents/site-stack/AGENTS.md](../examples/agents/site-stack/AGENTS.md) into the site repository (merge with your existing `AGENTS.md` if you already have one). It repeats the loop in imperative form for coding agents.

Related:

- [Offing for your agent](AGENTS_SETUP.md) — MCP, hooks, and host-specific setup
- [Slipway starter kit](../examples/starters/slipway/) — `.offing.json` and a pull-request workflow
- [Dependency check snippet](../examples/agents/dependency-check.md) — short guardrail text you can paste anywhere

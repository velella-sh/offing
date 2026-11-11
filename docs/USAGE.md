# Using Offing

The full command walkthrough, moved out of the README. For a five-step path from the first scan to CI, start with the [quickstart](QUICKSTART.md); every flag is in the [CLI reference](CLI.md).

## Commands

The [five-step quickstart](QUICKSTART.md) has copy-paste commands and expected output for each step.

Requirements: Node.js 22 or newer.

```bash
npx @velella/offing scan .
```

For coding agents, install the Agent Skill with one command. It teaches your agent to find, explain, and migrate these findings, and it is listed on [skills.sh](https://skills.sh/velella-sh/offing/offing):

```bash
npx skills add velella-sh/offing
```

Give an agent a short answer instead of the full report: one line per finding with its id, location, severity, and replacement, most severe first, capped at 25 findings (the rest are counted) and under 8 KiB:

```bash
npx @velella/offing scan . --format compact
```

Verify that the CLI, local MCP server, Agent Skill, plugin foundations, and CI
workspace are ready without changing configuration or uploading repository data:

```bash
npx @velella/offing doctor .
npx @velella/offing doctor . --json
```

See the [public compatibility matrix](COMPATIBILITY.md) for supported,
experimental, and unsupported combinations.

Discover Offing's versioned capabilities and entry points programmatically:

```bash
npx @velella/offing capabilities --json
```

The [auto-discovery contract](CAPABILITIES.md) defines the shared identifiers
used by the CLI, MCP server, Agent Skill, plugins, and CI integrations.

Create a baseline for accepted existing findings, then report only new lifecycle regressions:

```bash
npx @velella/offing baseline .
npx @velella/offing scan . --baseline .offing-baseline.json
```

Check a single dependency before adding it, without scanning a repository:

```bash
npx @velella/offing check pkg:npm/request@2.88.2
npx @velella/offing check pkg:github/actions/checkout@v4 --json
```

The command prints the lifecycle problem, replacement, and evidence, and exits `1` when a rule at or above `--fail-on` (default `high`) applies, `0` otherwise, `2` for a wrong command line, and `4` for a Package URL that cannot be parsed (see [exit codes](CAPABILITIES.md#exit-codes-and-error-codes)). A package Offing has no rule for reports `no-data`, which is not a claim that it is safe. Without a version, a package whose rules only cover some versions reports `version-dependent`; add a version to get a definite answer.

Lifecycle rules can be refreshed between releases from signed bundles, and scans stay offline unless you ask:

```bash
npx @velella/offing data status
npx @velella/offing data update
```

See [Lifecycle data](DATA.md) for the signing and trust model, pinning, and what happens when a download cannot be verified.

Inspect the evidence and migration direction for one result:

```bash
npx @velella/offing explain '<finding-id>' .
```

Generate portable migration context for a human or coding agent:

```bash
npx @velella/offing context '<finding-id>' . --json
```

Migration packets contain rule-specific constraints and steps, exact affected files and usages, authoritative sources, and suggested verification commands. Offing never executes those commands automatically. See the [migration packet guide](MIGRATION_PACKETS.md).

Tell the coding agents working in a repository to check dependencies before adding them. This adds (or refreshes) a clearly marked section in `AGENTS.md`, or `CLAUDE.md` if that is the file you have; running it again changes nothing, and nothing outside the markers is touched:

```bash
npx @velella/offing init --agents --dry-run   # show the change
npx @velella/offing init --agents
```

To do this for every coding agent a repository is already set up for, run `setup`. It detects Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, and Kilo Code configuration, shows the change for each host's instruction file, and writes only after you confirm (or pass `--yes`). It uses the same marked section as `init --agents`, so existing rules are never overwritten:

```bash
npx @velella/offing setup --dry-run   # print the plan
npx @velella/offing setup             # ask, then write
npx @velella/offing setup --yes       # no prompt (CI, scripts)
```

Connect a coding agent through the local MCP server:

```bash
npx --yes @velella/offing mcp
```

The stdio server exposes `scan_repository`, `list_deprecations`, `explain_deprecation`, `create_migration_context`, `verify_migration`, and `check_dependency` (check one package before adding it). See the [local MCP guide](MCP.md) for host configuration, the intended workflow, and privacy guarantees.

## Agent Skill

Install the vendor-neutral Agent Skill from the monorepo:

```bash
npx skills add velella-sh/offing
```

Pull future revisions with:

```bash
npx skills update offing
```

The [`offing` Skill](../skills/offing/README.md) teaches discovery, explanation, migration, and verification while leaving detection and migration logic inside Offing. It is discoverable on [skills.sh](https://skills.sh/velella-sh/offing/offing) and has been install-validated for Codex, Claude Code, Cursor, GitHub Copilot, and Gemini CLI. See the [Agent Skill guide](AGENT_SKILLS.md) for evaluation, compatibility, limits, and security assumptions.

Codex and Claude plugin packages are generated from that same Skill and MCP workflow. Their [packaging architecture](PLUGIN_PACKAGING.md) keeps host manifests thin and fails CI when either package drifts from the canonical sources.
The [cross-host evaluation](PLUGIN_EVALS.md) publishes shared-corpus results, context budgets, permission behavior, and security limitations; the same checks block release regressions in `npm run check`.

Offing runs locally and does not upload repository contents. Which commands read the filesystem, read the environment, spawn processes, or use the network is spelled out in the [command and surface access](PRIVACY.md#command-and-surface-access) table (also summarized in [SECURITY.md](../SECURITY.md#trust-model)).

## Detectors in the box

```bash
npm install
npm run check
```

The initial detector reports unsupported major versions of five first-party actions with exact file and line locations:

- `actions/checkout`
- `actions/setup-node`
- `actions/cache`
- `actions/upload-artifact`
- `actions/download-artifact`

Pinned commit SHAs and dynamic expressions are intentionally left unclassified until Offing can resolve them without guessing.

The npm detector also reads `package.json`, npm/pnpm/Yarn lockfiles, Node.js runtime declarations, and a small evidence-backed registry of deprecated direct dependencies. Use `offing explain <finding-id>` to inspect a finding and its sources. If a finding is wrong, `offing report-issue <finding-id>` prints a Markdown report with the rule, its evidence, and a few redacted lines of the declaring file, and never opens an issue or uses the network.

The Python detector reads PEP 621 and Poetry metadata from `pyproject.toml`, `requirements*.txt`, common runtime-version files, and uv/Poetry/PDM/Pipenv lockfiles. It reports unsupported Python declarations and lifecycle risks in direct dependencies while ignoring transitive-only lockfile entries.

## Source usage analysis

Package lifecycle findings now include the concrete imports, calls, and configuration keys that make a migration necessary. Matching is language-aware and alias-aware for JavaScript, TypeScript, and Python, with configuration-key support for JSON, YAML, TOML, INI, and Python settings. Each match includes its exact file, line, column, and source excerpt, plus a migration-impact estimate based on affected usages and files.

The analyzer scans the repository once for a batch of detector contracts and ignores generated, dependency, build, and environment directories. Run the repeatable accuracy and scan-time benchmark with:

```bash
npm run benchmark:usage
```

See [the benchmark notes](BENCHMARKS.md) for the corpus and interpretation.


## Detector SDK

External detectors can use the versioned interface exported by `@velella/offing/sdk`. The scan engine composes compatible detectors without importing any built-in implementation.

See the [detector authoring guide](DETECTORS.md) and the [minimal detector example](../examples/detectors/todo-comments.ts).

## Initial product shape

The CLI is the product. Detectors extend it, GitHub Actions automate it, and the local MCP server exposes it to agents. A hosted backend is intentionally outside the roadmap; lifecycle data updates through a signed, offline-verifiable data channel instead.

See [the roadmap](ROADMAP.md), [architecture](ARCHITECTURE.md), [brand files](../brand/README.md), [contribution guide](../CONTRIBUTING.md), and [security policy](../SECURITY.md).

## Product principles

- Local-first: source code stays on the user's machine or CI runner.
- Deterministic core: findings do not require an LLM.
- Evidence-backed: every deprecation claim links to an authoritative source.
- Agent-ready: every human-readable report has a machine-readable equivalent.
- Extensible: ecosystems are added through detectors rather than core rewrites.

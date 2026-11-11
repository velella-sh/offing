# Offing Agent Skills

Offing ships one portable Skill under `skills/offing/`. It follows the open Agent Skills directory format: standard YAML frontmatter plus Markdown instructions. There is no vendor-specific manifest, invocation policy, tool allowlist, script, or generated prompt.

| Workflow in the Skill | Moment |
| --- | --- |
| Scan and migrate | Repository lifecycle scans and finding explain / migrate / verify |
| Check before adding | Adding or choosing a package, runtime, or GitHub Action |
| Upgrade a runtime or Action | Upgrading an already-declared runtime or GitHub Action |

New to the dependency guardrail? Follow the tutorial [Stop your coding agent from adding deprecated packages](guides/agent-dependency-guard.md).

## Design

The Skill is an orchestration layer. It tells an agent when to act, then maps those intents to Offing's MCP tools or CLI commands. Lifecycle rules, evidence, affected-file calculation, migration steps, and verification behavior remain in the executable and versioned JSON contracts.

This prevents prompt drift: improving a detector or migration packet changes every client without requiring a rewritten Skill. The Skill opens with a table that routes the task to one of its three workflows, so a single install covers all three moments.

## Installation

The skills CLI discovers the Skill directly from the Offing monorepo. No dedicated distribution repository is needed:

```sh
npx skills add velella-sh/offing
```

For a non-interactive or explicitly selected install, use:

```sh
npx skills add velella-sh/offing --skill offing --yes
```

Update it with:

```sh
npx skills update offing
```

The npm package also includes the complete `skills/offing` folder for hosts that prefer a manual copy or link.

To tell the agents working in any other project to check dependencies with Offing, copy the snippet in [examples/agents-snippet.md](../examples/agents-snippet.md) into `AGENTS.md`, `CLAUDE.md`, or a similar instruction file.

The host also needs one Offing execution path:

- the local `offing mcp` stdio server; or
- the `offing` CLI available on `PATH`.

No account or API key is required.

## One-command install per host

Each host below gets the Skills with one install command. Claude Code and Codex also receive the local MCP server through the same plugin ([MCP](MCP.md#one-command-install-per-host)). Cursor and VS Code need the MCP server separately. Every command was run in a clean environment on 2026-10-29 (macOS, Node.js 22).

Shared verify prompt after install: ask the agent to `Add the request package to this project`, and confirm it checks `pkg:npm/request` (via `check_dependency` or `npx @velella/offing check`) and reports the deprecation with a replacement and sources instead of adding the package.

### Claude Code

```sh
claude plugin install offing --marketplace velella-sh/offing
```

**Verify.** `claude plugin list` shows `offing@offing` enabled, and `claude plugin details offing` lists both Skills. Start a new session and use the shared verify prompt.

Portable skills-CLI alternative: `npx skills add velella-sh/offing --agent claude-code --yes`, then `npx skills list`.

### Codex

```sh
codex plugin marketplace add velella-sh/offing --ref main && codex plugin add offing@offing-codex
```

When the Offing repository marketplace is already configured, `codex plugin add offing@offing-codex` alone is enough.

**Verify.** Restart the Codex session, run `codex plugin list --json`, and confirm `offing@offing-codex` is installed. Then use the shared verify prompt.

Portable skills-CLI alternative: `npx skills add velella-sh/offing --agent codex --yes`, then `npx skills list`.

### Cursor

```sh
npx skills add velella-sh/offing --agent cursor --yes
```

**Verify.** `npx skills list` shows `offing`. Restart Cursor, then use the shared verify prompt. For the MCP server, see [MCP](MCP.md#one-command-install-per-host).

### VS Code

VS Code Copilot Chat picks up the Skills through the skills CLI's `github-copilot` target:

```sh
npx skills add velella-sh/offing --agent github-copilot --yes
```

**Verify.** `npx skills list` shows `offing`. Reload the VS Code window, open Copilot Chat in Agent mode, then use the shared verify prompt. For the MCP server, see [MCP](MCP.md#one-command-install-per-host).

## One Skill for every ecosystem

Offing briefly shipped four per-ecosystem Skills (Node.js, Python, GitHub Actions, containers) and removed them in favor of one Skill. They were near-copies that differed only by a rule-prefix filter, so every workflow change had to be made five times, they could trigger together on one request, and they covered four of the ecosystems Offing supports. The claim that narrower descriptions trigger more reliably was never measured for that split. A later split by *moment* produced `offing-check-before-add` and `offing-upgrade-runtime-action` next to `offing`. Those were merged back into the single `offing` Skill (2026-11-11) so there is one install, one skills.sh entry, and one description to maintain; the three moments are now sections of that Skill and keep their own eval corpora below. If a measurement shows a gain from splitting, split then.

The ecosystem-specific cautions live in the lifecycle Skill's "Ecosystem notes".

## Use the guardrail in this repository

Agents working on Offing itself follow the same rule the Check before adding workflow teaches: run `offing check <purl>` before adding any dependency, runtime, or Action. Install the Skill as above, or run the check from source, which needs nothing else:

```sh
npm run dev -- check pkg:npm/request@2.88.2
```

The rule is stated for contributors in [AGENTS.md](../AGENTS.md#dependencies), and the `self-scan` CI job backs it up by failing on any finding the baseline does not cover (see [ADOPTION.md](ADOPTION.md#scanning-this-repository)).

## Discovery and host compatibility

On 2026-10-15, `npx skills add velella-sh/offing --list` discovered the `offing` Skill. A clean project installation then selected and installed that Skill for five representative skills CLI targets:

| Host | `--agent` value | Install result |
| --- | --- | --- |
| Codex | `codex` | Passed |
| Claude Code | `claude-code` | Passed |
| Cursor | `cursor` | Passed |
| GitHub Copilot | `github-copilot` | Passed |
| Gemini CLI | `gemini-cli` | Passed |

The same install registered the Skill with skills.sh. It is discoverable as `velella-sh/offing@offing` at [skills.sh](https://skills.sh/velella-sh/offing/offing). The skills CLI security summary reported Gen Agent Trust Hub **Safe**, Socket **0 alerts**, and Snyk **Low Risk** at validation time. These external assessments can change and do not replace review of the installed files.

## Evaluation

### Scan-and-migrate workflow

Each workflow keeps its own corpus and trigger proxy under `skills/offing/evals/`. The Skill triggers on the union of the three; the gates below apply to each workflow, and the separation check keeps them from claiming each other's prompts.

Trigger evaluation cases live in `skills/offing/evals/cases.json`. The versioned corpus contains 114 prompts: 54 expected triggers and 60 expected non-triggers, including 24 deliberately ambiguous requests and six add-a-dependency prompts that must not select this Skill. Each of the `agent-skills`, `codex`, and `claude` discovery lanes has 38 cases.

Run the deterministic metadata-selection proxy from the repository root:

```sh
npm run eval:skill-triggers
```

The command builds the evaluator, prints JSON results overall and by host lane, lists any failed case IDs, and exits unsuccessfully when the corpus has fewer than 50 cases, recall is below 90%, or the false-trigger rate is 5% or higher. It has no model, network, account, or API-key dependency, so CI and contributors can reproduce the same baseline.

Current published baseline:

| Lane | Cases | Recall | False-trigger rate |
| --- | ---: | ---: | ---: |
| All | 114 | 100% | 0% |
| Agent Skills | 38 | 100% | 0% |
| Codex | 38 | 100% | 0% |
| Claude | 38 | 100% | 0% |

### Tuning the description

The first published corpus was written against the description's concepts, so it passed completely and could not show whether the wording covered everyday requests. Expanding it to 108 cases exposed both directions of the problem:

| Measurement | Cases | Recall | False-trigger rate |
| --- | ---: | ---: | ---: |
| Previous description, expanded corpus | 108 | 79.6% | 7.4% |
| Tuned description and proxy | 108 | 100% | 0% |

Fifteen cases failed before the change. Eleven trigger requests missed because the description did not name support and maintenance status, container base images, or finding and verification work without the product name. Four non-goals falsely triggered because "deprecated" plus a manifest or a supported runtime was enough to cross the boundary, even when the request was about an npm script, a React hook, a Python function, or a Node API. The revised description states those boundaries, and the deterministic proxy that encodes it now requires a lifecycle status before a source-API or configuration request counts as a trigger. The gates are unchanged.

This is a contract test for the concepts exposed by the skill metadata, not a claim that every model version will make an identical routing decision. Live host checks can add observations without weakening the deterministic CI gate. Generic dependency upgrades, vulnerability or security audits, deprecated source APIs, project scripts, configuration, and unrelated modernization are explicit negative cases.

### Check-before-add workflow

`skills/offing/evals/check-before-add.json` measures the add-a-dependency moment: 54 prompts, 27 expected checks and 27 that should not trigger one, split evenly across the three discovery lanes. Positives add or choose a dependency in npm, PyPI, and GitHub Actions terms (`npm install request-promise`, `Add actions/checkout@v4 to the CI workflow`, `Which package should I use for date handling?`). Negatives are removals, installs of what the lockfile already declares, routine upgrades, `dependency injection`, tests, documentation, refactors, and repository lifecycle prompts that belong to `offing`.

`npm run eval:skill-triggers` reports recall and false-trigger rate for it under `dependencyGuard` (workflow `check-before-add`), overall and by lane, with the same gates (at least 40 cases, recall of 90% or more, false-trigger rate under 5%). It also fails when one workflow's positive prompts falsely trigger another workflow's classifier (`separation` in the JSON output).

Current published baseline:

| Lane | Cases | Recall | False-trigger rate |
| --- | ---: | ---: | ---: |
| All | 54 | 100% | 0% |
| Agent Skills | 18 | 100% | 0% |
| Codex | 18 | 100% | 0% |
| Claude | 18 | 100% | 0% |

### Upgrade runtime or Action workflow

Issue #1598 asked whether to add a further Skill for runtime upgrades and GitHub Actions upgrades. The decision corpus is the 24 positive prompts in `skills/offing/evals/upgrade-runtime-action.json` (12 runtime, 12 Actions; natural phrasing and lifecycle-worded asks, split across the three discovery lanes). Measuring the scan-and-migrate description alone on those prompts:

| Measurement | Cases | Covered by scan-and-migrate | Rate | Threshold | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| Runtime and GitHub Actions upgrade job | 24 | 12 | 50% | 80% | Added an upgrade workflow |

Misses were everyday upgrade asks without lifecycle jargon (`Upgrade our Node.js runtime to the current LTS.`, `Bump actions/checkout and actions/setup-node.`, and ten peers). Lifecycle-worded upgrades still hit the scan description; the upgrade workflow names the upgrade moment so those misses are covered.

The same JSON file is the workflow's own trigger corpus: 42 prompts, 24 expected triggers and 18 non-triggers (additions, whole-repo scans, routine package bumps, security, docs, and verification). `npm run eval:skill-triggers` reports it under `upgradeRuntimeAction` with the same gates (at least 40 cases, recall of 90% or more, false-trigger rate under 5%) and fails when its positives falsely trigger the check-before-add classifier or the reverse. Because the three workflows now share one Skill, the proxies remain per-workflow concept checks; there is no single-description union metric.

Current published baseline:

| Lane | Cases | Recall | False-trigger rate |
| --- | ---: | ---: | ---: |
| All | 42 | 100% | 0% |
| Agent Skills | 14 | 100% | 0% |
| Codex | 14 | 100% | 0% |
| Claude | 14 | 100% | 0% |

CI also validates the portable frontmatter, small instruction surface, vendor neutrality, complete tool mapping, and safety invariants.

Independent forward tests exercise three different agent situations:

| Agent situation | Observable success criterion | Result |
| --- | --- | --- |
| Skill discovery | Classify every trigger and non-trigger case through the metadata contract without reading expected answers. | Lifecycle, check-before-add, and upgrade-runtime-action corpora all pass across three lanes. |
| MCP-capable agent | Discover, explain, create context, migrate, and verify through the real stdio protocol in one session. | Passed with all five tools; checkout finding verified absent. |
| CLI-only agent | Complete the same lifecycle using only documented CLI fallbacks and a fresh final scan. | Passed; request migration changed only two packet files and ended with zero findings. |

Forward-test observations are recorded on the Week 11 GitHub issue when the phase is completed. Discovery testing narrowed an ambiguous generic migration trigger to migrations from Offing findings. CLI testing replaced the packet's `npx` rescan suggestion with the already-installed `offing` executable so verification remains offline-capable and version-consistent. MCP testing clarified that an empty usage list means there are no additional usages beyond the declaration, rather than implying that the declaration itself is not relevant.

## Limits and security assumptions

- Offing currently covers its documented GitHub Actions, Node.js, npm, and Python rules. The Skills report unsupported ecosystems instead of inventing migration advice.
- Dynamic references that detectors cannot classify remain explicit limitations.
- MCP verification needs the same server session that observed the finding. The CLI fallback uses a fresh scan and conservatively compares the rule and declaration path.
- The Skills grant no permissions. Suggested verification commands remain subject to the host's normal authorization rules.
- The bundles contain no executable skill scripts and declare no pre-approved tools.
- Installing through the skills CLI copies or links instruction files into the selected host's Skill directory; it does not install the Offing runtime itself.
- Repository analysis remains local. The selected host receives structured Offing results, which can include paths and short source excerpts, so its own privacy policy still applies.

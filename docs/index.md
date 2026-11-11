---
title: Offing
description: See what's in the offing. Fix it before it lands.
layout: home
hero:
  eyebrow: Local-first end-of-life and deprecation scanner
  title: See what's in the offing. Fix it before it lands.
  lead: Offing finds the runtimes, packages, and GitHub Actions in a repository that are already end-of-life or deprecated, shows the exact file and line, and backs every finding with an authoritative source, a replacement, and migration steps. Locally, offline, with no account.
actions:
  - label: Install
    url: INSTALL/
    primary: true
  - label: 90-second demo
    url: DEMO/
sections:
  - title: Try it
    url: INSTALL/
    description: Install, scan, and read the first findings.
    icon: "M5 4h10l4 4v12H5zM14 4v5h5M9 13h6M9 17h6"
    links:
      - title: Install
        url: INSTALL/
      - title: Five-step quickstart
        url: QUICKSTART/
      - title: 90-second demo
        url: DEMO/
      - title: CLI reference
        url: CLI/
      - title: "Playbook: manual CLI checks"
        url: playbooks/cli/
      - title: Runtime drift
        url: DRIFT/
      - title: Upgrade check
        url: UPGRADE_CHECK/
      - title: Local MCP server
        url: MCP/
      - title: Environment doctor and compatibility
        url: COMPATIBILITY/
  - title: Set up CI
    url: GITHUB_ACTION/
    description: Pull request comments, SARIF, gates, and hooks.
    icon: "M4 12a8 8 0 1 0 3-6.2M4 4v4h4"
    links:
      - title: GitHub Action
        url: GITHUB_ACTION/
      - title: "Playbook: GitHub Actions"
        url: playbooks/github/
      - title: GitLab CI/CD component
        url: GITLAB/
      - title: "Playbook: GitLab pipelines"
        url: playbooks/gitlab/
      - title: Organization rollout
        url: ORG_ROLLOUT/
      - title: Hooks
        url: HOOKS/
      - title: Privacy
        url: PRIVACY/
  - title: Use with agents
    url: AGENT_SKILLS/
    description: The Agent Skill, MCP server, plugins, and migration packets.
    icon: "M12 3v3M12 18v3M3 12h3M18 12h3M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2"
    links:
      - title: Agent Skill
        url: AGENT_SKILLS/
      - title: "Playbook: agent-driven migrations"
        url: playbooks/agent/
      - title: Migration packets
        url: MIGRATION_PACKETS/
      - title: Migration plans
        url: PLAN/
      - title: Capability manifest
        url: CAPABILITIES/
      - title: Claude plugin
        url: CLAUDE_PLUGIN/
      - title: Codex plugin
        url: CODEX_PLUGIN/
      - title: Codex and Claude plugin packaging
        url: PLUGIN_PACKAGING/
      - title: Cross-host plugin evaluation and security boundaries
        url: PLUGIN_EVALS/
  - title: Reference
    url: RULES/
    description: Rules, data, detectors, trust, and project records.
    icon: "M4 5h7a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4zM20 5h-6a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h7z"
    links:
      - title: Lifecycle rules
        url: RULES/
      - title: Lifecycle data
        url: DATA/
      - title: Detector reference
        url: detectors/
      - title: Detector SDK
        url: DETECTORS/
      - title: Lifecycle importers
        url: IMPORTERS/
      - title: Maintainer CLE declarations
        url: MAINTAINERS/
      - title: Architecture and trust boundaries
        url: ARCHITECTURE/
      - title: Threat model
        url: THREAT_MODEL/
      - title: Validation results
        url: VALIDATION/
      - title: Benchmarks
        url: BENCHMARKS/
      - title: State of EOL
        url: state-of-eol/
      - title: Offing compared with Renovate, Dependabot, and endoflife.date
        url: compare/
      - title: Decision records
        url: decisions/
      - title: Roadmap
        url: ROADMAP/
      - title: Post-launch notes and next roadmap
        url: NEXT/
      - title: Changelog
        url: CHANGELOG/
      - title: Start contributing
        url: CONTRIBUTE/
      - title: Codex plugin submission
        url: CODEX_SUBMISSION/
      - title: Persian (فارسی)
        url: fa/
---

The rules behind every finding are in [Lifecycle rules](RULES.md).

Read this in: **English** · [فارسی](i18n/fa/README.md).

```bash
npx @velella/offing scan .
```

For coding agents, install the Agent Skill with one command. It teaches your agent to find, explain, and migrate these findings, and it is listed on [skills.sh](https://skills.sh/velella-sh/offing/offing):

```bash
npx skills add velella-sh/offing
```

Node.js 22 or newer. Start with [Install](INSTALL.md) (npm, Action, MCP, plugins, Docker, Homebrew), then the [90-second demo](DEMO.md) on a deliberately outdated project:

```text
Found 5 lifecycle risks. The most urgent:
  HIGH Unsupported actions/checkout runtime (.github/workflows/ci.yml:9)
  MEDIUM Node.js 18 is end-of-life (package.json:5)
  MEDIUM Node.js 19 is end-of-life (package.json:5)
  …and 2 more below.
```


[Source code](https://github.com/velella-sh/offing) · [Report an issue](https://github.com/velella-sh/offing/issues) · [npm package](https://www.npmjs.com/package/@velella/offing)

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Offing",
  "alternateName": "@velella/offing",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "Node.js 22 or newer",
  "description": "Local-first deprecation intelligence for software repositories. Finds end-of-life and deprecated runtimes, packages, and GitHub Actions at exact file locations, with sources and migration context.",
  "url": "https://velella.sh/offing/",
  "downloadUrl": "https://www.npmjs.com/package/@velella/offing",
  "installUrl": "https://www.npmjs.com/package/@velella/offing",
  "softwareHelp": "https://velella.sh/offing/QUICKSTART/",
  "license": "https://github.com/velella-sh/offing/blob/main/LICENSE",
  "sameAs": [
    "https://github.com/velella-sh/offing",
    "https://www.npmjs.com/package/@velella/offing"
  ],
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Offing",
    "url": "https://velella.sh/offing/"
  }
}
</script>

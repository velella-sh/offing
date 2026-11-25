---
title: Offing
description: See what's in the offing. Fix it before it lands.
layout: home
home:
  style: showpiece
hero:
  title: See what's in the offing. Fix it before it lands.
  lead: Offing finds the end-of-life and deprecated runtimes, packages, and GitHub Actions in a repository, shows the exact file and line, and backs every finding with a source, a replacement, and migration steps. Locally, offline, with no account.
actions:
  - label: Install and scan
    url: INSTALL/
    primary: true
features:
  - title: Get started
    description: Install Offing, scan a repository, and read your first findings.
    icon: terminal
    url: INSTALL/
  - title: Run in CI
    description: Pull request comments, SARIF, gates, and hooks for GitHub and GitLab.
    icon: github
    url: GITHUB_ACTION/
  - title: Use with agents
    description: Guardrails for AI coding agents through the Agent Skill, MCP, and plugins.
    icon: tip
    url: AGENT_SKILLS/
---

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

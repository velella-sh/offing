---
title: Launch kit
---

# Launch kit

For setup and support, use the [forecast guide](https://velella.sh/offing/launch/forecast-in-30-seconds/),
[guard guide](https://velella.sh/offing/launch/guard-in-one-command/), [coding agent guides](https://velella.sh/offing/guides/),
[FAQ](https://velella.sh/offing/launch/FAQ/), [Offing and Ebb overview](https://velella.sh/offing/launch/offing-and-ebb/), and
[troubleshooting guide](https://velella.sh/offing/launch/TROUBLESHOOTING/).

Use one pinned Fleet capture to [forecast and plan across repositories](every-repository-at-once.md).
Follow a [recorded Autopilot upgrade](https://velella.sh/offing/launch/let-autopilot-do-the-upgrade/) or walk through
[signing and gating a release](https://velella.sh/offing/launch/prove-what-you-ship/).

The [State of EOL 2027 outreach drafts](https://velella.sh/offing/launch/state-of-eol-2027/) cover the dated study and its interactive gallery.

Ready-to-post drafts for the Offing launch. Every claim in these drafts is
backed by a file in this repository; the [fact check](#fact-check) maps each
claim to its source. Adjust the first-person opening, confirm the release tag,
and read the channel's rules before posting.

| Draft | Channel | What it is for |
| --- | --- | --- |
| [show-hn.md](https://velella.sh/offing/launch/show-hn/) | Hacker News (Show HN) | Submission title, plain-text body, and a first comment for the author |
| [reddit-devops.md](https://velella.sh/offing/launch/reddit-devops/) | r/devops | Text post aimed at platform and DevOps teams, with CI setup and limits |
| [newsletters.md](https://velella.sh/offing/launch/newsletters/) | Newsletters | Subject lines and 50, 100, and 200-word blurbs for editors |
| [social.md](https://velella.sh/offing/launch/social/) | X, Bluesky, Mastodon, LinkedIn | Short posts, a thread, and alt text |
| [screenshots.md](https://velella.sh/offing/launch/screenshots/) | Any channel | The existing screenshots, what each shows, and where to use it |

## Before you post

- Post one channel at a time and stay to answer replies. Cross-posting the same
  text everywhere on the same day reads as a campaign.
- Personalize the first-person opening in Show HN, r/devops, and LinkedIn. The
  drafts are written in the maintainer's voice.
- Use the current release or install command from the repository. Confirm any
  tag printed in a draft, including `v0.7.1` in the r/devops snippet, before
  posting.
- Keep the claims as written. Do not add stars, download counts, user counts, or
  "fastest" or "best" claims. The project publishes adoption numbers only from
  reproducible public sources ([ADOPTION.md](https://velella.sh/offing/ADOPTION/)).
- Do not imply hosted analysis, automatic code changes, complete ecosystem
  coverage, or guaranteed migration safety. Those are explicitly out of scope in
  the [distribution brand checklist](https://velella.sh/offing/DISTRIBUTION_BRAND/).
- When a channel needs an image, upload the file listed in
  [screenshots.md](https://velella.sh/offing/launch/screenshots/). Do not invent a screenshot or edit a finding
  count into one.
- Disclose that you maintain the project where the channel requires it, and
  follow the channel's self-promotion rules.
- These pages publish with the documentation site. Keep private contacts,
  embargo dates, and unreleased claims out of them.

## Fact check

| Claim used in the drafts | Source in this repository |
| --- | --- |
| Scans run locally, make no network requests, and need no account | [PRIVACY.md](https://velella.sh/offing/PRIVACY/), [README.md](https://github.com/velella-sh/offing/blob/main/README.md) |
| Findings include severity, exact file and line, replacement, evidence, and migration context | [README.md](https://github.com/velella-sh/offing/blob/main/README.md), [QUICKSTART.md](https://velella.sh/offing/QUICKSTART/), [MIGRATION_PACKETS.md](https://velella.sh/offing/MIGRATION_PACKETS/) |
| Every lifecycle claim cites an authoritative, versioned source; rules are reviewed data | [AGENTS.md](https://github.com/velella-sh/offing/blob/main/AGENTS.md), [RULES.md](https://velella.sh/offing/RULES/), [CONTRIBUTING.md](https://github.com/velella-sh/offing/blob/main/CONTRIBUTING.md) |
| Detectors parse repository files and never execute repository code | [AGENTS.md](https://github.com/velella-sh/offing/blob/main/AGENTS.md), [PRIVACY.md](https://velella.sh/offing/PRIVACY/) |
| A baseline accepts known findings with an owner, reason, and expiry; CI gates on severity | [GITHUB_ACTION.md](https://velella.sh/offing/GITHUB_ACTION/) |
| The GitHub Action writes annotations, a job summary, an optional PR comment, and optional SARIF | [GITHUB_ACTION.md](https://velella.sh/offing/GITHUB_ACTION/) |
| The GitLab CI/CD component writes a JSON report and a Code Quality report | [GITLAB.md](https://velella.sh/offing/GITLAB/) |
| The MCP tools cover scan, list, explain, context, verify, and check | [MCP.md](https://velella.sh/offing/MCP/) |
| Ecosystem coverage and maturity levels | [COMPATIBILITY.md](https://velella.sh/offing/COMPATIBILITY/) |
| A package with no rule reports `no-data`, which is not a claim of safety | [README.md](https://github.com/velella-sh/offing/blob/main/README.md), [QUICKSTART.md](https://velella.sh/offing/QUICKSTART/) |
| Corpus results, including false positives and false negatives | [VALIDATION.md](https://velella.sh/offing/VALIDATION/) |
| Scope limits and approved brand language | [DISTRIBUTION_BRAND.md](https://velella.sh/offing/DISTRIBUTION_BRAND/), [PRODUCT.md](https://velella.sh/offing/PRODUCT/) |

## Assets

The forecast and guard guides use stills from the 0.1.1 recordings. The other launch captures are in
[`docs/assets/screenshots/`](https://github.com/velella-sh/offing/tree/main/docs/assets/screenshots).
The [screenshot guide](https://velella.sh/offing/launch/screenshots/) records the source and purpose of each capture.

## After the launch

Keep questions and corrections in the issue tracker or Discussions, and turn
repeated questions into documentation or detector work. Do not promise a date
for a detector or a rule that has no reviewed source.

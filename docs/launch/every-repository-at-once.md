---
title: Every repository at once
description: Use one pinned Fleet capture to see scan coverage, forecast by owner, and plan a migration.
layout: guide
---

# Every repository at once

Start with the repository commits you actually scanned. Fleet saves the
commit and scan status for each repository. The same file can show which
owners have upcoming deadlines and which repositories a migration should
include.

The examples use a packed Offing source candidate with Fleet and Campaign
support. The public 0.1.1 package predates these commands. Check the
[published CLI releases](https://github.com/velella-sh/offing/releases/latest)
for availability.

## Capture a scope once

For your own authorized GitHub organization, save one capture with the
planning inputs. Replace `example-org` with the organization you intend to
scan. Offing resolves each selected default branch to a commit before
reading its files.

```sh
offing fleet example-org --json --campaign-input --as-of 2026-11-27 > fleet.json
```

The capture includes repository-relative locations and CODEOWNERS matches.
Keep the file with your private operations data. See the [Fleet guide](https://velella.sh/offing/FLEET/)
for scope filters, GitLab groups and credential setup.

The [recorded fixture](https://github.com/velella-sh/offing/tree/48274e1d97a9fbcbdf1093d83847174a7a751cf1/tests/fixtures/campaign-20)
combines 20 pinned GitHub and GitLab test repositories. From an Offing source
checkout, use that capture to follow the rest of the example offline.

```sh
fleet=tests/fixtures/campaign-20/fleet.json
campaign=tests/fixtures/campaign-20/campaign.json
jq -r '.repositoryStatus[] | [.name, .commit, .status] | @tsv' "$fleet"
```

Every row has a distinct commit and a recorded scan. In your own report, a
failed or skipped scan is a coverage gap. Check those rows before using an
aggregate count.

## Read the forecast by owner

```sh
offing forecast --fleet "$fleet" --by owner
offing forecast --fleet "$fleet" --by owner --as-of 2025-03-01
```

The November 27, 2026 capture shows empty future buckets because the
recorded Node.js 18 deadline, April 30, 2025, had already passed. Use the
second command to place the same recorded deadline in a historical
three-month window. It assigns six findings to `@fixture/platform` and 14
to `@fixture/runtime`. This changes the forecast window over the saved
evidence. See the [Fleet forecast guide](https://velella.sh/offing/FLEET_FORECAST/) for how ownership,
coverage and date buckets work.

## Plan the migration

```sh
offing campaign plan "$campaign" --fleet "$fleet" --json > campaign-state.json
offing campaign status campaign-state.json
```

The campaign uses the capture date in its configuration and selects the
recorded Node.js 18 end-of-life rule. It places the same 20 commits in four
batches of five for a migration to a Node.js 22 minimum. The saved plan
starts with queued repositories. See the [campaign walkthrough](https://velella.sh/offing/CAMPAIGNS/#replay-the-recorded-nodejs-18-to-22-campaign)
for the verified replay and the [Campaign Board demo](https://velella.sh/offing/campaigns/demo/) for
the recorded outcomes.

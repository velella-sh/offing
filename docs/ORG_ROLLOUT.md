---
title: "Organization rollout"
description: "Take an unconfigured organization to a weekly lifecycle report for every repository, step by step."
---

# Organization rollout

This guide takes one person from an unconfigured organization to a weekly lifecycle report for every repository in it. It is written to be followed in order:

1. Create a read-only token.
2. Add the organization-scan workflow.
3. Accept existing findings with a baseline.
4. Read the reports the workflow leaves behind.
5. Send the recurring digest to Slack or Teams.
6. Offer the per-repository starter from the organization's `.github` repository.
7. Open adoption pull requests at scale (optional).

The reusable workflow builds the CLI from the explicit Offing commit you supply.
One fleet job discovers the organization repositories, reads pinned detector
inputs, scans them offline, and optionally posts a digest. See
[Fleet scans](https://velella.sh/offing/FLEET/) for the local equivalent.

## Before you start

You need:

- An organization owner to approve a fine-grained token, or a repository admin for the caller repository to add its secrets. The same person often fills both roles.
- One repository in the organization to host the caller workflow. A small operations or `.github` repository is a good home.
- GitHub Actions enabled in that repository.
- Optional: admin access to the Slack workspace or Teams channel that should receive the digest.
- Optional, for the local baseline and rollup commands: Node.js 22 or newer.

The caller repository is scanned like every other repository in the organization. It is not special.

## 1. Create a read-only organization token

The workflow needs a token that can list the organization's repositories and read each repository's contents. It needs read access only. The fleet transport uses the token before the scanner reads local inputs.

### Fine-grained token (recommended)

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):

1. Set **Resource owner** to the organization.
2. Set **Repository access** to **All repositories**. A token scoped to selected repositories cannot list the whole organization.
3. Under **Repository permissions**, set **Contents** to **Read-only** and leave **Metadata** at its mandatory **Read-only** value.
4. Set an expiration you are willing to rotate. The workflow fails when the token expires, so put the rotation date on a calendar.
5. Create the token, approve it if the organization requires approval, and copy the value once.

### Classic token

If your organization still uses classic tokens, create one with:

| Repository visibility | Scopes |
| --- | --- |
| Private repositories included | `repo`, `read:org` |
| Public repositories only | `public_repo`, `read:org` |

`read:org` lets the token list the organization. `repo` (or `public_repo`) lets it read repository contents for the checkout.

### Store and verify it

Store the token as an Actions secret in the caller repository. `gh secret set` prompts for the value, so the token does not land in shell history:

```bash
gh secret set OFFING_ORG_TOKEN --repo your-org/your-ops-repo
```

Before relying on it, check that the token can see the repositories you expect. This prints the number of active, non-archived repositories:

```bash
GH_TOKEN=github_pat_your_token \
  gh api --paginate "/orgs/your-org/repos?per_page=100" \
  --jq '[.[] | select(.archived == false and .disabled == false)] | length'
```

A `404` usually means the token cannot see the organization; a `403` usually means the organization has not approved the token or it lacks a required scope.

If you omit the `github-token` secret, the workflow falls back to the caller's `GITHUB_TOKEN`. That works only when the caller's token can already read every repository, which is uncommon for an organization-wide list. Prefer the dedicated token.

## 2. Add the caller workflow

Add one workflow to the caller repository. It calls [`.github/workflows/org-scan.yml`](../.github/workflows/org-scan.yml), which runs `offing fleet` in one job. Use the same full commit SHA for the workflow ref and the
`offing-ref` input. The job installs dependencies from the pinned lockfile.

Create `.github/workflows/offing-org-scan.yml`:

```yaml
name: Offing organization scan

on:
  schedule:
    - cron: "0 4 * * 1"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  org-scan:
    uses: velella-sh/offing/.github/workflows/org-scan.yml@<full-workflow-commit-sha>
    with:
      offing-ref: <full-workflow-commit-sha>
      organization: your-org
      fail-on-severity: high
      max-jobs: 10
    secrets:
      github-token: ${{ secrets.OFFING_ORG_TOKEN }}
      slack-webhook-url: ${{ secrets.OFFING_SLACK_WEBHOOK }}   # optional
      teams-webhook-url: ${{ secrets.OFFING_TEAMS_WEBHOOK }}   # optional
```

Commit it, then run it once by hand:

```bash
gh workflow run offing-org-scan.yml --repo your-org/your-ops-repo
gh run list --repo your-org/your-ops-repo --workflow offing-org-scan.yml --limit 1
gh run watch <run-id> --repo your-org/your-ops-repo
```

The fleet job writes per-repository progress and a final digest, uploads
`offing-fleet`, then applies the severity gate. Scan failures appear in the
report alongside successful repositories.

| Input | Default | Meaning |
| --- | --- | --- |
| `offing-ref` | Current commit for in-repository runs | Full Offing workflow commit SHA, required from another repository. |
| `organization` | Caller repository owner | GitHub organization slug. |
| `fail-on-severity` | `high` | Minimum severity that fails the final gate or `none`. |
| `max-jobs` | `10` | Bounded repository concurrency, from 1 to 16. |
| `forecast-digests` | `false` | Generate `offing-owner-digests` with a Markdown file for each owner. The artifact contains repository paths and owner names. Access follows the workflow run permissions. |

Existing Slack and Teams webhooks receive the aggregate digest. Use the
[fleet forecast guide](https://velella.sh/offing/FLEET_FORECAST/) to route
owner files to the appropriate recipients in a caller-managed workflow.

## 3. Accept existing findings with a baseline

A baseline records findings you have reviewed and accepted. It is usually a file committed in each repository. Findings in the baseline are suppressed; findings that are not in it are reported and gated normally.

Run this in the repository whose findings you are accepting:

```bash
npx @velella/offing scan . --fail-on none
npx @velella/offing baseline . --output .offing-baseline.json
```

The second command writes one entry per current finding and keeps the file's history when it already exists, so running it again updates the file instead of starting over:

```text
Wrote 5 findings to /path/to/repository/.offing-baseline.json
No earlier baseline to compare with.
```

Review the file, then commit it:

```bash
git add .offing-baseline.json
git commit -m "chore: accept current Offing findings"
```

A scan that uses the baseline now hides exactly those findings:

```bash
npx @velella/offing scan . --baseline .offing-baseline.json --fail-on high
```

```text
Findings: 0
...
Baseline: 5 findings suppressed, 0 expiring within 14 days, 0 expired.
```

### Add an owner, a reason, and an expiry

Every entry can carry optional context. These fields never change what is suppressed, but they make the acceptance reviewable and let it expire:

```json
{
  "fingerprint": "6ca0234cda96c4bf931e7686f5a74bff85d0063cb143d25ec64136c9102343d3",
  "ruleId": "nodejs.runtime.eol-18",
  "path": "package.json",
  "owner": "platform-team",
  "reason": "Upgrade tracked in PLAT-12",
  "created": "2026-10-29",
  "expires": "2027-01-31"
}
```

`owner` and `reason` are non-empty text up to 500 characters. `created` and `expires` are `YYYY-MM-DD` calendar dates, and `expires` cannot be before `created`. Expired suppressions stop hiding their finding; a scan also warns 14 days before an expiry unless you change the window:

```bash
npx @velella/offing scan . --baseline .offing-baseline.json --baseline-warn-days 30
```

`--on-expired resurface` (the default) reports the finding again after its expiry day. `--on-expired fail` reports it and also fails the scan. See the [baseline format](GITHUB_ACTION.md#pull-request-workflow) for the full field reference.

### Wire the baseline into the per-repository workflow

The baseline only takes effect where a workflow passes it to the Action or the reusable workflow. Prefer one `uses:` line that calls the reusable workflow:

```yaml
jobs:
  lifecycle:
    uses: velella-sh/offing/.github/workflows/offing-reusable.yml@main
    with:
      baseline: .offing-baseline.json
      fail-on-severity: high
```

Or pass the same inputs on the Action step directly:

```yaml
- uses: velella-sh/offing@v0.1.1
  with:
    baseline: .offing-baseline.json
    fail-on-severity: high
```

The organization-wide scan workflow (`org-scan.yml`) does not pass a `baseline` input: it scans each repository with the Action's defaults and reports every finding. Use it with `fail-on-severity: none` as the inventory and digest, and use the per-repository workflow above for the pull-request gate. This is also the workflow created by the adoption pull requests in [step 7](#7-open-adoption-pull-requests-at-scale); add the `baseline` line to that file when you accept its first report.

A shared baseline can be combined with the repository's own on the command line:

```bash
npx @velella/offing scan . \
  --baseline ../org-config/offing-baseline.json \
  --baseline .offing-baseline.json
```

`--baseline` is repeatable on the CLI. The Action input takes one path, so keep the repository's own file as the one the workflow reads and merge shared entries into it, or check out the shared file in the workflow and point `baseline` at that path.

## 4. Read the report artifacts

Download the run's `offing-fleet` artifact. It contains a single fleet
report with per-repository branch, commit, status and failure reason.

```sh
gh run download <run-id> --repo your-org/your-ops-repo --name offing-fleet --dir org-reports
offing rollup org-reports/fleet.json
offing rollup org-reports/fleet.json --owners owners.json --html > report.html
```

Map full repository names such as `your-org/sample-api` to teams in
`owners.json`. The same rollup command still accepts historical individual
scan reports. The [Pages template](https://github.com/velella-sh/offing/tree/main/templates/rollup)
reads the fleet artifact and publishes a self-contained report.

## 5. Set up the recurring digest

The schedule in [step 2](#2-add-the-caller-workflow) is the recurrence. This step connects it to a chat channel.

After scanning, the fleet job renders the report as rollup text for the
configured webhook. It includes partial failures and sends the digest
before enforcing the severity gate.

Enable one or both webhooks by adding the secrets and passing them from the caller:

```yaml
jobs:
  org-scan:
    uses: velella-sh/offing/.github/workflows/org-scan.yml@<full-workflow-commit-sha>
    with:
      offing-ref: <full-workflow-commit-sha>
      organization: your-org
    secrets:
      github-token: ${{ secrets.OFFING_ORG_TOKEN }}
      slack-webhook-url: ${{ secrets.OFFING_SLACK_WEBHOOK }}
      teams-webhook-url: ${{ secrets.OFFING_TEAMS_WEBHOOK }}
```

The digest reads the fleet report already present in the job.

Each webhook is called only when its corresponding secret is set.

### Set up the Slack webhook

1. Open [api.slack.com/apps](https://api.slack.com/apps) and create (or choose) an app for the channel that should receive digests.
2. Under **Features → Incoming Webhooks**, enable incoming webhooks and click **Add New Webhook to Workspace**.
3. Select the target channel and confirm. Slack shows a URL of the form `https://hooks.slack.com/services/T…/B…/…`.
4. In GitHub, open **Settings → Secrets and variables → Actions** in the repository that calls the org-scan workflow.
5. Create a secret named `OFFING_SLACK_WEBHOOK` and paste the webhook URL as its value. Treat the URL as a credential: anyone who has it can post to the channel.
6. Pass it to the workflow with `secrets: slack-webhook-url: ${{ secrets.OFFING_SLACK_WEBHOOK }}`.

### Set up the Teams webhook

Teams uses Workflow webhooks, not the legacy Incoming Webhook connector, which Microsoft is retiring. The Workflow webhook produces a URL compatible with Offing's Adaptive Card payload.

1. In the Teams channel that should receive digests, open **… → Workflows**.
2. Search for **Post to a channel when a webhook request is received** and select it.
3. Follow the setup wizard. Teams generates a URL of the form `https://prod-XX.westeurope.logic.azure.com/…`.
4. In GitHub, create a secret named `OFFING_TEAMS_WEBHOOK` and paste the URL.
5. Pass it to the workflow with `secrets: teams-webhook-url: ${{ secrets.OFFING_TEAMS_WEBHOOK }}`.

### Secrets table

| Secret | Required | Meaning |
| --- | --- | --- |
| `slack-webhook-url` | No | Incoming-webhook URL. When set, a Slack digest is posted after every scan. |
| `teams-webhook-url` | No | Workflow-webhook URL. When set, a Teams digest is posted after every scan. |

Both secrets are optional and independent. You can enable Slack, Teams, both, or neither.

### Test the digest

Run the workflow by hand and confirm the message arrives in the channel:

```bash
gh workflow run offing-org-scan.yml --repo your-org/your-ops-repo
```

The workflow truncates the digest to Slack's 3,000-character section limit, adding a `…truncated` marker. Keep the channel to the summary and use the artifacts or the [rollup page](#optional-publish-one-page) for the full list.

## 6. Offer the starter from the organization's `.github` repository

So each repository can add Offing from the Actions **New workflow** gallery instead of pasting YAML by hand, put the starter in the organization's [`.github` repository](https://docs.github.com/en/actions/sharing-automations/creating-workflow-templates-for-your-organization):

1. Create `your-org/.github` if it does not exist.
2. Copy both files from [`templates/workflows/`](../templates/workflows/) into that repository:

```text
workflow-templates/offing.yml
workflow-templates/offing.properties.json
```

3. Commit them on the default branch. The next time someone opens **Actions → New workflow** in a repository of the organization, **Offing lifecycle scan** appears in the list.

The starter grants only `contents: read` and runs on pull requests, pushes to the default branch, a weekly schedule, and manual dispatch.

```yaml
name: Offing

on:
  pull_request:
  push:
    branches: [$default-branch]
  schedule:
    - cron: "0 4 * * 1"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  lifecycle:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false
      - uses: velella-sh/offing@v0.1.1
        with:
          upload-report: "false"
```

GitHub substitutes `$default-branch` when someone creates the workflow from the gallery. To accept existing findings, set `baseline: .offing-baseline.json` under the Action step's `with` block. See [step 3](#3-accept-existing-findings-with-a-baseline).

## 7. Open adoption pull requests at scale

The organization-scan workflow covers every repository on a schedule. To put a pull-request workflow in every repository without waiting for each team to open the gallery, Offing can open the adoption pull requests for you. Offing lands best as one reviewed change per repository. The rollout tool (`tools/org-rollout.ts`) turns that into a single step: it lists the target repositories, shows exactly what it would change, and only opens pull requests when you explicitly ask for it. Nothing is ever pushed directly to a default branch, and scans stay offline: the tool's own network calls are GitHub API calls, never repository analysis.

Run it from a checkout of this repository:

```bash
npm ci
npm run org:rollout -- --org my-org                    # print the plan, change nothing
npm run org:rollout -- --org my-org --apply            # open one pull request per repository
npm run org:rollout -- --repos acme/api,acme/web       # a specific repository list instead of an org
```

`--apply` needs `GITHUB_TOKEN` or `GH_TOKEN` with write access to the target repositories. A token with read-only access can still run the dry run.

### What it does

For every target repository (non-archived, not a fork, with a default branch) it:

1. Checks whether any existing workflow under `.github/workflows/` already invokes `velella-sh/offing`. If one does, the repository is skipped, so reapplication can never stack duplicate workflows.
2. Resolves the action version to pin. Pass `--action-ref v0.1.1` for a fixed version; otherwise the tool pins the repository's latest release tag.
3. Prints the plan: each repository with `pull-request` or `skip`, the totals, and the full workflow file that would be added. **Without `--apply` this is the whole run.**
4. With `--apply`, and a token with write access, it opens one pull request per repository. The pull request creates the branch, adds `.github/workflows/offing.yml` (the workflow in [GitHub Action](GITHUB_ACTION.md)), and opens the pull request against the default branch.

The generated workflow runs the scan on pull requests, on a weekly schedule (`--schedule`, default `0 4 * * 1`), and on demand via `workflow_dispatch`. It needs no configuration: read-only permissions, no secrets, findings as annotations, and a `high` severity gate. To accept existing findings, commit the baseline from [step 3](#3-accept-existing-findings-with-a-baseline) and add the `baseline` input to the generated workflow in the same pull request:

```yaml
- uses: velella-sh/offing@v0.1.1
  with:
    baseline: .offing-baseline.json
    fail-on-severity: high
```

Without the input, the Action reports every finding even though the baseline file is committed.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--org <name>` | — | Target every qualifying repository of this organization. |
| `--repos <list>` | — | Comma-separated `owner/name` list instead of an organization. |
| `--apply` | off | Open the pull requests. Without it, only the plan is printed. |
| `--schedule <cron>` | `0 4 * * 1` | Cron expression for the weekly scan. |
| `--action-ref <ref>` | latest release | Action version to pin. |
| `--branch <name>` | `offing/lifecycle-scan` | Rollout branch name. A branch left behind by an earlier run is reused. |

### Design rules

- **Reviewed, never silent.** A rollout starts as a printed plan; opening pull requests is a deliberate `--apply`. Closing a pull request opts that repository out.
- **Idempotent in review.** Re-running the dry run after some merges only plans the repositories still missing the workflow.
- **Failures are reported, not hidden.** A repository that cannot take its pull request (no token, branch conflict) is listed at the end with its GitHub API error and the run exits nonzero; the rest still complete.

## Limits

One fleet job scans with bounded concurrency. Archived, disabled and forked repositories are skipped by default.

Artifacts are retained for 14 days. Download or roll up a run's reports before they expire if you need a longer history, or publish the [rollup page](#optional-publish-one-page) from a workflow that runs alongside the scan.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `List repositories` fails with `404` | The token cannot see the organization. Check its resource owner, repository access, and organization approval. |
| `List repositories` fails with `403` | The token is missing `contents`/`repo` or `read:org`, or the organization restricts fine-grained tokens. |
| A scan job cannot check out a repository | The token cannot read that repository's contents. Give it **All repositories**, not a selected list. |
| The digest is skipped | Neither `slack-webhook-url` nor `teams-webhook-url` was passed. |
| The digest job fails at `Download scan reports` | The caller did not grant `actions: read`. The reusable workflow cannot elevate its own permissions. |
| Committed baselines have no effect | The workflow did not pass `baseline`. Add it to the per-repository Action step. The organization scan does not pass one. |

## Privacy and permissions

| What | Where it runs | Network |
| --- | --- | --- |
| List repositories | GitHub Actions, caller repository | `GET /orgs/<org>/repos` |
| Scan one repository | GitHub Actions, checked-out repository | None. Files and bundled data only. |
| Upload reports | GitHub Actions artifacts | Normal Actions artifact storage, 14 days |
| Rollup digest | GitHub Actions, fleet job | Reads the local fleet report and posts to the configured webhook |
| `offing baseline`, `offing rollup` | Your machine or CI | None. Local files only. |

The workflow needs `contents: read`. The dedicated token is used for discovery and read-only transport. Fleet reports contain repository metadata and lifecycle counts; apply normal artifact access controls.

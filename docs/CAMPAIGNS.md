---
title: Plan a migration campaign
description: Select pinned Fleet repositories and review an offline batch plan.
---

# Plan a migration campaign

Record the pinned repository evidence for a Node.js upgrade from release line
18 to 22. Choose the same day for the recording and the campaign file.

```sh
offing fleet example-org --json --campaign-input --as-of 2026-11-27 > fleet.json
```

Save a `campaign.yml` file with the current release selector and intended
target.

```yaml
schemaVersion: offing.campaign.v1
id: node-upgrade
asOf: "2026-11-27"
select:
  release:
    product: nodejs
    line: "18"
target:
  runtime: nodejs
  version: "22"
batching:
  size: 5
  concurrency: 2
  minGapMinutes: 60
  maxFailureRate: 0.25
```

```sh
offing campaign plan campaign.yml --fleet fleet.json
offing campaign plan campaign.yml --fleet fleet.json --json > state.json
offing campaign status state.json
```

Read the same saved JSON via MCP by calling `campaign_status` with a
`state_path`. The plan lists proposed codemods and candidate checks from the
recorded commit. Review the proposals against the intended release. Planning
and status are offline and read-only. The Fleet capture is opt-in and can
contain private repository names, ownership and paths. Store it with your
other operations reports.

See the [campaign specification](spec/campaign/v1.md) for selectors, batch
order, omitted evidence and the versioned state format.


## Run an approved local batch

Record the exact finding ID from a scan of each pinned checkout. The replay
recording is an operator-reviewed edit, and the committed Offing configuration
must choose the replay driver and approve the tests. Give the runner an
explicit JSON array mapping each planned repository to its checkout, selected
finding and recording. Relative paths are resolved beside this file.

```json
[
  {
    "host": "https://github.com",
    "name": "example-org/service",
    "checkout": "./checkouts/service",
    "finding": "nodejs.runtime.eol-18:.nvmrc:1",
    "recording": "./recordings/service.json"
  }
]
```

```sh
offing campaign run state.json --inputs local.json --one-batch
offing campaign status state.json
```

The runner uses the existing [Autopilot replay and safety limits](AUTOPILOT_SAFETY.md)
in an isolated checkout at the planned commit. The selected finding and the
approved container tests determine whether a local run is verified. The
target in the campaign plan records your intent. Check the actual edited pins
in the verified checkout before proposing the change for review.

The batch limit bounds parallel runs. After each batch, the runner checks
the failure fraction and pauses the campaign if it exceeds the configured
threshold. A later batch becomes eligible after the minimum gap. A run
returns the next eligible time if that gap is still active.

```sh
offing campaign pause state.json
offing campaign retry state.json example-org/service
offing campaign retry state.json --failed
offing campaign resume state.json
offing campaign cancel state.json
```

Retry one failed repository or all failed repositories. Resume allows the
next explicit run to start pending work. Cancel ends local rollout and
preserves recorded review, merged and closed entries. The state records the
Autopilot run ID, and the corresponding private temporary directory
contains `autopilot-run.v1.json` and `final-verify-result.json`.

Keep the state file and local Autopilot records on the same machine for
recovery. If a crash leaves a state lock behind, confirm the recorded
process ID is inactive before removing the adjacent `.lock` file. A rerun
uses completed records and marks an interrupted attempt with missing
evidence as failed for review.

## Publish the verified batch

Publication requires an operator-approved file scoped to the existing
campaign and its selected repositories. Use the exact Fleet origin and
repository name. Supply the current default branch, the account's
numeric host user ID, and the name of an environment variable holding the
credential. You can approve several repositories in one file.

```json
{
  "campaign": "node-upgrade",
  "repositories": [
    {
      "host": "https://github.com",
      "name": "example-org/service",
      "baseBranch": "main",
      "actorId": 12345,
      "tokenEnv": "OFFING_CAMPAIGN_TOKEN_SERVICE"
    }
  ]
}
```

Use a dedicated GitHub user credential scoped to the selected repositories
with Contents and Pull requests write access, Checks and Commit statuses
read access, and metadata read access. GitLab.com and approved self-managed
GitLab origins, including an installation path prefix, use a dedicated
project credential with API access and permission to create a branch and merge
request. Configure protected branches to require normal human review. Export
each credential only to the process that needs it. Offing verifies the
authenticated actor before writing and isolates the named credentials from
replay and tests. GitHub App installation credentials that cannot report an
authenticated user through `/user` are currently outside this contract.

```sh
offing campaign publish state.json --hosts approval.json --one-batch
offing campaign refresh state.json --hosts approval.json
offing campaign status state.json
```

Publish uses the saved green replay and its redacted proof. The approved default branch
must still be at the saved pin. The review body includes the proof JSON and
all referenced logs as a bounded bundle. For verification, parse the fenced
JSON object, save the values as their named files in a private directory and
run `offing proof verify /path/to/offing-proof.json --repo /path/to/checkout`. The
SHA-256 shown in the body is over the compact JSON serialization of that
object with its file names in sorted order. If a run predates proof capture,
or its evidence exceeds the 56 KiB bundle or 60 KiB body limit, publication
stops for operator review.

A saved checkpoint binds the deterministic branch, verified head, proof
digest and author. Rerunning publication recovers a matching request after a
lost response. Branch creation uses an atomic absent-ref assertion, and a
conflicting pre-existing ref stops publication. Publishing processes one
approved batch with `--one-batch`; later batches respect the configured gap.
The host writer serializes content creation and respects bounded rate-limit
waits.

Refresh records host check and review signals and the campaign's observed
merged or closed state. Where optional host review information is unavailable,
the recorded review signal is `unknown`. For a full cancellation, pass the
host approval file. This closes open requests whose recorded author, branch,
head and proof still match, while preserving branches and requests already
merged or closed. Rerun cancellation with the same scope to finish after a
lost response or an interrupted write.

```sh
offing campaign cancel state.json --hosts approval.json
```

## Update an operations issue

Use a private GitHub operations repository with issues enabled. Provide a
separate operations approval file and credential limited to Issues write and
metadata read access in that repository. The issue lists aggregate counts,
recorded review links and the last state timestamp. Choose the operations
repository's membership accordingly.

```json
{
  "campaign": "node-upgrade",
  "repository": "example-org/operations",
  "actorId": 23456,
  "tokenEnv": "OFFING_CAMPAIGN_TOKEN_OPERATIONS"
}
```

```sh
offing campaign track state.json --operations operations.json
```

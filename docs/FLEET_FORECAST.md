---
title: Fleet forecast
description: See which repositories and owners have lifecycle deadlines in the next 3, 6 and 12 months.
---

# Fleet forecast

Use a GitHub organization or GitLab group to scan pinned default-branch commits
and see the next lifecycle deadlines, grouped by owner:

```sh
offing forecast --fleet my-organization
offing forecast --fleet my-organization --by repository
offing forecast --fleet my-group/subgroup --gitlab
```

Use `--gitlab-url https://gitlab.example.com` for a self-managed instance.
The host credentials and repository scope follow the same rules as
[organization scanning](https://velella.sh/offing/ORG_ROLLOUT/).

## Ownership and coverage

Offing uses each finding's exact file path. The first CODEOWNERS file on the
pinned commit supplies the rules. GitHub checks `.github/`, the root, then
`docs/`. GitLab checks the root, `docs/`, then `.gitlab/`. GitLab evaluates
matching sections independently. A path can match several owners, and each of
those owners sees the finding. The repository totals count it once.

If no rule supplies an owner, Offing checks the local `owners.json` in the
current directory or the file specified with `--owners`. Use full repository
names, for example `{"my-organization/platform":"platform-team"}`. Findings
without a match are grouped under `unowned`.

The three buckets are disjoint. A deadline on a cutoff goes into the earlier
bucket. Coverage reports the share of recorded observations that lack
lifecycle data, with `null` for groups with no observations. Repositories
without scan evidence appear separately, and cannot be counted as fixed.

## Save and replay evidence

```sh
offing fleet my-organization --json --forecast-input > fleet.json
offing forecast --fleet fleet.json --json > forecast.json
offing forecast --fleet next-fleet.json --previous forecast.json
```

Save fleet input explicitly with `--forecast-input`. The regular aggregate
fleet report omits path and ownership evidence. A saved recording works
offline and uses the captured day unless you pass `--as-of YYYY-MM-DD`.
Changing the day selects a different window over the evidence already
recorded. To scan the host at that day, pass `--as-of` when recording.
`--previous` reports new findings, dates that moved earlier or entered a
nearer bucket, and active findings absent from a complete current scan of the
same repository. Comparison uses the host, repository, rule and exact location.
JSON includes both owner and repository views and validates against the
[fleet forecast schema](https://velella.sh/offing/schemas/fleet-forecast.v1.schema.json).

## Export a card, calendars or Markdown

```sh
offing forecast --fleet fleet.json --card --theme dark > fleet-dark.svg
offing forecast --fleet fleet.json --ics team-calendars
offing forecast --fleet fleet.json --digest team-digests
```

`--card` defaults to the light theme. The card shows the number of owners and
repositories per bucket, plus the nearest deadline. `--ics` and `--digest`
take a new directory with an existing parent. The calendar files use stable
names and contain one event per dated deadline for each owner. Import the
corresponding `.ics` file in your calendar client. The Markdown files include
changes when `--previous` is present.

The organization-scan workflow can create the separate
`offing-owner-digests` artifact with `forecast-digests: true`. Use the
appropriate owner file as input to a caller-managed Slack or Teams workflow.
The normal Slack and Teams digest remains aggregate. Access to the owner
artifact follows the workflow repository's permissions. Forecast recordings
and owner files contain repository-relative paths and ownership names.

The following light card was produced from the packed example recording
by running `offing forecast --fleet examples/fleet-forecast/fleet.json --card`
from the project root.

![Fleet forecast card for two repositories with a nearest deadline of 30 April 2025](https://velella.sh/offing/assets/fleet-forecast/light.svg)

[View the dark card](https://velella.sh/offing/assets/fleet-forecast/dark.svg).

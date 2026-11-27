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

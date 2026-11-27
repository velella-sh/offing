---
title: Fleet scans
description: Scan pinned GitHub organization and GitLab group repositories with Offing.
---

# Fleet scans

`offing fleet` discovers repositories visible to your token, reads each
default branch's commit, and runs the normal scanner against that pinned
content. It resolves remote files first so the scan engine runs offline.
No collected repository code runs.

Run the pinned package once `0.1.2` is published:

```sh
npx @velella/offing@0.1.2 fleet my-org --include 'my-org/api-*' --topic production --json --jobs 4 > fleet.json
npx @velella/offing@0.1.2 fleet my-group/subgroup --gitlab --progress
npx @velella/offing@0.1.2 fleet my-group --gitlab-url https://gitlab.example.net --html > fleet.html
npx @velella/offing@0.1.2 rollup fleet.json --html > rollup.html
```

Before the release is published, install the candidate tarball to run the
same commands with its local `offing` binary. To run from the same source
as the reusable workflow, check out its exact commit, run `npm ci` and
`npm run build`, and use `node dist/src/cli.js`.

For GitHub, Offing reads `GITHUB_TOKEN`, `GH_TOKEN`, or the token from
`gh auth token` in that order. Use a token with read access to the selected
repository metadata and contents. For private GitLab projects, set
`GITLAB_TOKEN` with `read_api` and `read_repository`. GitLab.com and
self-managed HTTPS instances include subgroups. The GitHub default targets
organizations.

Archived and forked repositories are skipped by default. Pass
`--include-archived` or `--include-forks` to scan them. Disabled
repositories and repositories without a default branch are skipped. Repeat
`--include`, `--exclude`, or `--topic` to filter the fleet, or give
`--repos <file>` with one repository name per line. Patterns can match a
short name or a full repository name. A repository must match every
specified topic. The CLI defaults to four concurrent repositories and
accepts `--jobs` values from 1 to 16.

The transport uses a sparse partial clone at the pinned commit. Without Git,
it reads the host's archive and materializes only declared regular detector
inputs. Each successful scan writes a cache entry under Offing's cache
directory in `fleet-v1/`. Set `OFFING_DATA_DIR` to choose the cache root.
Restarting a run rechecks branch heads and reuses entries with the same
commit, scanner, active data and UTC date. Use `--no-cache` to scan fresh.

The report records each repository as `scanned`, `cached`, `skipped` or
`failed`. A failed repository carries a reason and the remaining scans
continue. Review these rows even when the command exits successfully.
Use `--fail-on high` to exit 1 when scanned or cached results include
high or critical findings.

Use `--policy <file|reference>` to apply the same organization policy to the
fleet. Pin remote policies first with `offing policy pull`. Each scanned
repository reports its compliance without policy paths, rule identifiers, or
exception text. Policy scans read pinned inputs again. Violations and invalid
policies produce exit status 1.
[Fleet policy guide](https://velella.sh/offing/FLEET_POLICY/)

The [fleet schema](https://velella.sh/offing/schemas/fleet.v1.schema.json)
defines the JSON format, including repository status and failure reasons.
For offline validation, install `@velella/offing@0.1.2` in the validation
project and import the schema from the same package as the CLI:

```js
import fleetSchema from "@velella/offing/schemas/fleet.v1.schema.json" with { type: "json" };
```

Text goes to standard output by default. Use `--json` for data, `--html`
for a self-contained report, or `--progress` to write status lines to
standard error while the fleet is scanning. Add `--image-lineage --json` to
trace container bases to producers in other pinned repositories. The
`imageLineage` field includes image references and file paths. This mode
reads pinned inputs again instead of using the aggregate cache.
[Container image lineage](LINEAGE.md)

The
[organization rollout guide](https://velella.sh/offing/ORG_ROLLOUT/) shows
the reusable GitHub workflow.

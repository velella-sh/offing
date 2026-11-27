---
title: Fleet scans
description: Scan pinned GitHub organization and GitLab group repositories with Offing.
---

# Fleet scans

`offing fleet` discovers repositories visible to your token, reads each
default branch's commit, and runs the normal scanner against that pinned
content. It resolves remote files first so the scan engine runs offline.
No collected repository code runs.

```sh
offing fleet my-org --json --jobs 4 > fleet.json
offing fleet my-group/subgroup --gitlab --progress
offing fleet my-group --gitlab-url https://gitlab.example.net --html > fleet.html
offing rollup fleet.json --html > rollup.html
```

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
specified topic.

The transport uses a sparse partial clone at the pinned commit. Without Git,
it reads the host's archive and materializes only declared regular detector
inputs. Each successful scan writes a cache entry under Offing's cache
directory. Restarting a run rechecks branch heads and reuses entries with
the same commit, scanner, active data and date. Use `--no-cache` to scan
fresh. Failed repositories carry a reason and do not stop the remaining
scans. Use `--fail-on high` to exit 1 when completed scans find high or
critical findings.

The [fleet schema](https://velella.sh/offing/schemas/fleet.v1.schema.json)
defines the JSON format, including repository status and failure reasons.
Text goes to standard output by default. Use `--json` for data, `--html`
for a self-contained report, or `--progress` to write status lines to
standard error while the fleet is scanning. The
[organization rollout guide](https://velella.sh/offing/ORG_ROLLOUT/) shows
the reusable GitHub workflow.

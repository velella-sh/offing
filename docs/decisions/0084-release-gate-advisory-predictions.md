# 0084 Keep release-gate predictions advisory

Status: Accepted

## Context

CycloneDX and SPDX 2.3 can carry explicitly labeled end-of-life estimates. The release gate must preserve the meaning of an announced deadline and the chosen policy for missing evidence.

## Decision

Reuse the versioned prediction shape from [0073](0073-predicted-eol-contract.md) when a labeled SBOM annotation matches the exact component and version. Report in-window predictions with `outcome: "warn"` and the optional `prediction` field on a `no-data` reason. Existing v1 readers can keep the same reason codes and continue reading the verdict. Formatted warnings preserve the distinction between prediction dates and confirmed deadlines. A confirmed date supersedes a prediction for the same component. The separate missing-evidence decision remains in force, including `--no-data fail`.

Rollback uses the same decision and renderer and accepts `--format text|json|sarif` alongside the existing `--json` flag.

---
title: Release and rollback gates
description: Check the support window for a library, service, or image before publication.
---

# Release and rollback gates

Use a build of Offing that includes `release-gate`. A blocked decision exits 1, so put the gate ahead of the build's publication step. Warnings and active exceptions appear in the report. Use `--format json` to consume its versioned decision, or `--format sarif` for code scanning.

## Library

From the library checkout, evaluate the exact Git revision you plan to tag.

```sh
offing release-gate HEAD --within-days 90
offing rollback-readiness v2.0.0 --candidate v1.9.0 --candidate v1.8.0 --within-days 90 --format sarif
```

A blocked Node.js example shows the deadline, days left, rule, and location.

```text
BLOCK . (path)
  [block] pkg:generic/nodejs at mise.toml:2: nodejs.runtime.eol-18 ends 2025-04-30 (29 days left)
```

## Service

Run against the directory you deploy. Set an explicit date when your service announces support through a calendar milestone. Use expiry-scoped exceptions in `.offing.json` to record a temporary rollout constraint.

```sh
offing release-gate ./service --support-until 2030-06-30 --no-data warn
```

For GitHub Actions, copy [the release and tag workflow](https://github.com/velella-sh/offing/blob/main/templates/workflows/offing-release-gate.yml) and pin the Action to a released commit that supports `release-gate-days`. A release event happens after its own publication. Run the gate as a required job ahead of any publication step you need to prevent.

## Container image

Export the built image's SBOM in CycloneDX, SPDX 2.3, or Syft JSON. Check it against the local Ebb registry.

```sh
offing release-gate --sbom image.cdx.json --within-days 60 --no-data fail
```

CycloneDX and SPDX 2.3 inventories can carry [explicit predicted end-of-life annotations](spec/predicted-eol/v1.md#sarif-cyclonedx-and-spdx). The gate warns about applicable estimates within the window. Confirmed dates and the chosen no-data policy still decide whether the gate blocks.

If you have a GitHub-signed lifecycle attestation, verify it against the same artifact. Prepare `trusted_root.jsonl` out of band using a trusted copy of GitHub CLI's `gh attestation trusted-root` command. The gate uses only the local bundle, artifact, and root.

```sh
offing release-gate --attestation image.sigstore.json --subject image.tar \
  --repo example/service --signer-workflow example/service/.github/workflows/build.yml \
  --trusted-root trusted_root.jsonl --within-days 60
```

See the [release gate contract](spec/release-gate/v1.md) for decisions, exit codes, and offline conformance.

---
title: Prove what you ship
description: Bind lifecycle evidence to your build, verify the signed artifact, and use it in a release gate.
layout: guide
---

# Prove what you ship

Start with the artifact you intend to publish and the SBOM from that build. A lifecycle attestation records the
artifact's SHA-256 digest, the Ebb dataset identity, and the lifecycle observations for the inventory.

The examples use a packed Offing source candidate with `attest` and `release-gate`. Check the
[published release notes](https://github.com/velella-sh/offing/releases/latest) for availability.

## Generate the statement

From the build directory, use your artifact and an SBOM in CycloneDX, SPDX 2.3, or Syft JSON.

```sh
offing attest --subject artifact.tgz --sbom bom.cdx.json --data-version bundled > lifecycle.intoto.json
offing attest check lifecycle.intoto.json --subject artifact.tgz --today 2026-03-31
```

The first command writes the unsigned statement. The second matches the subject bytes and re-evaluates the
recorded observations for the given date. To try the date math, use the [Alpine 3.18 sample SBOM](../ATTESTATION.md#generate-at-build-time).
Its deadline is April 1, 2026, so it has one day left on March 31.

## Sign the artifact in GitHub Actions

Copy the [attestation workflow template](https://github.com/velella-sh/offing/blob/main/templates/workflows/offing-attest.yml)
into the producing repository. Replace its npm packaging step with your build and pass that build's SBOM to
`offing attest`. The build job extracts the lifecycle predicate. A separate job uses GitHub's `actions/attest`
with `id-token: write` and `attestations: write` to sign the predicate for the exact artifact bytes.

Download `artifact.tgz` and `lifecycle.sigstore.json`. Obtain the expected repository, workflow ref, full
source commit and trusted root separately from the download. The commands below assume those values are set in
`repo`, `ref`, `EXPECTED_SOURCE_SHA`, and `trusted_root.jsonl`.

```sh
signer="$repo/.github/workflows/offing-attest.yml"
gh attestation verify artifact.tgz --bundle lifecycle.sigstore.json --repo "$repo" \
  --signer-workflow "$signer" --source-ref "$ref" --source-digest "$EXPECTED_SOURCE_SHA" \
  --predicate-type https://velella.sh/offing/attestation/v1/ --deny-self-hosted-runners
offing release-gate --attestation lifecycle.sigstore.json --subject artifact.tgz \
  --repo "$repo" --signer-workflow "$signer" --trusted-root trusted_root.jsonl --within-days 7
```

Place the gate before publication. A policy block exits with status 1. With the signed Alpine fixture,
adding `--today 2026-03-31` produces a block because the deadline falls within seven days. The
[release gate examples](../RELEASE_GATE.md) cover libraries, services and images.

The [independent conformance suite](../spec/lifecycle-attestation/v1.md#conformance) checks the statement contract.
The [signed package-smoke fixture](https://github.com/velella-sh/offing/actions/runs/46094393841) verified the
packed candidate with GitHub CLI and Cosign, rejected modified bytes and a wrong signer, and reproduced the
recorded dates. The [attestation reference](../ATTESTATION.md) includes the verification commands for each tool.

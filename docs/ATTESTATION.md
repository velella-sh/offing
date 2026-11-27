---
title: Artifact lifecycle attestations
description: Record a build's lifecycle evidence, sign it in CI, and re-evaluate the verified statement offline.
---

# Artifact lifecycle attestations

An [Offing lifecycle attestation](https://velella.sh/offing/attestation/v1/) binds a build's evidence to the artifact's SHA-256 digest and to an Ebb data version and digest. Use a local SBOM for the components of a tarball, binary or container image. CycloneDX, SPDX 2.3 and Syft JSON are supported.

## Generate at build time

Run from the source repository after building the artifact and generating its SBOM:

```sh
offing attest --subject artifact.tgz --sbom bom.cdx.json --data-version bundled > lifecycle.intoto.json
offing attest check lifecycle.intoto.json --subject artifact.tgz
```

Without `--sbom`, pass the repository path as the first argument. To bind to an OCI manifest digest, pass its lowercase `sha256:…` to `--subject`. The command prints an unsigned Statement v1. For an artifact-wide inventory, attach the SBOM from that same build.

## Sign in the build workflow

Copy the [GitHub Actions template](https://github.com/velella-sh/offing/blob/main/templates/workflows/offing-attest.yml) and supply an exact published Offing version with `attest` on dispatch. The sample packs an npm project. Replace its pack step and add `--sbom` for your build's own artifact and inventory. The workflow passes the `predicate` JSON to GitHub's pinned `actions/attest` step, which constructs an in-toto statement for the artifact bytes and signs it using its workflow identity. Download the `lifecycle-attested-artifact` workflow artifact.

## Authenticate and re-evaluate

For the copied template in a public repository, set `repo` to the producer's `owner/repo` and `ref` to the expected source ref. Use an explicit workflow path and ref obtained independently of the downloaded bundle. Run a current GitHub CLI and Cosign v3.1.4 or newer:

```sh
repo=example/project
ref=refs/heads/main
signer="$repo/.github/workflows/offing-attest.yml"
predicate=https://velella.sh/offing/attestation/v1/

gh attestation verify artifact.tgz \
  --bundle lifecycle.sigstore.json --repo "$repo" \
  --signer-workflow "$signer" --source-ref "$ref" \
  --predicate-type "$predicate" --deny-self-hosted-runners

cosign verify-blob-attestation artifact.tgz \
  --bundle lifecycle.sigstore.json --check-claims=true --type "$predicate" \
  --certificate-identity "https://github.com/$signer@$ref" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

For an Offing release, use `velella-sh/offing/.github/workflows/release-attest.yml` as the signer, the exact release tag under `refs/tags/` as the ref, and the downloaded tarball or binary as the subject. The release bundles its signed statement and subject digests alongside the signature. Keep the SLSA provenance checks when verifying the build itself.

After authenticating the bundle, re-evaluate the recorded deadlines offline. Positive values count days until the deadline, zero is the deadline day, and negative values count days since it. Observations without data remain unknown.

```sh
offing attest check lifecycle.sigstore.json --subject artifact.tgz
offing attest check lifecycle.sigstore.json --subject artifact.tgz --today 2026-05-15
```

To reproduce the date math with Node.js and without Offing, run the [conformance suite and reference verifier](https://velella.sh/offing/spec/lifecycle-attestation/v1/#conformance).

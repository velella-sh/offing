---
title: Verify a migration proof
description: Check a redacted migration proof against its Git range, logs, and GitHub Actions identity.
---

# Verify a migration proof

Keep `offing-proof.json` and its `offing-log-<sha256>.txt` files together. The
[proof format](spec/proof/v1.md) describes how each digest binds a log to a
recorded test or verification command. From a clone containing both commits,
check the proof with `offing proof verify offing-proof.json --repo /path/to/clone`.

## Verify the recorded evaluation

A Docker-backed Autopilot replay on a small evaluation repository replaced the
deprecated Dockerfile `MAINTAINER` instruction with its OCI label. The published
proof contains one changed path, one resolved finding, and a passing
`node tests/check.cjs` result. That test checked that the base image and
maintainer metadata survived the codemod. The suggested Docker build and
inspect commands are recorded as `not-run`. No agent turns were needed.

The example ships in `docs/spec/proof/example` in the source tree and in the
Offing package. Run the following from either directory's package root with
the proof-capable Offing CLI installed. The included Git bundle contains the
exact fixture commit objects, so Git needs no remote.

```sh
example="$PWD/docs/spec/proof/example"
git clone --branch proof-evaluation "$example/evaluation.bundle" proof-evaluation
offing proof verify "$example/offing-proof.json" --repo proof-evaluation
git -C proof-evaluation diff \
  8c0c151c7dc1a5971857456040a75fb973b3487c \
  7a9e964bebd52175e075e4ccaee1efd608e7506c -- Dockerfile
```

The package smoke workflow's `acc-proof-bundle` checks this example with both
the installed CLI and the independent checker. The workflow verifies the commit
range and redacted log bytes from the candidate npm tarball.

## Verify a GitHub Actions attestation

The package smoke workflow also signs the exact verified proof bytes and
uploads the `proof-acceptance-attested` artifact. This contains the proof and
logs, `offing-proof.sigstore.json`, and `offing-proof.attestation.json`. The
last file records the attestation URL, SHA-256 digest, signer workflow and
workflow revision, and source ref and commit. Its URL is also recorded in the
run summary. The locally recorded evaluation and the workflow signature cover
different evidence. Offing checks the Git range and logs, and GitHub CLI
checks which workflow attested to those exact proof bytes.

After downloading the attested artifact, run the following in its directory.
Set `SOURCE_REF` and `SOURCE_COMMIT` from the package smoke run you trust. For
this workflow's same-revision reusable signer, the signer digest is the source
commit.

```sh
gh attestation verify offing-proof.json \
  --bundle offing-proof.sigstore.json \
  --repo velella-sh/offing \
  --signer-workflow velella-sh/offing/.github/workflows/proof-attestation.yml \
  --signer-digest "$SOURCE_COMMIT" \
  --source-ref "$SOURCE_REF" --source-digest "$SOURCE_COMMIT" \
  --deny-self-hosted-runners
offing proof verify offing-proof.json --repo /path/to/proof-evaluation
```

For a migration in another repository, upload only the verified redacted proof
and logs from your producer job. Then call the same reusable workflow at a
pinned Offing revision with the uploaded artifact name as `proof-artifact`.
Grant that job `contents: read`, `id-token: write`, and `attestations: write`.
Verify using your producer repository and source revision, and the pinned
Offing workflow path and revision as the signer.

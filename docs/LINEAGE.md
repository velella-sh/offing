---
title: Container image lineage
description: Trace container base images and build stages to lifecycle evidence at exact source locations.
---

# Container image lineage

Run `offing lineage [path]` from a repository. It shows one chain for the final
stage of each Dockerfile, an explicitly published build target, or each
standalone Compose or devcontainer image. Each link names the image or stage
reference, the repository-relative file and line, and any reviewed lifecycle
event and deadline. The JSON contract is
[`offing.lineage.v1`](../schemas/lineage.v1.schema.json).

```sh
offing lineage .
offing lineage . --json
offing lineage . --format mermaid
```

A stage can use more than one base through `FROM` aliases and `COPY --from`.
In the [multi-stage fixture](../tests/fixtures/lineage/image.fixture), the
final stage starts from `empty` at line 6, and the copies at lines 7 and 8 lead
to the same build stage. That stage uses `${BASE}` at line 3. The global
`ARG` declarations give it the default `node:18`, which matches a dated
Node.js rule. An earlier stage unreachable from the selected target does
not appear in its chain.

```text
Dockerfile:final (Dockerfile:6)
  └─ FROM empty (Dockerfile:6) [not-applicable]
     └─ FROM scratch (Dockerfile:5) [not-applicable]
     └─ COPY 0 (Dockerfile:7) [not-applicable]
        └─ FROM ${BASE} → node:18 (Dockerfile:3) [end-of-life, 2026-04-30; base OS: no-data]
     └─ COPY build (Dockerfile:8) [not-applicable]
        ↳ FROM ${BASE} → node:18 (Dockerfile:3) (shared stage)
```

The JSON array of links is in dependency order. `parents` holds zero-based
indices of the earlier links that lead to an entry. Shared stages can have
several parents. `truncated` flags a cycle or the 128-link limit. A literal
global build argument default is conditional on building with that default.
Unresolved variables are `unknown`. `no-data` means Offing has no reviewed
rule or base OS record for the link. The pinned Ebb data currently has no
official-image variant map, so Offing leaves implied base OS information as
`no-data`. A `scratch` or stage-alias link has `not-applicable`.

A literal `docker/build-push-action` tag and Dockerfile path can link an internal
image to its declared producer. The link includes the workflow and tag line.
A literal `org.opencontainers.image.source` label corroborates the source when
present. Conflicting producers and references without a release tag, including
`latest`, are left unresolved. Dynamic expressions,
non-local contexts, build-argument overrides, and custom named build contexts
are outside this association. The association describes the checked-in
build declaration. It cannot prove that a running image was built from it.

To include definitions from other repositories in a pinned fleet, run
`offing fleet my-org --image-lineage --json`. The optional `imageLineage`
field includes repository names and paths, and producer commits. Handle
this result as repository data. [Fleet scans](FLEET.md)

## Digest pins

The [Compose fixture](../tests/fixtures/lineage/compose.yaml) has a digest-only
Node.js image at line 5. Lineage marks it `unknown` and suggests adding a
release tag next to the digest. An explicit tag in `node:18@sha256:…` is used
to look up lifecycle data for the named release line.

```sh
offing lineage . --resolve-digests --json
```

Use this option when authorizing an anonymous HTTPS lookup on public Docker
Hub or GitHub Container Registry. The request includes the image repository
name. Offing compares each tag's current manifest digest and caches each
repository's listing for the invocation. A complete lookup with exactly one
matching tag can identify a release line. Multiple matches, unreadable
registries, partial listings, and tags without reviewed lifecycle data are
reported with the corresponding `unknown` or `no-data` status. The lookup
has a 20-second budget and may return partial matches from large registries.
No image is downloaded. [Docker Hub tag listing](https://docs.docker.com/reference/api/hub/latest/operations/ListRepositoryTags/)
· [OCI registry API](https://distribution.github.io/distribution/spec/api/)

`offing scan` uses the same offline graph with the existing container detector.
Dated findings from linked stages or local producers include the source chain.
The `image_lineage` MCP tool accepts `repository_path` and returns the same
offline JSON. [Container detector](detectors/container.md)

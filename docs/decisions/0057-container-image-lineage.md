---
title: Version container image lineage
---

# 0057. Version container image lineage

`offing lineage --json` and the read-only `image_lineage` MCP tool return
`offing.lineage.v1`. Each chain represents a final image target or an image
declaration. It contains ordered source links at relative paths and one-based
lines. A link can depend on several earlier links, expressed as indices in
`parents`. The order also lets a token-capped MCP answer retain a valid prefix.

Release lifecycle events use the reviewed container and .NET rules. A link
with an ambiguous reference is `unknown`. A release line or implied base OS
without reviewed data is `no-data`. A stage alias or `scratch` is
`not-applicable`. The container detector emits the existing finding format, with
the source chain included in its evidence summary for linked images.

Local scanning and MCP stay offline. The CLI can opt into anonymous digest
lookups on known public registry endpoints with `--resolve-digests`. It
never follows redirects or sends credentials from the environment. A tag
association describes the registry at lookup time.

The optional `imageLineage` field of a fleet JSON result brings together
build declarations from repositories already fetched at their pinned commits.
This field is opt-in because image references and paths can be private. By
default fleet continues to return aggregates. Opt-in runs skip the fleet cache.

Ebb has no published official-image variant data or distro codename mapping at
the pinned version. The existing codename answers remain available from the
container rule helper, and implied bases stay `no-data`.

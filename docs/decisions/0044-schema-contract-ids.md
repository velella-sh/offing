---
title: Publish stable JSON schema identifiers
description: Resolve the packaged JSON contracts at their public addresses and keep the former identifiers usable during migration.
---

# 0044. Publish stable JSON schema identifiers

Status: accepted

Offing's CLI, MCP tools and exported reports already ship versioned JSON
schemas in the npm package. Most schema identifiers used a GitHub-domain
address that did not serve the schema. That made external resolution harder,
especially for a consumer of a schema that references a sibling file.

The canonical identifiers now match the published files under
`https://velella.sh/offing/schemas/`. Public schemas move as a set so
their relative references still resolve. Their document format versions and
validation rules stay the same. Internal corpus and benchmark formats retain
their existing identifiers.

The package records the former identifier of each moved schema in
`schemas/legacy-ids.json` for the first release of the new addresses. An
offline consumer can register the alias in its own validator. The
[stability policy](../STABILITY.md) shows how to do that with Ajv.

CI compares candidate schemas against the last public release. A change that
breaks a previously published contract needs a notice for the exact diagnostic
set and release. The gate reads these notices from the published schema set. The adoption baseline separately records the three contracts
whose schema changes were already on main when this check was introduced.
Those notices acknowledge the missing advance notice. CI rejects further
changes to those assertion paths until the new difference is reviewed.

The [standalone conformance checker](../spec/schemas/README.md) verifies the
Pages catalog, including external and JSON Pointer references, from a clean
consumer environment.

---
title: JSON contract stability
description: What can change in Offing's versioned JSON contracts and how consumers are notified before an incompatible change.
---

# JSON contract stability

Offing versions its public JSON formats independently of the package. Offing
`0.x` can produce a `v1` document. For example, a JSON scan uses
`offing.scan.v1` and the packaged [scan schema](../schemas/scan.v1.schema.json).
Use the format version to select a parser, and pin the Offing package version
when you need reproducible output.

## Changes in 0.x

New commands, detectors, formats and optional output fields can ship in 0.x.
Bug fixes and lifecycle data updates can change findings, dates, sources and
recommendations while preserving the document contract. Consumers that read a
subset of fields should ignore keys they do not use. Consumers that strictly
validate every field should use the schema shipped with the producer's version.
Human-readable output and internal formats can change as the implementation evolves.

A breaking change includes removing or renaming a public field, changing the
type or meaning of a field, or introducing a value a consumer could not
previously accept under a closed enum. A versioned format keeps its compatible
shape. When an incompatible contract is needed, Offing announces the replacement
and uses a new format version.

## One release of notice

A public contract stays available for the published Offing release that first
announces its deprecation. The immediately following release is
the earliest point at which the announced removal can take effect, subject to
the versioning rules in the [release guide](RELEASING.md). For example, if
release N first deprecates a field, it still emits that field in release N. A
consumer can use release N to migrate before upgrading to the release that
removes it.

Look for deprecations and their replacements in the
[changelog](CHANGELOG.md), the corresponding
[GitHub release notes](https://github.com/velella-sh/offing/releases), and the
documentation for the affected format. Deprecation notices describe the old
contract, the replacement, and the earliest release that can remove it.

## Schema identifiers

Resolve references using the schema set shipped in the same npm package as
Offing. Each public schema's `$id` is its location under
`https://velella.sh/offing/schemas/`. For example, scan uses
`https://velella.sh/offing/schemas/scan.v1.schema.json`.

For one release after the identifier move, the package ships
[legacy-ids.json](https://github.com/velella-sh/offing/blob/main/schemas/legacy-ids.json).
The file maps the public URLs to their previous GitHub-domain IDs. Use it when
registering the packaged schemas offline. With Ajv, pass
`ajv.addSchema(schema, legacyIds[schema.$id])` for each schema with an alias.
Ajv resolves both the old lookup key and the schema's declared `$id`, including
references to individual fields. New consumers can register the schemas by
`$id` alone. The [CLI reference](CLI.md#scan) documents the JSON scan format.

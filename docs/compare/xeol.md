---
title: Offing compared with xeol
description: Historical xeol findings and equivalent Offing commands for scanning a JSON SBOM.
layout: doc
permalink: /compare/xeol/
---

# Offing compared with xeol

xeol checks packages and product release cycles using a downloadable end-of-life database.
Offing's SBOM scan matches package URLs against the lifecycle rules bundled with the installation.
[xeol's database and supported formats](https://github.com/xeol-io/xeol/tree/v0.10.8#readme) ·
[Offing SBOM scan](../SBOM_SCAN.md)

## Measured evidence

The [five-repository historical comparison](../validation/differential-testing.md#differential-testing-against-xeol)
used xeol 0.10.8's directory scan. It records xeol finding ended Vue release cycles and treats
GitHub Actions as outside xeol's scope. The historical results cover a different input surface from
the current package-only SBOMs.

::bar-chart{from="comparison.historicalXeol" category="label" value="count" title="Historical product rows from directory scans"}

Fresh SBOM counts are unavailable as of 2026-11-28 because xeol's public database endpoint does
not resolve. The archived results are still available and carry their original scope.
[Upstream database outage](https://github.com/xeol-io/xeol/issues/607) ·
[Archived comparison rows](https://github.com/velella-sh/offing/tree/main/benchmarks/differential/reports/xeol)

## Equivalent SBOM commands

| xeol | Offing |
| --- | --- |
| `xeol sbom:./sbom.json` | `offing scan --sbom ./sbom.json` |
| `xeol -o json sbom:./sbom.json` | `offing scan --sbom ./sbom.json --json` |
| `xeol --fail-on-eol-found sbom:./sbom.json` | Use `offing scan --sbom ./sbom.json --fail-on info` to gate on any reported lifecycle finding. Rule coverage and evidence can differ. |
| `xeol <image>` | Generate an SBOM with Syft, then run `offing scan --sbom ./sbom.json`. |
| `xeol db status` | `offing data status` |

See [Coming from xeol](../SBOM_SCAN.md#coming-from-xeol) for the input formats, exit codes, database
updates, and container layer options.

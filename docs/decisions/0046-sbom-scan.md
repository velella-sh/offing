---
title: Scan SBOMs through existing report contracts
---

# 0046. Scan SBOMs through existing report contracts

**Status** Accepted

Offing uses the same offline dependency matching for repository SBOM, image
SBOM and one-package checks. The CLI, GitHub Action and MCP use the same SBOM
reader and return the existing `offing.scan.v1` report. Data provenance and the
existing severity gate remain available.

An SBOM finding's location carries the SBOM filename and an optional
`jsonPointer`. The pointer identifies the component, package or artifact with
values such as `/components/0`, `/packages/0` and `/artifacts/0`. SARIF uses
the filename as its artifact URI and the pointer as the logical location.
No line number is invented. This adds an optional field to scan and finding
schemas. Existing source locations are valid under the same contract and
schema IDs. Missing PURLs appear as unclassified references.

`offing scan --sbom <file|->`, the Action input `sbom`, and the MCP
tool `scan_sbom` are additive entry points. Each accepts local JSON and never
executes a generator or resolves a package over the network. The Action
confines the file to its scan root.

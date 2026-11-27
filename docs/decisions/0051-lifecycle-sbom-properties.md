---
title: "0051: Lifecycle metadata in SBOMs"
---

# 0051: Lifecycle metadata in SBOMs

## Context

Offing's SBOM enrichment already emits dates and source references, but the CycloneDX milestone taxonomy supplies no names for rule identity, source and replacement. SPDX 3 adds a graph annotation model. Producers still use SPDX 2.3 documents.

## Decision

Keep existing milestone names and SPDX 2.3 output. Add Offing-scoped CycloneDX properties and emit structured annotations linked to packages in compact SPDX 3.0.1 JSON-LD. Keep enrichment offline and preserve existing data. The profile checker is independent of Offing and the Ebb registry. [Lifecycle properties v1](https://velella.sh/offing/spec/lifecycle-properties/v1/)

## Consequences

A consumer can validate the output against the format schema and the versioned profile. It can recover the Ebb rule and evidence without inferring dates or replacements. The extension property names describe Offing's producer contract while taxonomy changes are tracked separately.

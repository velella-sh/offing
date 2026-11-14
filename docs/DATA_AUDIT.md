---
title: Data audit
description: Sources, freshness, disagreements, ground-truth results, and known gaps — each number linked to the committed file that holds it.
---

# Data audit

This page is the public index of Offing's data quality. Every number below is taken from a
committed file in this repository (or from the lifecycle-rule documentation that names the
policy). None is estimated. Open the linked file to inspect or reproduce the figure.

For measured tool comparisons that include where Offing loses, see the committed results under
[`benchmarks/comparison/`](../benchmarks/comparison/) and the method in
[Comparison method](COMPARISON_METHOD.md). For how accuracy is scored, see
[Validation](VALIDATION.md).

## Sources

Lifecycle rules live in the [`@velella/ebb`](https://github.com/velella-sh/ebb) data package.
Every rule must carry at least one authoritative `sources[]` entry (`title`, `https` URL, and
`accessedAt`), enforced when a registry loads — see [Lifecycle rules](RULES.md) and
[Lifecycle data](DATA.md).

| Measure | Value | File |
| --- | ---: | --- |
| Registry rules in the endoflife.date comparison pin | [752](../benchmarks/comparison/reproduce.json) | [`reproduce.json`](../benchmarks/comparison/reproduce.json) (`inputs.registryRules`) |
| Product families those rules cover | [415](../benchmarks/comparison/endoflife-date.json) | [`endoflife-date.json`](../benchmarks/comparison/endoflife-date.json) (`offing.productFamilies`) |
| Distinct rules exercised by ground-truth findings | [246](../benchmarks/comparison/endoflife-date.json) | same file (`offing.groundTruthRules`) |

The comparison pin is the reviewed snapshot used by
[`npm run comparison:reproduce`](../benchmarks/comparison/reproduce.json); a later data release
may ship more rules. Rule pages under [`docs/rules/`](rules/) cite the same sources a finding
prints.

## Freshness

Scans never check freshness and never use the network, so results stay deterministic. Freshness
is visible in two places: the age of the active data bundle, and the review window on each
registry file.

| Policy | Value | File |
| --- | ---: | --- |
| Bundle age that triggers a stale warning | [30 days](DATA.md) | [`DATA.md`](DATA.md) |
| Default rule review window (`freshness.maxReviewAgeDays`) | [365 days](RULES.md) | [`RULES.md`](RULES.md#freshness-and-sources) |
| Weekly source check (URL moved, title changed, unreachable, past review window) | [sources.yml](https://github.com/velella-sh/ebb/blob/main/.github/workflows/sources.yml) | Ebb workflow; corrections land in Ebb |

`offing data status` reports `ageDays`, `staleAfterDays`, and `stale` for the active bundle
([schema](../schemas/data-status.v1.schema.json)). A pin that is merely old is not an error; it is
flagged stale after the 30-day window above.

## Disagreements

A disagreement is published as its own row with both sides' evidence. Aggregate claims without
the row table are rejected ([Comparison method](COMPARISON_METHOD.md)).

### Date differences with endoflife.date

| Sample | Measured | Agree | Disagree | File |
| --- | ---: | ---: | ---: | --- |
| All comparable rules | [184](../benchmarks/comparison/reproduce.json) | [176](../benchmarks/comparison/reproduce.json) | [8](../benchmarks/comparison/endoflife-date.md#where-the-data-differs) | [`reproduce.json`](../benchmarks/comparison/reproduce.json) / [`endoflife-date.md`](../benchmarks/comparison/endoflife-date.md#where-the-data-differs) |
| Ground-truth rules only | [92](../benchmarks/comparison/reproduce.json) | [85](../benchmarks/comparison/reproduce.json) | [7](../benchmarks/comparison/reproduce.json) | same |

The eight date-difference rows (product, Offing date, endoflife.date date, Δ days) are in
[Where the data differs](../benchmarks/comparison/endoflife-date.md#where-the-data-differs),
backed by [`endoflife-date.json`](../benchmarks/comparison/endoflife-date.json) (`disagreements`).

### Finding-level comparison with Renovate

| Selection | Agree | Offing only | Renovate only | File |
| --- | ---: | ---: | ---: | --- |
| Blind | [1085](../benchmarks/comparison/reproduce.json) | [1095](../benchmarks/comparison/reproduce.json) | [232](../benchmarks/comparison/renovate/renovate.md) | [`reproduce.json`](../benchmarks/comparison/reproduce.json) / [`renovate.md`](../benchmarks/comparison/renovate/renovate.md) |
| Continuity set (5 repos) | [70](differential-report.md) | [8](differential-report.md) | [19](differential-report.md) | [`differential-report.md`](differential-report.md) |

Every Renovate-only and Offing-only row links to the declaration at the pinned commit. The
continuity set is also in [`differential-report.json`](differential-report.json).

## Ground truth results

Ground truth is independent of Offing's own output: migration commits, vendor lifecycle pages, or
a maintainer's written check of the cited line ([decision 0013](decisions/0013-detector-maturity.md)).

| Measure | Value | File |
| --- | ---: | --- |
| Pinned corpus repositories (comparison pin) | [1618](../benchmarks/comparison/reproduce.json) | [`reproduce.json`](../benchmarks/comparison/reproduce.json) (`inputs.corpusRepositories`) |
| Expected findings in that pin | [10482](../benchmarks/comparison/endoflife-date.json) | [`endoflife-date.json`](../benchmarks/comparison/endoflife-date.json) (`offing.groundTruthRecords`) |
| Held-out repositories | [15](../benchmarks/held-out-result.json) | [`held-out-result.json`](../benchmarks/held-out-result.json) |
| Held-out precision / recall | [0.9605](../benchmarks/held-out-result.json) / [1](../benchmarks/held-out-result.json) | same (`summary`) |
| Held-out true / false positives, false negatives | [73](../benchmarks/held-out-result.json) / [3](../benchmarks/held-out-result.json) / [0](../benchmarks/held-out-result.json) | same |
| Vendor-checked date sample (Offing and endoflife.date both match) | [11](../benchmarks/comparison/reproduce.json) / [11](../benchmarks/comparison/reproduce.json) | [`reproduce.json`](../benchmarks/comparison/reproduce.json) (`known.vendorChecked`) |

Per-detector precision and recall from the last recorded full corpus run are the generated table
in [Accuracy by detector](VALIDATION.md#accuracy-by-detector). That table is rebuilt with
`npm run build:coverage` after `npm run record:corpus-run`; do not copy its counts here.

Corpus entries live under [`benchmarks/public-repositories/`](../benchmarks/public-repositories/).
Evidence counts per detector for the snapshot used by coverage tooling are in
[`benchmarks/corpus-snapshot.json`](../benchmarks/corpus-snapshot.json).

## Known gaps

These are declared limits and measured misses, not soft goals. Each links to the file that states
it.

| Gap | Value | File |
| --- | ---: | --- |
| endoflife.date products with no Offing rule | [447](../benchmarks/comparison/endoflife-date.md#product-coverage) of [489](../benchmarks/comparison/endoflife-date.md#product-coverage) | [`endoflife-date.md`](../benchmarks/comparison/endoflife-date.md#product-coverage) |
| Renovate-only npm deprecations (blind) | [232](../benchmarks/comparison/renovate/renovate.md) | [`renovate.md`](../benchmarks/comparison/renovate/renovate.md) |
| Corpus growth target per bucket | [200](../benchmarks/corpus-targets.json) | [`corpus-targets.json`](../benchmarks/corpus-targets.json) (`target`); minima are the floor CI enforces today |
| Dependabot head-to-head on a pinned commit | not measured | [Comparison method §7](COMPARISON_METHOD.md#7-what-cannot-be-measured-stated-in-advance) |
| Runtime / API findings vs Renovate and xeol | not comparable | same section |
| Main corpus circularity (labels reviewed against the same commits) | stated | [Held-out set](validation/corpus.md#the-held-out-set) |
| Unreviewed scan-output labels (not precision evidence) | separate tree | [`benchmarks/unreviewed-repositories/`](../benchmarks/unreviewed-repositories/) / [Unreviewed expected findings](validation/corpus.md#unreviewed-expected-findings) |

Capability pages that are not measurements live under [`docs/compare/`](compare/). Losses that
are measurements are published in the result pages under
[`benchmarks/comparison/`](../benchmarks/comparison/) (for example
[Where Offing loses on product breadth](../benchmarks/comparison/endoflife-date.md#product-coverage)
and [Renovate-only rows](../benchmarks/comparison/renovate/renovate.md)).

## Corrections

When a shipped rule is wrong or missing, open the
[Data correction form](https://github.com/velella-sh/offing/issues/new?template=correction.yml).
For a software bug use the Bug report form; for a vulnerability use
[SECURITY.md](../SECURITY.md).

| Correction | First response | Resolved or explained |
| --- | --- | --- |
| Wrong date, version range, event, severity, replacement, or source of a live rule | 3 working days | 14 days |
| Rule should not exist, or a clear false positive | 3 working days | 14 days |
| Missing sourced rule (false negative) | 3 working days | 30 days |
| Claim disputed, evidence ambiguous | 3 working days | until the source settles, with the reason on the issue |

A correction changes the rule in Ebb (with fixtures and `npm run check`), not this page. The
evidence fields a report should name are documented in [Lifecycle rules](RULES.md). Accepted
fixes update the rule's `sources[].accessedAt` and `provenance.reviewedAt` / `reviewer`.

| Date | Rule | What was wrong | Source | Outcome | By |
| --- | --- | --- | --- | --- | --- |
| _No corrections recorded yet._ | | | | | |

## Related

- [Comparison method](COMPARISON_METHOD.md) — how comparisons are run and what cannot be measured
- [`benchmarks/comparison/`](../benchmarks/comparison/) — Renovate, Dependabot surface, and endoflife.date results
- [Validation](VALIDATION.md) — corpus method and accuracy table
- [Lifecycle data](DATA.md) — signing, pinning, and trust
- [Evidence policy](../CONTRIBUTING.md#evidence-policy) — what counts as a source

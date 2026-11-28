---
title: Measured comparison
description: Measured results for Renovate, declared Dependabot configurations, endoflife.date and public HeroDevs dates, including where Offing loses.
---

# Measured comparison

This page publishes the measured results of the protocol in
[Comparison method](COMPARISON_METHOD.md). Every number below is taken from a committed result under
[`benchmarks/comparison/`](../benchmarks/comparison/); none is estimated. Capability claims that are
not measurements live in [Offing compared with other tools](compare/index.md). Losses are published
with the same detail as wins.

Reproduce every table from the committed inputs (no network, no clock):

```bash
npm ci
npm run comparison:reproduce
```

The known pins and headline counts are in
[`benchmarks/comparison/reproduce.json`](../benchmarks/comparison/reproduce.json).

## Where Offing loses

These are the headlines the runs produced. Each links to the full table and every disagreement row.

::record-table{from="comparison-losses" caption="Where Offing loses" columns='[{"field":"label","label":"Gap"},{"field":"count","label":"Count","kind":"number"},{"field":"unit","label":"Unit"},{"field":"source","label":"Evidence","kind":"url"}]'}

The [endoflife.date date differences](https://github.com/velella-sh/offing/blob/main/benchmarks/comparison/endoflife-date.md#where-the-data-differs)
and [HeroDevs differences](https://github.com/velella-sh/offing/blob/main/benchmarks/comparison/herodevs/herodevs.md)
are available for review against upstream evidence.

Dependabot was **not run** against a pinned commit ([Comparison method](COMPARISON_METHOD.md),
section 7), so this page does not claim a head-to-head miss count for it. What is measured is how
much of Offing's finding surface a repository's committed `dependabot.yml` already watches; see
[Dependabot comparison](../benchmarks/comparison/dependabot/dependabot.md).

## Renovate

Pins recorded in the result: Renovate `44.164.10`; Offing `0.1.1` at `945a32e9`. A pair counts only
where both tools can speak about the same dependency in the same file. Blind and targeted
repositories are never added together.

| Selection | Repositories | Agree | Offing only | Renovate only | Inconclusive |
| --- | ---: | ---: | ---: | ---: | ---: |
| Blind | 1361 | 2807 | 1486 | **400** | 23 |
| Targeted | 5 | 70 | 36 | **19** | 0 |

Source: [`renovate.md` summary](../benchmarks/comparison/renovate/renovate.md#summary), checked by
[`reproduce.json`](../benchmarks/comparison/reproduce.json).

Every Renovate-only row on the blind set is in the deprecated-package family (400 of 400). Renovate
prints an npm deprecation notice; Offing has no rule for that package. The full row table, with
evidence links, is in the Renovate result. The smaller continuity set on five repositories is also in
the [differential report](differential-report.md) (19 Renovate-only, 8 Offing-only).

Offing-only rows are lifecycle findings Renovate did not list for that dependency (1,486 on blind).
They are not a claim that Renovate is wrong; Renovate answers a different question. Families Renovate
has no model for are counted as not comparable (3,308 Offing findings on blind), not as wins.

## Dependabot

Pins recorded in the result: Dependabot `not-run`; Offing `0.1.1` at `945a32e9`. This measures the
update surface each repository's committed `dependabot.yml` declares against Offing findings on the
same pinned checkouts. It does not measure Dependabot-reported findings.

| Selection | Repositories | Covered | Uncovered | Filtered | No entry |
| --- | ---: | ---: | ---: | ---: | ---: |
| Blind | 1361 | 399 | 5294 | 46 | 3658 |
| Targeted | 5 | 0 | 114 | 16 | 36 |

Source: [`dependabot.md` summary](../benchmarks/comparison/dependabot/dependabot.md#summary), checked
by [`reproduce.json`](../benchmarks/comparison/reproduce.json).

- **Covered** means a matching `package-ecosystem` and directory is declared, not that Dependabot
  reported a lifecycle fact.
- **Uncovered** means Offing found something the bridge maps to a Dependabot ecosystem, but no
  declared entry watches that ecosystem and directory (5,294 on blind).
- **No entry** means the bridge has no `package-ecosystem` for the finding (runtimes, retired APIs,
  and similar); those are outside Dependabot's update model, not misses.

What Dependabot does that Offing does not — opening version and security pull requests on GitHub —
is stated with sources in [Compared with Dependabot](compare/dependabot.md).

## endoflife.date

Pins recorded in the result: snapshot retrieved `2026-11-06`; Offing registry 782 rules across 416
product families. The result page records 44 products with 835 release cycles in the compared
projection, and 489 products in the full snapshot directory. Source:
[`endoflife-date.md`](../benchmarks/comparison/endoflife-date.md), checked by
[`reproduce.json`](../benchmarks/comparison/reproduce.json).

### Product coverage

| Measure | Value |
| --- | ---: |
| endoflife.date products in the snapshot | 489 |
| endoflife.date products with at least one Offing rule | 43 |
| endoflife.date products with no Offing rule | **446** |
| Offing product families mapped to an endoflife.date product | 104 |

endoflife.date is broader across products. Offing covers package-level, API, Actions, and managed
runtime families endoflife.date does not model; those families are listed as not comparable in the
full result, not counted as wins.

### Date agreement

| Sample | Measured | Agree | Disagree |
| --- | ---: | ---: | ---: |
| All comparable rules | 214 | 205 | **9** |
| Ground-truth rules only | 101 | 94 | **7** |

Each disagreement is a date difference with both sources linked in
[Where the data differs](../benchmarks/comparison/endoflife-date.md#where-the-data-differs). On the
11 ground-truth rules that carry an independently vendor-checked date, both Offing and endoflife.date
match the vendor date (11 / 11).

## SBOM comparisons

The [HeroDevs results](compare/herodevs.md) and [xeol evidence](compare/xeol.md) use the
[common-inventory method](COMPARISON_METHOD.md#11-common-inventory-comparison-with-xeol-and-herodevs).
The HeroDevs output lists outcomes per repository and package version. The xeol page links the
earlier directory measurements and records the current database outage.

## Capability pages

| Tool | What it does better (with sources) | Measured result |
| --- | --- | --- |
| Renovate | [Compared with Renovate](compare/renovate.md) | [renovate.md](../benchmarks/comparison/renovate/renovate.md) |
| Dependabot | [Compared with Dependabot](compare/dependabot.md) | [dependabot.md](../benchmarks/comparison/dependabot/dependabot.md) |
| endoflife.date | [Compared with endoflife.date](compare/endoflife-date.md) | [endoflife-date.md](../benchmarks/comparison/endoflife-date.md) |
| HeroDevs public dates | [Compared with HeroDevs](compare/herodevs.md) | [herodevs.md](../benchmarks/comparison/herodevs/herodevs.md) |
| xeol | [Compared with xeol](compare/xeol.md) | [Historical directory scan](validation/differential-testing.md#differential-testing-against-xeol) |

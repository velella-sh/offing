---
title: Measured comparison
description: Measured results of Offing against Renovate, Dependabot's declared update surface, and endoflife.date — including where Offing loses — under the published comparison method.
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

| Loss | What the other side has that Offing does not | Blind (or product) count | Full result |
| --- | --- | ---: | --- |
| Renovate-only npm deprecations | An npm deprecation notice for a package Offing has no rule for | **232** comparable pairs | [Renovate comparison](../benchmarks/comparison/renovate/renovate.md#renovate-only-251) |
| endoflife.date product breadth | A product page with no mapped Offing rule | **447** of 489 snapshot products | [endoflife.date comparison](../benchmarks/comparison/endoflife-date.md#product-coverage) |
| Date disagreements with endoflife.date | A different lifecycle date for the same release cycle | **8** of 184 measured rules | [Where the data differs](../benchmarks/comparison/endoflife-date.md#where-the-data-differs) |

Dependabot was **not run** against a pinned commit ([Comparison method](COMPARISON_METHOD.md),
section 7), so this page does not claim a head-to-head miss count for it. What is measured is how
much of Offing's finding surface a repository's committed `dependabot.yml` already watches; see
[Dependabot comparison](../benchmarks/comparison/dependabot/dependabot.md).

## Renovate

Pins recorded in the result: Renovate `44.164.10`; Offing `0.7.3` at `8dd8580a`. A pair counts only
where both tools can speak about the same dependency in the same file. Blind and targeted
repositories are never added together.

| Selection | Repositories | Agree | Offing only | Renovate only | Inconclusive |
| --- | ---: | ---: | ---: | ---: | ---: |
| Blind | 735 | 1085 | 1095 | **232** | 5 |
| Targeted | 5 | 67 | 38 | **19** | 0 |

Source: [`renovate.md` summary](../benchmarks/comparison/renovate/renovate.md#summary), checked by
[`reproduce.json`](../benchmarks/comparison/reproduce.json).

Every Renovate-only row on the blind set is in the deprecated-package family (232 of 232). Renovate
prints an npm deprecation notice; Offing has no rule for that package. The full row table, with
evidence links, is in the Renovate result. The smaller continuity set on five repositories is also in
the [differential report](differential-report.md) (19 Renovate-only, 8 Offing-only).

Offing-only rows are lifecycle findings Renovate did not list for that dependency (1,095 on blind).
They are not a claim that Renovate is wrong; Renovate answers a different question. Families Renovate
has no model for are counted as not comparable (1,935 Offing findings on blind), not as wins.

## Dependabot

Pins recorded in the result: Dependabot `not-run`; Offing `0.7.3` at `7cdd0e5f`. This measures the
update surface each repository's committed `dependabot.yml` declares against Offing findings on the
same pinned checkouts. It does not measure Dependabot-reported findings.

| Selection | Repositories | Covered | Uncovered | Filtered | No entry |
| --- | ---: | ---: | ---: | ---: | ---: |
| Blind | 991 | 265 | 3500 | 32 | 2632 |
| Targeted | 5 | 0 | 113 | 16 | 36 |

Source: [`dependabot.md` summary](../benchmarks/comparison/dependabot/dependabot.md#summary), checked
by [`reproduce.json`](../benchmarks/comparison/reproduce.json).

- **Covered** means a matching `package-ecosystem` and directory is declared, not that Dependabot
  reported a lifecycle fact.
- **Uncovered** means Offing found something the bridge maps to a Dependabot ecosystem, but no
  declared entry watches that ecosystem and directory (3,500 on blind).
- **No entry** means the bridge has no `package-ecosystem` for the finding (runtimes, retired APIs,
  and similar); those are outside Dependabot's update model, not misses.

What Dependabot does that Offing does not — opening version and security pull requests on GitHub —
is stated with sources in [Compared with Dependabot](compare/dependabot.md).

## endoflife.date

Pins recorded in the result: snapshot retrieved `2026-11-06`; Offing registry 752 rules across 415
product families. The result page records 44 products with 835 release cycles in the compared
projection, and 489 products in the full snapshot directory. Source:
[`endoflife-date.md`](../benchmarks/comparison/endoflife-date.md), checked by
[`reproduce.json`](../benchmarks/comparison/reproduce.json).

### Product coverage

| Measure | Value |
| --- | ---: |
| endoflife.date products in the snapshot | 489 |
| endoflife.date products with at least one Offing rule | 42 |
| endoflife.date products with no Offing rule | **447** |
| Offing product families mapped to an endoflife.date product | 103 |

endoflife.date is broader across products. Offing covers package-level, API, Actions, and managed
runtime families endoflife.date does not model; those families are listed as not comparable in the
full result, not counted as wins.

### Date agreement

| Sample | Measured | Agree | Disagree |
| --- | ---: | ---: | ---: |
| All comparable rules | 184 | 176 | **8** |
| Ground-truth rules only | 92 | 85 | **7** |

Each disagreement is a date difference with both sources linked in
[Where the data differs](../benchmarks/comparison/endoflife-date.md#where-the-data-differs). On the
11 ground-truth rules that carry an independently vendor-checked date, both Offing and endoflife.date
match the vendor date (11 / 11).

## Capability pages (not measurements)

| Tool | What it does better (with sources) | Measured result |
| --- | --- | --- |
| Renovate | [Compared with Renovate](compare/renovate.md) | [renovate.md](../benchmarks/comparison/renovate/renovate.md) |
| Dependabot | [Compared with Dependabot](compare/dependabot.md) | [dependabot.md](../benchmarks/comparison/dependabot/dependabot.md) |
| endoflife.date | [Compared with endoflife.date](compare/endoflife-date.md) | [endoflife-date.md](../benchmarks/comparison/endoflife-date.md) |

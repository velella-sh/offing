---
title: Offing compared with HeroDevs public dates
description: Dated upstream end-of-life claims from public HeroDevs pages, checked against Offing on pinned software bills of materials.
layout: doc
permalink: /compare/herodevs/
---

# Offing compared with HeroDevs public dates

The comparison looks for exact upstream end-of-life dates on public HeroDevs pages, then checks
those dates against Offing's lifecycle findings on the same pinned npm package versions. The sample
covers four packages across five repositories. The published rows carry the package URL, pinned
repository, provider and Offing dates, and source links.

[Measured rows and input coverage](https://github.com/velella-sh/offing/blob/main/benchmarks/comparison/herodevs/herodevs.md) ·
[Comparison method](../COMPARISON_METHOD.md#11-common-inventory-comparison-with-xeol-and-herodevs)

::bar-chart{from="comparison.herodevs" category="label" value="count" title="Results for package versions with a dated HeroDevs claim"}

A single source can cover several package versions or repositories. The sample reports a different
date for Next.js 13 and public dates for Nuxt 2 and Vuetify 2 where Offing's bundled data supplies no
equivalent date. The date difference still needs a review against the upstream support policy.

HeroDevs' hosted scan uses a wider definition of EOL that includes maintenance and vulnerability
signals. This comparison covers explicit upstream lifecycle dates in the reviewed public pages.
Service coverage and commercially extended support fall outside the sample.
[HeroDevs' description of its hosted EOL classification](https://docs.herodevs.com/eol-ds/understanding-end-of-life)

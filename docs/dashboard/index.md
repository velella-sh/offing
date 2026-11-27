---
title: "Accuracy and performance dashboard"
description: "Precision, recall, and pinned public corpus evidence by ecosystem, detector, and maturity level."
image: https://velella.sh/offing/assets/brand/accuracy-dashboard.svg
layout: doc
permalink: /dashboard/
---

# Accuracy and performance dashboard

Every number on this page comes from committed files built by [`tools/build-dashboard-data.ts`](https://github.com/velella-sh/offing/blob/main/tools/build-dashboard-data.ts) into `docs/_data/dashboard.json` and its collection tables from [`benchmarks/thresholds.json`](https://github.com/velella-sh/offing/blob/main/benchmarks/thresholds.json), [`benchmarks/corpus-targets.json`](https://github.com/velella-sh/offing/blob/main/benchmarks/corpus-targets.json), and [`benchmarks/public-repositories/`](https://github.com/velella-sh/offing/blob/main/benchmarks/public-repositories). Nothing on this page is typed by hand.

To regenerate locally for preview:

```bash
npm run accuracy           # writes docs/_data/dashboard*.json (gitignored; Pages builds them)
npm run check:dashboard    # fails if the sources would not produce a well-formed file
```

The build never reads the clock or uses the network. Its reference day is the date of the last full run, so the published data does not change with the clock. Missing numbers and unmeasured scan timings read `"not measured"`, never `0` or `1`.

## Last full run

Run age (`runAgeDays`) and stale status (`stale` when `runAgeDays > 14`) come from the data file only. (Upstream Lateen dependency: a dedicated data-driven run-age/stale-threshold badge component is tracked for Lateen; until then, `record-table` displays both fields from `dashboard-run`.)

::record-table{from="dashboard-run" caption="Last full public corpus run" columns='[{"field":"date","label":"Run date","kind":"date"},{"field":"commit","label":"Commit"},{"field":"ebbVersion","label":"Ebb"},{"field":"repositories","label":"Repositories","kind":"number"},{"field":"findings","label":"Findings","kind":"number"},{"field":"runAgeDays","label":"Run age (days)","kind":"number"},{"field":"staleStatus","label":"Freshness"},{"field":"recordedPrecision","label":"Precision","kind":"number"},{"field":"recordedRecall","label":"Recall","kind":"number"},{"field":"medianScanMs","label":"Median scan"},{"field":"p95ScanMs","label":"p95 scan"}]'}

## Corpus per ecosystem

How many pinned public repositories each ecosystem bucket holds, from [`benchmarks/public-repositories/`](https://github.com/velella-sh/offing/blob/main/benchmarks/public-repositories). **Minimum** is the committed floor CI enforces from [`benchmarks/corpus-targets.json`](https://github.com/velella-sh/offing/blob/main/benchmarks/corpus-targets.json); **Target** is the 200-repository goal in [decision 0030](../decisions/0030-corpus-selection-and-200-target.md).

::bar-chart{from="dashboard.corpus.ecosystems" category="id" value="repositories" title="Corpus repositories per ecosystem"}

::record-table{from="dashboard-ecosystems" caption="Corpus repositories per ecosystem" columns='[{"field":"id","label":"Ecosystem"},{"field":"repositories","label":"Repositories","kind":"number"},{"field":"minimum","label":"Minimum","kind":"number"},{"field":"target","label":"Target","kind":"number"}]'}

## Full corpus and held-out accuracy

The full corpus scores reviewed findings. The [held-out result](https://github.com/velella-sh/offing/blob/main/benchmarks/held-out-result.json) scores only its declared Node.js and GitHub Actions rule families on repositories selected before scanning. Compare the two with their scopes and run versions in view.

::record-table{from="dashboard-comparison" caption="Full corpus and held-out results" columns='[{"field":"label","label":"Input"},{"field":"repositories","label":"Repositories","kind":"number"},{"field":"precision","label":"Precision"},{"field":"recall","label":"Recall"},{"field":"truePositives","label":"TP","kind":"number"},{"field":"falsePositives","label":"FP","kind":"number"},{"field":"falseNegatives","label":"FN","kind":"number"},{"field":"date","label":"Run date"},{"field":"commit","label":"Offing commit"},{"field":"ebbVersion","label":"Ebb"}]'}

## Accuracy by ecosystem

Ecosystems are ordered by lowest recall, then lowest precision. Open an ecosystem to see its trend and the evidence for missing or unexpected findings. Each row's counts use the repositories covered by its archived run.

::record-table{from="dashboard-accuracy-ecosystems" caption="Accuracy by ecosystem" columns='[{"field":"id","label":"Ecosystem"},{"field":"repositories","label":"Repositories","kind":"number"},{"field":"precision","label":"Precision"},{"field":"recall","label":"Recall"},{"field":"truePositives","label":"TP","kind":"number"},{"field":"falsePositives","label":"FP","kind":"number"},{"field":"falseNegatives","label":"FN","kind":"number"},{"field":"date","label":"Run date"},{"field":"commit","label":"Offing commit"},{"field":"ebbVersion","label":"Ebb"}]'}

## Accuracy by maturity

Totals pool true positives, false positives, and false negatives before calculating precision and recall. Maturity is the configured detector level in the committed thresholds used to build this dashboard. The repository column describes the full run because several detector levels can score the same repository.

::record-table{from="dashboard-maturity" caption="Accuracy by maturity" columns='[{"field":"id","label":"Maturity"},{"field":"runRepositories","label":"Repositories","kind":"number"},{"field":"precision","label":"Precision"},{"field":"recall","label":"Recall"},{"field":"truePositives","label":"TP","kind":"number"},{"field":"falsePositives","label":"FP","kind":"number"},{"field":"falseNegatives","label":"FN","kind":"number"},{"field":"date","label":"Run date"},{"field":"commit","label":"Offing commit"},{"field":"ebbVersion","label":"Ebb"}]'}

## Results per detector

**Level** is the promise recorded in [`benchmarks/thresholds.json`](https://github.com/velella-sh/offing/blob/main/benchmarks/thresholds.json). **Earned level** is the highest level the counted corpus evidence supports under [decision 0013](../decisions/0013-detector-maturity.md). Where a level is higher than its earned level, the row says `"above the counted evidence, kept by decision 0013"`.

::record-table{from="dashboard" caption="Results per detector" columns='[{"field":"id","label":"Detector"},{"field":"level","label":"Level"},{"field":"earnedLevel","label":"Earned level"},{"field":"aboveEvidence","label":"Evidence note"},{"field":"precision","label":"Precision"},{"field":"recall","label":"Recall"},{"field":"truePositives","label":"TP"},{"field":"falsePositives","label":"FP"},{"field":"falseNegatives","label":"FN"},{"field":"repositoriesWithFindings","label":"Repos with findings","kind":"number"},{"field":"expectedFindings","label":"Expected findings","kind":"number"},{"field":"zeroFindingRepositories","label":"Zero-finding repos","kind":"number"},{"field":"date","label":"Run date"},{"field":"commit","label":"Offing commit"},{"field":"ebbVersion","label":"Ebb"},{"field":"runRepositories","label":"Run repositories","kind":"number"}]'}

## Evidence required to earn a level

The thresholds an earned level is measured against, from [decision 0013](../decisions/0013-detector-maturity.md).

::record-table{from="dashboard-minimums" caption="Evidence required per level" columns='[{"field":"id","label":"Level"},{"field":"repositoriesWithFindings","label":"Repositories with findings","kind":"number"},{"field":"expectedFindings","label":"Expected findings","kind":"number"},{"field":"zeroFindingRepositories","label":"Zero-finding repositories","kind":"number"}]'}

## Limitations

- A precision of 1.0 means no regression against this corpus. The expected findings were written by reviewing the same commits, so it does not show that the detectors generalize to unseen repositories. See [ADR 0013](../decisions/0013-detector-maturity.md) and [issue #740](https://github.com/velella-sh/offing/issues/740).
- Trends use archived verify runs. The number of pinned repositories and the Ebb version may change between runs.
- Scan time is not measured here. Median and p95 scan times are printed by the corpus harness but are not recorded in a committed file, so the dashboard does not show them.
- Evidence counts come from the corpus file as it is now, not as it was at the recorded run. The configured level is a promise recorded in `benchmarks/thresholds.json`; the earned level counts evidence only and does not check recall or blind selection, which the corpus does not record yet.
- A detector's configured level can be higher than its earned level: ADR 0013 lets the detectors that held the Supported label before the evidence rules existed keep it until the corpus grows.
- The corpus minimum is the committed floor CI enforces, not the 200-repository goal. Most buckets are below the goal, so a bucket above its minimum can still be far from 200; decision 0030 owns the goal.

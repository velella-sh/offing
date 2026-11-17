---
title: Forecast accuracy on public repositories
description: Reproduce a pinned Offing forecast run and see the results of a manual review.
---

# Forecast accuracy on public repositories

## Method

We selected 100 distinct public repositories from the existing Offing corpus, with 20 each from Node.js, Python, JVM, Go, and GitHub Actions. Within each group, we took the first four targeted and first 16 blind entries in corpus order, skipping repositories already selected. The manifest pins all commit hashes. [Repository manifest](https://github.com/velella-sh/offing/blob/main/validation/repos.json)

We ran `offing forecast <checkout> --json --as-of 2025-03-01 --months 36 --data-version bundled` on full pinned trees using Ebb 0.2.0. The fixed date and 36-month span exercise several lifecycle transitions. Some repository commits and vendor evidence postdate the reference day, so this replay measures the current rules against fixed inputs. The committed snapshots replace the local checkout path in `root` with the repository slug. [Snapshots](https://github.com/velella-sh/offing/tree/main/validation/snapshots)

## Results

| Measure | Result |
| --- | ---: |
| Repositories replayed with identical snapshots | 100 |
| Repositories with dated findings | 50 |
| Dated events affecting any repository, counted once per repository and rule | 126 |
| Finding locations across the affected events | 227 |
| Repositories reporting coverage gaps | 45 |
| Reported coverage gaps | 1,197 |

Manually reviewed four results per ecosystem, selecting a mix of declaration types and lifecycle rules. For every finding in those 20 reports, we read the declared version at the pinned location and opened the cited source. GitHub Actions runner migration findings concern whether the workflow has migrated its action reference to Node.js 24. They do not predict whether a workflow succeeds under a forced runtime upgrade.

Of 63 reviewed findings, 50 were supported and 13 were wrong. Five flagged an action version already running on Node.js 24. The other eight attached genuinely unsupported versions to the wrong date. The labels preserve the evidence for each judgment. [Finding labels](https://github.com/velella-sh/offing/blob/main/validation/labels.json) · [Ebb #626](https://github.com/velella-sh/ebb/issues/626)

A separate check matched 50 findings to the bundled Ebb deadlines, with zero differences. This checks transmission of the date from the registry to the forecast. The manual review found errors shared by the registry and the forecast.

On an Apple M5 running Node.js 22.23.1, the slowest forecast among the ten largest checkouts took 0.993 seconds. Peak resident memory for the group reached 188,563,456 bytes. Measurements cover a single forecast process per repository with warm checkouts, including CLI startup and excluding checkout time. [Running times](https://github.com/velella-sh/offing/blob/main/validation/timings.json) · [Time and memory measurements](https://github.com/velella-sh/offing/blob/main/validation/performance.json)

## Limits

The corpus contains targeted as well as blind entries, and the manual review is purposive. The results describe this run and its reviewed findings. They do not estimate population precision, recall, the accuracy of future forecasts, or the number of unreported coverage gaps. A snapshot with zero affected events can still have unsupported components or gaps in lifecycle data.

## Reproduce

In a checkout of Offing, run the following commands:

```sh
npm ci
npm run validate
node dist/validation/dates.js
node dist/validation/report.js
node dist/validation/perf.js
```

The first run fetches the pinned commits and caches full trees in `~/.cache/offing-forecast-validation`. Set `OFFING_FORECAST_CACHE` to use another dedicated directory. Subsequent runs reuse the checkouts. The performance command uses macOS or GNU `time`. See the [coverage gap breakdown](https://github.com/velella-sh/offing/blob/main/validation/no-data.md) and [false positive analysis](https://github.com/velella-sh/offing/blob/main/validation/false-positives.md).

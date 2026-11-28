---
title: State of EOL 2027
description: A pinned study of observed lifecycle risk in 1,000 popular and recently active GitHub repositories.
layout: doc
---

# State of EOL 2027

The study selected :field[cohort] public GitHub repositories by stars and recent activity on :field[asOf]. Offing attempted :field[attempted] exact revisions and scanned :field[scanned]. Fetch or scan still failed for :field[failed], :field[skipped] were skipped, and :field[unscanned] had no recorded attempt. Offing made :field[retryAttempts] exact-pin retry attempts for :field[retried] initially unsuccessful revisions and recovered :field[recovered]. Of the successful scans, :field[withGaps] included a no-data reference and :field[coverageIncomplete] had incomplete coverage metadata. [Selection and raw data](https://github.com/velella-sh/offing/tree/main/benchmarks/state-of-eol)

Collection began :field[scanStarted] and finished :field[scanFinished]. The scanner was Offing commit :field[scanner] with bundled Ebb :field[ebb]. The compressed evidence file has SHA-256 :field[rawDigest]. [Pinned cohort](https://github.com/velella-sh/offing/blob/main/benchmarks/state-of-eol/2027-cohort.json) · [Raw scan archive](https://github.com/velella-sh/offing/blob/main/benchmarks/state-of-eol/2027-raw.json.gz) · [Rebuild evidence](https://github.com/velella-sh/offing/actions/workflows/state-of-eol.yml)

## Lifecycle findings

The runtime figure counts each scanned repository once when a recorded language runtime rule shows that support ended by :field[asOf]. The median uses each repository's closest confirmed support event between :field[asOf] and :field[until], inclusive. The leading rule counts repositories with that rule in the same window, once per repository. Equal counts are ordered by rule ID. Repositories without a dated event contribute no value to the median.

::record-table{from="state-of-eol-2027-headlines" caption="Headline estimates and evidence gaps" columns='[{"field":"label","label":"Measure"},{"field":"result","label":"Observed"},{"field":"denominator","label":"Measure denominator","kind":"number"},{"field":"noData","label":"No-data repositories / cohort"},{"field":"unknown","label":"Unknown coverage / cohort"},{"field":"scannedWithoutEvent","label":"Complete scans without a dated event / cohort"}]'}

## Ecosystems and GitHub Actions runtimes

An ecosystem group contains repositories with detector coverage, findings, or unclassified references in that detector. Groups overlap. The figure and table count repositories with at least one finding within each group.

::bar-chart{from="state-of-eol-2027-ecosystems" category="id" value="affected" title="Repositories with at least one finding by detector"}

::record-table{from="state-of-eol-2027-ecosystems" caption="Repositories with findings by detector" columns='[{"field":"id","label":"Detector"},{"field":"affected","label":"With findings","kind":"number"},{"field":"denominator","label":"Observed group size","kind":"number"},{"field":"noData","label":"No-data repositories / group"},{"field":"unknown","label":"Uncertain coverage / cohort"}]'}

Action runtime counts use literal versions from `actions/setup-node` and `actions/setup-python`, including supported literal matrix lists, and the `runs.using` field in action manifests. One repository can contribute to each runtime it declares. The denominator is the set of repositories with recorded workflow or action-manifest inputs. The figures describe declarations and do not count actual runner executions or infer runtimes of remote actions.

::record-table{from="state-of-eol-2027-actions" caption="GitHub Actions runtime declarations" columns='[{"field":"runtime","label":"Runtime declaration"},{"field":"observed","label":"Repositories","kind":"number"},{"field":"denominator","label":"Action input repositories","kind":"number"},{"field":"noData","label":"No-data repositories / group"},{"field":"unknown","label":"Unknown runtime or scan / cohort"}]'}

## Runtime upgrade blockers

The static upgrade analyzers evaluated Node.js 22 and Python 3.13 on the same sparse trees. A package contributes once per repository where a lockfile analyzer and blocker graph identify it as a blocker. Project-wide `requires-python` constraints remain in the raw evidence as runtime restrictions. The table shows up to 25 ranked packages per target, with the underlying analyzer results and blocker graphs in the raw archive. A repository without applicable lockfile analysis for a target remains no-data for that ranking. A failed fetch, scan or analyzer is unknown. The study does not install application packages or run applications.

::record-table{from="state-of-eol-2027-upgrade-coverage" caption="Coverage by upgrade target" columns='[{"field":"target","label":"Target"},{"field":"denominator","label":"Repositories with applicable lockfile analyses","kind":"number"},{"field":"packages","label":"Distinct ranked packages","kind":"number"},{"field":"noData","label":"No-data repositories / cohort"},{"field":"unknown","label":"Unknown repositories / cohort"}]'}

::record-table{from="state-of-eol-2027-blockers" caption="Most frequent lockfile blockers by upgrade target" columns='[{"field":"target","label":"Target"},{"field":"packageName","label":"Package"},{"field":"affected","label":"Blocked repositories","kind":"number"},{"field":"denominator","label":"Applicable repositories","kind":"number"},{"field":"noData","label":"No-data repositories / cohort"},{"field":"unknown","label":"Unknown repositories / cohort"}]'}

## Base-image lineage

Reviewed lineage alone exposed ended support in :field[lineage] observed Dockerfiles. The file denominator includes Dockerfiles with retained lineage inputs. No-data affected :field[lineageNoData] and unknown lineage affected :field[lineageUnknown]. Lineage input was unavailable for :field[lineageUnavailable] repositories, where the number of Dockerfiles is unknown. The calculation uses literal producer links from pinned trees and reviewed base-OS mappings. It excludes `COPY --from` ancestry, and a direct ended base in the same Dockerfile takes precedence. No external image registry was queried.

## Limits and reproduction

The cohort describes popular GitHub repositories visible to search, including collections and documentation. The scan only observes recognized files and rules. This study has no published model evidence for predicted end-of-life dates. An observed finding is positive evidence. An empty scan can reflect compatible software, absent inputs, or a detector gap. The headline no-data column counts successful scans with at least one observed gap. Unknown coverage counts unavailable and incomplete scans, including scans with truncation or diagnostics. These groups can overlap, and a dated finding in an incomplete scan still contributes to the observed measure. Complete scans without a dated event have their own column for the two forward-looking measures.

Run `npm ci` then `npm run state-of-eol` to rebuild the same collections from the committed data. The cohort README gives the exact pin format and demonstrates how to collect fresh evidence separately. [Reproduction commands](https://github.com/velella-sh/offing/tree/main/benchmarks/state-of-eol)

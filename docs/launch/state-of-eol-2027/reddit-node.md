---
title: State of EOL r/node draft
---

# r/node draft

Check the [r/node rules](https://www.reddit.com/r/node/about/rules/) and confirm where maintainers can share their own work.

**Title**

What npm and pnpm lockfiles tell us about Node.js 22 upgrade blockers

**Body**

I work on Offing. In a study of 1,000 pinned public GitHub repositories, all 1,000 revisions were scanned and 242 had applicable lockfile analysis for the Node.js 22 target. We ranked blockers once per affected repository and kept the dependency paths where the graph could resolve them. The report shows missing inputs and unknowns alongside the ranking.

There was a separate lifecycle measure. The Node.js 22 end-of-life rule was the most frequent upcoming rule, seen in 207 of the 289 repositories with a dated event within a year of November 27, 2026 UTC. That denominator is the set with an upcoming dated event.

When upgrading Node.js, how do you decide which lockfile constraints warrant action before running the CI matrix? I’m interested in what evidence helps with platform-specific dependencies.

[Report and ranking method](https://velella.sh/offing/reports/state-of-eol-2027/) · [Independent audit](https://github.com/velella-sh/offing/blob/main/benchmarks/state-of-eol/2027-audit.md)

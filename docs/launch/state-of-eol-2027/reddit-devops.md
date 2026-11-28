---
title: State of EOL r/devops draft
---

# r/devops draft

Check the [r/devops rules](https://www.reddit.com/r/devops/about/rules/) and confirm where maintainers can share their own work.

**Title**

What an end-of-life scan picked up in 999 pinned GitHub repositories

**Body**

I work on Offing. We wanted to see how often a repo still refers to a runtime past end of life, so we pinned 1,000 popular and recently active public GitHub repositories and analyzed them as of November 27, 2026 UTC. Of the 1,000 successful scans, 383 had at least one observed runtime past end of life.

The deadline figure has a smaller denominator. For the 289 repositories with an observed, dated event in the next year, the median time to the nearest event was 154 days. The study also records 557 successful scans with at least one evidence gap. This sample describes public GitHub projects selected by stars and activity.

If you check for runtime retirements across several teams, which is hardest to inventory in practice among build images, CI runtimes, and application manifests?

The [report](https://velella.sh/offing/reports/state-of-eol-2027/) has the detector breakdown and the raw pins. The [audit](https://github.com/velella-sh/offing/blob/main/benchmarks/state-of-eol/2027-audit.md) covers the independent counts.

---
title: State of EOL DEV Community draft
---

# How we counted runtime end of life across pinned repositories

AI assisted with the wording of this article. The counts come from the independently audited State of EOL 2027 study. [DEV guidelines for AI-assisted articles](https://dev.to/guidelines-for-ai-assisted-articles-on-dev)

The first choice in a repository lifecycle study is what to count. We selected 1,000 public GitHub repositories by stars and recent activity, pinned their default-branch commits, and used November 27, 2026 UTC as the analysis date. Offing scanned 999 of those revisions. One pinned revision remained unavailable after retry.

We counted each successfully scanned repository once if it had at least one observed runtime past end of life. That gave 383 of 1,000. For the deadline measure, we took one nearest dated support event per repository within the following year. The median was 154 days across the 289 repositories with a qualifying date. Reporting the denominator matters because the median applies to that group.

We also kept evidence gaps visible. There were 556 successful scans with at least one unclassified reference, and five repositories with unavailable or incomplete coverage. The upgrade rankings used the subset with applicable lockfile analyzers and counted each package once per affected repository. Those groups covered 241 repositories for Node.js 22 and 84 for Python 3.13.

A reproducible check starts with the repository pins, frozen rule catalog, and per-repository observations. A second calculation joined the rules and evidence, recomputed the counts, and matched the published figures. The report provides the same inputs and the commands to rebuild its tables. [State of EOL 2027 report](https://velella.sh/offing/reports/state-of-eol-2027/) · [Audit and reproduction](https://github.com/velella-sh/offing/tree/main/benchmarks/state-of-eol)

# State of EOL 2027 independent audit

A second agent recalculated the report directly from the compressed evidence using Python and compared the results with the generated collections. The audited [archive](2027-raw.json.gz) has SHA-256 `b69cd498f9ccf2dce1797a085978b55385d74a4e5b69e98630af05a6c4e0a7d9`. The analysis date was November 27, 2026 UTC.

- Matched all 1,000 repository names and commit SHAs to the cohort. Compared the initial and retry attempt states, reasons, fetched bytes, and scan plans. The 42 retries recovered 41 repositories for a total of 999 successful scans. One exact revision remained unavailable through Fleet's anonymous Git transport.
- Joined finding identities with the frozen rule catalog. Counted distinct repositories with an ended runtime and took the median of one nearest future event per repository. Recalculated 383 of 999, a 154-day median across 289, and `nodejs.runtime.eol-22` in 207 of those 289. Counted 556 successful scans with an evidence gap, five with unavailable or incomplete coverage, and 706 complete scans without a dated event in the window.
- Recomputed every ecosystem and Action runtime row from per-repository observations. Rebuilt both package rankings from graph blocker identities and applicable analyzers. The rankings covered 241 eligible Node.js and 84 eligible Python repositories, with one unavailable repository for each target.
- Recounted 2,734 observed Dockerfiles. The frozen evidence yielded zero lineage-only findings, 1,962 Dockerfiles with no-data, and 568 with unknown lineage. Predicted dates were unavailable across the cohort.

Every published count and denominator audited against the raw records matched. [Automated rebuild and rendering check](https://github.com/velella-sh/offing/actions/workflows/state-of-eol.yml)

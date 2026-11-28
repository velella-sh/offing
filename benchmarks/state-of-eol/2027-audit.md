# State of EOL 2027 independent audit

A second agent recalculated the report directly from the compressed evidence using Python and compared the results with the generated collections. The audited [original archive](https://github.com/velella-sh/offing/blob/1da88a0d/benchmarks/state-of-eol/2027-raw.json.gz) has SHA-256 `b69cd498f9ccf2dce1797a085978b55385d74a4e5b69e98630af05a6c4e0a7d9`. The analysis date was November 27, 2026 UTC.

- Matched all 1,000 repository names and commit SHAs to the cohort. Compared the initial and retry attempt states, reasons, fetched bytes, and scan plans. The 42 retries recovered 41 repositories for a total of 999 successful scans. One exact revision remained unavailable through Fleet's anonymous Git transport.
- Joined finding identities with the frozen rule catalog. Counted distinct repositories with an ended runtime and took the median of one nearest future event per repository. Recalculated 383 of 999, a 154-day median across 289, and `nodejs.runtime.eol-22` in 207 of those 289. Counted 556 successful scans with an evidence gap, five with unavailable or incomplete coverage, and 706 complete scans without a dated event in the window.
- Recomputed every ecosystem and Action runtime row from per-repository observations. Rebuilt both package rankings from graph blocker identities and applicable analyzers. The rankings covered 241 eligible Node.js and 84 eligible Python repositories, with one unavailable repository for each target.
- Recounted 2,734 observed Dockerfiles. The frozen evidence yielded zero lineage-only findings, 1,962 Dockerfiles with no-data, and 568 with unknown lineage. Predicted dates were unavailable across the cohort.

Every published count and denominator audited against the raw records matched. [Automated rebuild and rendering check](https://github.com/velella-sh/offing/actions/workflows/state-of-eol.yml)

## Rank 7 retry

The [new archive](2027-raw.json.gz) has SHA-256 `97af83f01c3253904617d0a12edf74231ba2220fc82b2f5430174da42701e1ee`. The original 43 input folders reproduced the original archive byte for byte. The new archive adds two recorded attempts for the same OpenClaw pin. The authenticated sparse scan failed. A blob-verified checkout of the same tree then produced a complete scan and both target graphs with the original analysis date and acquisition revision.

| Observation | Result |
| --- | --- |
| Exact Git commit | `58aa479482451ca525af1686de91fe2e197a0a2f` |
| Git tree | `125f3f1aaac7254d1e43d0605c7d10f4f3615efc` |
| Compressed GitHub snapshot | 224,853,974 bytes, SHA-256 `b20b503414c339e422ce188215555ec0d420225c4465ebfd19e61b4a4ecd9e41` |
| Declared files verified | 61,919 files, 558,461,042 bytes |
| Git path and object inventory | SHA-256 `5326895463a88e140799d3827506cba03221325f0a434a5133a4ecabcef10815` |
| Declared path and object inventory | SHA-256 `7f406ba016c5128cdc9e8a060467c52849692ca92729f0d01f2fe36c01710166` |
| Raw collector row | SHA-256 `21050af7d58dc7ed6e01d49435b4cfa84ae06cad153684a0d02575d0c4f46cca` before public-path redaction |
| Node.js 22 graph | Blocked, 72 blockers and 32 dependency roots |
| Python 3.13 graph | Ready, zero blockers |

The complete Git objects came from a shallow authenticated fetch with `--filter=blob:none` and `--no-tags`. `git ls-tree -rz <commit>` enumerated 67,233 exact paths. The archive came from the exact [GitHub codeload URL](https://codeload.github.com/openclaw/openclaw/tar.gz/58aa479482451ca525af1686de91fe2e197a0a2f), with a 512 MiB compressed cap. The materializer selected regular files using the acquisition revision's Fleet predicate, bounded the uncompressed archive at 2 GiB, and checked each file against `SHA-1("blob <size>\0" + file bytes)` from the Git tree. The inventories hash compact JSON arrays of `{mode,type,oid,path}` in Git tree order. The collector supplied the same files and exact pin to its original scan with `--start 7 --count 1 --jobs 1`. The downloaded files served only as static analyzer inputs.

All 1,000 exact pins now have both target graphs. The Node.js 22 ranking has 242 contributing repositories and 670 ranked packages. The Python 3.13 ranking has 84 contributing repositories and 14 ranked packages. The lifecycle figures use 383 of 1,000 for ended runtimes. The nearest dated event still has a median of 154 days across 289 repositories.

# What-if runtime upgrade benchmark

This benchmark compares Offing's verdicts and blocker graph against explicit
compatibility constraints in 66 public runtime upgrade PRs. It uses bundled
Ebb 0.2.0. Each PR contributes an observation before the change and one after it.

| Measure | Before merge | After merge |
| --- | ---: | ---: |
| Exact verdict, including unknown | 24/66 (36.4%) | 27/66 (40.9%) |
| Exact verdict where the reference is known | 6/47 (12.8%) | 11/49 (22.4%) |
| Offing returned unknown | 55/66 | 54/66 |
| Blockers matched | 3/12 | 3/5 |
| Blockers missed | 9 | 2 |
| Unexpected blockers | 0 | 0 |

[Results](results.json) lists every prediction and every missed or unexpected
blocker. Most mismatches were abstentions on a snapshot whose manifests alone
contained an interpretable range. Project-level constraints account for the
missed blockers in this cohort.

## Selection and reference labels

GitHub PR searches used `"upgrade to Node.js 22"`, `"upgrade to Node 22"`,
their Node 24 counterparts, `"bump node to 22"`, `"bump node to 24"`,
`"upgrade to Python 3.12"`, `"upgrade to Python 3.13"`,
`"upgrade to Python 3.14"` and `"bump python to 3.13"`, with
`in:title is:merged`, up to 60 results per query. Candidates had to be non-fork,
non-archived public repositories with both commits available. A changed root
pin or lower bound had to prove movement from an older line to the title's
target. The corpus keeps the first qualifying merged PR per repository by
merge date and URL. Eligibility is determined from the declarations before
running Offing. [Corpus pins](corpus.json)

The base is the landed merge commit's first parent. The second observation is
the landed commit itself, including squash or rebase merges. Each row records
the PR, both full SHAs, the changed declaration, and each read file's SHA-256.
The simulator uses the merge date and the exact new pin or the lower boundary
of the new range. Short versions get zeroes for missing components.

The benchmark evaluates only the named root files. Its reference labels are
derived independently from:

- Node.js: `package.json`'s `engines.node` and the production packages'
  declared `engines.node` in npm v2/v3 lockfiles, using npm SemVer.
- Python: `pyproject.toml`'s `[project].requires-python`, using PEP 440.
- Runtime pin files establish the upgrade, while the range declarations
  establish compatibility. A known excluding range labels a blocker.
  Interpretable ranges that all admit the target label `ready`. If the
  selected files supply no interpretable range, the label is `unknown`.

The scorer compares every verdict and matches blocker graph entries by path
and subject. The projection excludes source code, workspace manifests,
non-npm locks and CI logs. These labels measure declared compatibility in the
sampled files. A merged PR or a `ready` label provides no runtime test result.

## Reproduce

Run from the Offing repository at the snapshot containing this report.

```sh
npm ci
npm run build --silent
cache="$(mktemp -d)"
node dist/benchmarks/what-if/score.js --cache "$cache" --fetch > /tmp/offing-what-if-results.json
node -e 'require("node:assert/strict").deepEqual(require("./benchmarks/what-if/results.json"), require("/tmp/offing-what-if-results.json"))'
```

Remove `--fetch` to replay against an already populated cache without network.
Acquisition reads allowlisted data files from public pinned commits and checks
their hashes. The simulator reads a fresh directory containing only those
files. No downloaded project code is run. A missing or changed file stops the
benchmark instead of silently shrinking the cohort.

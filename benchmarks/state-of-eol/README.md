# State of EOL 2027 repository cohort

The [recorded cohort](2027-cohort.json) is the input to the State of EOL 2027 study. Each row records a public GitHub repository, its observed star count, its most recent push timestamp, and its default branch with the exact commit SHA. The timestamp and star count reflect the capture window. The commit is the ref to use in a reproduction.

## Selection

- Search GitHub for public repositories that are neither forks nor archived, with a push since the UTC date 365 days before capture began. GitHub's repository-level push date measures activity on any branch.
- Exclude disabled repositories and repositories without a default branch. Require a commit on the default branch for every included repository.
- Keep the first 1,000 by descending star count. Break ties by the case-insensitive owner/repository name in ASCII order.
- Query up to 100 rows at a time, then enumerate all repositories tied at the boundary before continuing below it. GitHub Search caps pagination at 1,000 matches per query. Capture fails on a partial response, a duplicate across bands or an incomplete tie.

The cohort represents popular and recently updated repositories visible through GitHub Search, including documentation and resource collections. Stars can move during capture, and the search index can lag changes to repository metadata. The archive contains the ranked input for the later lifecycle scan.

See the official [GitHub repository search qualifiers](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories), [GitHub search response limits](https://docs.github.com/en/rest/search/search#about-the-search-api) and [GitHub GraphQL Repository object](https://docs.github.com/en/graphql/reference/objects#repository).

## Verify or capture

```sh
npm run build
node dist/tools/state-of-eol/cohort.js --verify
jq -r '.repositories[] | "github/\(.repository)@\(.commit)"' benchmarks/state-of-eol/2027-cohort.json
```

Verification uses only the committed file. To capture a later cohort, authenticate the GitHub CLI with read access to public repository metadata and run `node dist/tools/state-of-eol/cohort.js --record /path/to/new-cohort.json`. The collector reads GraphQL metadata and preserves existing snapshots.

## 2027 report

The [raw scan archive](2027-raw.json.gz) records intended and fetched commit identities, successful and failed observations, detector findings, no-data counts, literal Action runtime declarations, Node.js 22 and Python 3.13 blocker graphs, and resolved Dockerfile lineage evidence. The catalog captured with this archive supplies rule identities and dates for the figures. The report uses the cohort's UTC capture date as its analysis date and records when the scanning run actually took place.

The archive identifies the [exact acquisition source tree](https://github.com/velella-sh/offing/commit/4af23498645d6baa5ae719ef0981f9b172b6a5ee), dependency lock digest, bundled data version, Node version, and operating system. It keeps finding and graph observations with their paths. The `retries` array preserves each observed state for repeatedly attempted pins, including initial failures, and gives its zero-based scan index into `scans`. The report counts each exact pin once, preferring a successful observation where available. The report consumes the archived catalog and resolved lineage so later Ebb releases cannot change its figures.

Run `npm ci` followed by `npm run state-of-eol -- --out /path/to/report-data` to reproduce the data collections offline. `npm run build:dashboard` also writes the same collections for the docs site. The [State of EOL workflow](https://github.com/velella-sh/offing/actions/workflows/state-of-eol.yml) compares two rebuilds and validates the rendered study and chart table.

The Fleet CLI can replay the same public GitHub pins directly. Pinned mode uses anonymous HTTPS and reads only declared scanner inputs. The namespace form still treats `--repos` entries as repository names within that namespace.

```sh
jq -r '.repositories[] | "github/\(.repository)@\(.commit)"' benchmarks/state-of-eol/2027-cohort.json > /tmp/state-of-eol-pins.txt
node dist/src/cli.js fleet --repos /tmp/state-of-eol-pins.txt --jobs 4 --json
```

Use the collector for the additional research evidence. A fresh run requires public HTTPS for the exact Git objects. Project and repository scripts are never run. The output directory must be new. The raw archive is frozen from that directory, without changing the existing study.

```sh
node dist/tools/state-of-eol/scan.js --out /path/to/new-scan --jobs 4
npm run state-of-eol -- --scan /path/to/new-scan --archive /path/to/new-study.json.gz --out /path/to/new-report-data
```

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

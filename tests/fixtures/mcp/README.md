# MCP recordings

One recorded call per MCP tool, replayed by [`tests/mcp-recorded.test.ts`](../../mcp-recorded.test.ts). Each
`<tool>.json` holds the request a client makes and the answer the server gave. The test sends the request to a fresh
server over the in-memory transport, checks that the answer validates against the output schema the server advertises,
and holds the answer to the recording. A change to any answer is therefore a diff to review.

| File | Request |
| --- | --- |
| `scan_repository.json` | A scan of the repository below. |
| `list_deprecations.json` | The same repository as the short list. |
| `explain_deprecation.json`, `create_migration_context.json` | The deprecated `request` dependency, which has a usage in `src/index.js`. |
| `verify_migration.json` | The same finding after the repository was left unchanged, so it is not verified. |
| `check_dependency.json` | `pkg:npm/request@2.88.2`. |
| `check_upgrade.json` | A move to `php@8.4`, which the lockfile blocks. |
| `check_snippet.json` | A `Dockerfile` that starts from `node:16`. |
| `forecast_repository.json`, `recommend_version.json` | Twelve months and a recommendation as of `2025-09-01`. |

`repository/` is a small repository with two findings: a workflow that sets up Node.js 20 and a dependency on the
deprecated `request` package. Its lockfile holds one package that blocks an upgrade to PHP 8.4. The manifests are
committed with a `.fixture` suffix; the test copies the tree and restores the names.

## Read a recording

- `"<repository>"` stands for the path of the repository copy. The test replaces it in the request, and in every
  string of the answer, with the path of the copy it made.
- `before` lists the calls the session made first. `verify_migration` answers only for a finding the session observed,
  so its recording starts with a scan.
- `"<timestamp>"` stands for a field that holds the time of the call, such as `scannedAt`.
- `"<data: …>"` stands for the description of the lifecycle data. Its version moves with every data release and its
  age with the calendar, so the recording keeps its field names and not its values. The schema check still holds the
  object to the published shape.
- The warning that the lifecycle data is old, which `scan_repository` adds to `diagnostics` thirty days after the last
  data release, is left out of the comparison. `tests/data-age.test.ts` covers it.

Everything else is compared as it is, including the order of the fields.

## Record again

After a deliberate change to an answer, record again and review the diff:

```bash
npm run build --silent
UPDATE_GOLDEN=1 node tools/run-tests.mjs dist/tests/mcp-recorded.test.js
node tools/run-tests.mjs dist/tests/mcp-recorded.test.js
```

A new tool needs a `<tool>.json` named after it, holding its `request` and an empty `response` for the first
recording to fill. A recording must not hold a timestamp, a path of the machine it was written on, or a date that
follows the day of the run: pin `as_of`, and keep to rules whose dates have passed.

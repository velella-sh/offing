# Autopilot evaluations

## Public repository cohort

[cohort.json](cohort.json) records the 50 repositories selected for
`acc-autopilot-evals`.

1. Start with a reviewed positive in the [public-repository corpus](../public-repositories).
   Select distinct public, unarchived, non-fork repositories with a GitHub push
   in the year ending on the selection date. Keep the corpus's full commit SHA.
2. Require a successful GitHub check rollup and a successful Actions test job at
   that SHA. Record the job URL, completion time and a successful test step.
   When job step details are unavailable, record the test command in the
   workflow at the same SHA. Read the historical evidence through the GitHub API.
3. Use one Linux test command produced by [Offing's test planner](../../src/test-runners/detect.ts)
   per repository, with all nine built-in runners represented. Check the
   planner against the pinned Git tree's regular root-level files and manifest
   contents. The hosted baseline can use the upstream project's own test
   invocation.
4. Scan the cached pinned corpus source using the recorded Offing commit and
   bundled Ebb version. Require a finding whose rule and path match a reviewed
   corpus positive and whose migration packet has both ordered steps and
   verification commands. Record the finding ID, packet schema, step and
   command counts, and guidance source.

The hosted job establishes a historical green baseline at the pin. The
selection check verifies cohort integrity offline. The upstream tests and
Autopilot migrations run separately. No external project code is needed
to check the committed cohort.

```sh
npm run build --silent
node --test dist/tests/autopilot-evals-cohort.test.js
```

To inspect baseline evidence for a row, take the ID after `/job/` in
`baseline.jobUrl` and query GitHub using the row's repository. Confirm
`head_sha` matches `commit` and the named test step and job succeeded. When
`baseline.workflowPath` is given, read that path at the same commit for the
recorded test command.

```sh
gh api "repos/$repository/actions/jobs/$job_id" --jq '{head_sha, conclusion, steps}'
```

With the pinned source material and the recorded Offing checkout built, inspect
the proposed test command and regenerate the migration packet. Run these on
the evaluation host against the read-only source tree.

```sh
OFFING_DATA_VERSION=bundled node dist/src/cli.js doctor "$source_tree" --tests --json
OFFING_DATA_VERSION=bundled node dist/src/cli.js context "$finding_id" "$source_tree" --json
```

## Synthetic report fixture

Exercise the offline reporter with the committed synthetic fixture.

```sh
npm run build --silent
npm run autopilot-evals:report -- --fixture tests/fixtures/autopilot-evals/results.json
```

The command reads a local JSON file and writes JSON to stdout. The input and output
identify their source as `synthetic-fixture`. A green fixture requires a completed
phase trace and passing verification in an [Autopilot run](../../schemas/autopilot-run.v1.schema.json)
and [Proof v1](../../docs/spec/proof/v1.md) record.

Every rate uses all fixture rows as its denominator. Turn, duration and cost
medians use attempted rows with a recorded measurement for that metric. Each
median includes its sample count, and unavailable medians are `null`. Non-green
rows link to the last failure file alongside the fixture and include its verified
SHA-256. Each input and failure file has a 1 MiB limit.

Live migration runs and their recorded outcomes are tracked in
[issue #948](https://github.com/velella-sh/offing/issues/948).

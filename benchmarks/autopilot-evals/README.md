# Autopilot evaluation report

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

The live cohort and its recorded outcomes are tracked in
[issue #948](https://github.com/velella-sh/offing/issues/948).

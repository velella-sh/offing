import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

test("uses weekly and published-release routes and isolates the verify-only workflow from issue writes", async () => {
  const workflow = parse(await readFile(".github/workflows/launch-readiness.yml", "utf8")) as {
    on: Record<string, unknown>;
    jobs: Record<string, { if: string; permissions: unknown }>;
  };
  assert.deepEqual(workflow.on.schedule, [{ cron: "41 8 * * 1" }]);
  assert.deepEqual(workflow.on.release, { types: ["published"] });
  assert.deepEqual(workflow.on.workflow_run, { workflows: ["Release"], types: ["completed"] });
  assert.match(workflow.jobs.collect?.if ?? "", /workflow_run\.head_repository\.full_name == 'velella-sh\/offing'/);
  assert.match(workflow.jobs.collect?.if ?? "", /workflow_run\.event == 'push'/);
  assert.match(
    workflow.jobs["update-issue"]?.if ?? "",
    /event_name == 'schedule' \|\| needs\.collect\.outputs\.published == 'true'/,
  );
  assert.deepEqual(workflow.jobs.collect?.permissions, { actions: "read", contents: "read" });
  assert.deepEqual(workflow.jobs["update-issue"]?.permissions, { contents: "read", issues: "write" });
  const reusable = await readFile(".github/workflows/launch-readiness-report.yml", "utf8");
  assert.match(reusable, /path: metrics\/launch-readiness\//);
  assert.doesNotMatch(reusable, /issues: write|secrets:|id-token: write/);
});

const ghFixture = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FIXTURE_DIR/calls"
case "$1:$2" in
  api:--method) test ! -f "$FIXTURE_DIR/issues" || cat "$FIXTURE_DIR/issues" ;;
  issue:create)
    printf '42\topen\n' > "$FIXTURE_DIR/issues"
    cp "\${!#}" "$FIXTURE_DIR/issue-body"
    echo https://github.com/velella-sh/offing/issues/42 ;;
  issue:edit) test "$3" = 42; cp "\${!#}" "$FIXTURE_DIR/issue-body" ;;
  issue:pin) test "$3" = 42 ;;
  *) exit 98 ;;
esac
`;

test("refreshes the same automation issue on repeat and refuses a closed or ambiguous tracker", {
  skip: process.platform === "win32",
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "offing-readiness-workflow-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "gh"), ghFixture, { mode: 0o700 });
  const report = join(directory, "2026-11-28.md");
  const publish = (artifact: string) =>
    spawnSync("bash", [".github/scripts/publish-launch-readiness.sh", report, artifact], {
      encoding: "utf8",
      env: {
        PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        GITHUB_REPOSITORY: "velella-sh/offing",
        FIXTURE_DIR: directory,
      },
      timeout: 5_000,
    });
  const artifact = (id: number) => `https://github.com/velella-sh/offing/actions/runs/${id}/artifacts/9000`;
  await writeFile(report, "# Weekly observation\n");
  const first = publish(artifact(100));
  assert.equal(first.status, 0, first.stderr);
  await writeFile(report, "# Release observation\n");
  const repeat = publish(artifact(101));
  assert.equal(repeat.status, 0, repeat.stderr);
  const body = await readFile(join(directory, "issue-body"), "utf8");
  assert.match(body, /^<!-- offing-launch-readiness-report -->\n\n# Release observation/);
  assert.ok(body.includes(artifact(101)));
  for (const invalid of ["42\tclosed\n", "42\topen\n43\topen\n"]) {
    await writeFile(join(directory, "issues"), invalid);
    assert.match(publish(artifact(102)).stderr, /Expected one open automation-owned/);
  }
  const calls = (await readFile(join(directory, "calls"), "utf8")).split("\n");
  assert.equal(calls.filter((call) => call.startsWith("issue create")).length, 1);
  assert.equal(calls.filter((call) => call.startsWith("issue edit 42")).length, 1);
  assert.equal(calls.filter((call) => call.startsWith("issue pin 42")).length, 2);
});

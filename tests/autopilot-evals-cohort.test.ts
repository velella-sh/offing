import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import type { TestPlan } from "../src/test-runners/detect.js";

type TestStep = TestPlan["steps"][number];

interface CohortRepository {
  repository: string;
  commit: string;
  lastPushAt: string;
  corpus: string;
  runner: Exclude<TestStep["tool"], "configured">;
  testCommand: TestStep["command"];
  baseline: {
    jobUrl: string;
    job: string;
    testEvidence: string;
    passedAt: string;
    workflowPath?: string;
  };
  finding: { id: string; ruleId: string; path: string; line: number };
  migrationPacket: { schemaVersion: string; steps: number; verificationCommands: number; source: string };
}

function readJson<T>(path: string): Promise<T> {
  return readFile(resolve(path), "utf8").then((content) => JSON.parse(content) as T);
}

test("acc-autopilot-evals selects 50 distinct pinned repositories across all nine runners", async () => {
  const cohort = await readJson<{
    checkedAt: string;
    activitySince: string;
    offingCommit: string;
    repositories: CohortRepository[];
  }>("benchmarks/autopilot-evals/cohort.json");
  const sha = /^[\da-f]{40}$/u;
  const checkedAt = Date.parse(cohort.checkedAt);
  const activitySince = Date.parse(cohort.activitySince);

  assert.match(cohort.offingCommit, sha);
  assert.equal(cohort.repositories.length, 50);
  assert.equal(new Set(cohort.repositories.map(({ repository }) => repository.toLowerCase())).size, 50);
  assert.deepEqual([...new Set(cohort.repositories.map(({ runner }) => runner))].sort(), [
    "dotnet",
    "go",
    "gradle",
    "maven",
    "npm",
    "pnpm",
    "pytest",
    "tox",
    "yarn",
  ]);

  await Promise.all(
    cohort.repositories.map(
      async ({ baseline, commit, corpus, finding, lastPushAt, migrationPacket, repository, testCommand }) => {
        assert.match(commit, sha, repository);
        const pushedAt = Date.parse(lastPushAt);
        assert.ok(pushedAt >= activitySince && pushedAt <= checkedAt, repository);
        assert.ok(Date.parse(baseline.passedAt) <= checkedAt, repository);
        assert.ok(testCommand.length > 0 && testCommand.every(Boolean), repository);

        const job = new URL(baseline.jobUrl);
        assert.equal(job.origin, "https://github.com", repository);
        const [owner, repo, actions, runs, runId, jobSegment, jobId] = job.pathname.slice(1).split("/");
        assert.equal(`${owner}/${repo}`, repository);
        assert.deepEqual([actions, runs, jobSegment], ["actions", "runs", "job"], repository);
        assert.match(runId ?? "", /^\d+$/u, repository);
        assert.match(jobId ?? "", /^\d+$/u, repository);
        assert.ok(baseline.job && baseline.testEvidence, repository);

        assert.match(corpus, /^benchmarks\/public-repositories\/[\w-]+\/[\w.-]+\.json$/u, repository);
        const reviewed = await readJson<{
          repository: string;
          commit: string;
          expected: Array<{ ruleId: string; path: string }>;
        }>(corpus);
        assert.equal(reviewed.repository, repository);
        assert.equal(reviewed.commit, commit, repository);
        assert.ok(
          reviewed.expected.some(({ ruleId, path }) => finding.ruleId === ruleId && finding.path === path),
          repository,
        );
        assert.equal(finding.id, `${finding.ruleId}:${finding.path}:${finding.line}`, repository);
        assert.ok(finding.line > 0, repository);
        assert.equal(migrationPacket.schemaVersion, "offing.context.v1", repository);
        assert.ok(migrationPacket.steps > 0 && migrationPacket.verificationCommands > 0, repository);
        assert.equal(new URL(migrationPacket.source).protocol, "https:", repository);
      },
    ),
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { readLaunchDocs } from "../tools/launch-readiness/docs.js";

type RecordedCheck = {
  run: {
    path: string;
    id: number;
    event: string;
    head_sha: string;
    head_repository: { full_name: string };
    updated_at: string;
  };
  job: { id: number; steps: Array<{ conclusion: string; number: number }> };
};

const date = "2026-11-28";
const base = "https://github.com/velella-sh/offing";

async function recordings(): Promise<{ commands: RecordedCheck; links: RecordedCheck }> {
  return JSON.parse(await readFile("tests/fixtures/launch-readiness/docs-workflows.json", "utf8"));
}

function replay(...recorded: RecordedCheck[]): typeof fetch {
  return async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "manual");
    const workflow = /\/actions\/workflows\/([^/]+)\/runs$/u.exec(url.pathname)?.[1];
    if (workflow) {
      const head = url.searchParams.get("head_sha");
      const runs = recorded
        .map(({ run }) => run)
        .filter((run) => run.path.endsWith(workflow) && (!head || run.head_sha === head));
      return Response.json({ workflow_runs: runs });
    }
    const jobs = recorded
      .filter(({ run }) => url.pathname.endsWith(`/actions/runs/${run.id}/jobs`))
      .map(({ job }) => job);
    return Response.json({ jobs });
  };
}

test("reports recorded command success and prior PR link evidence without claiming full launch coverage", async () => {
  const { commands, links } = await recordings();
  const result = await readLaunchDocs(replay(commands, links), { commit: commands.run.head_sha, date });
  assert.equal(result.status, "amber");
  assert.equal(
    result.observed,
    "Packed launch commands passed (current revision) · Built launch links passed (prior PR check at 2ff5d594) · Full launch docs and README evidence incomplete",
  );
  assert.deepEqual(result.evidence, [
    `${base}/actions/runs/46125092398/job/140917824318#step:6:1`,
    `${base}/actions/runs/46127003792/job/140923705098#step:9:1`,
    `${base}/issues/282`,
    `${base}/issues/287`,
    `${base}/issues/301`,
  ]);
});

test("reads failures and skipped checks on the exact current checkout", async () => {
  const { commands, links } = await recordings();
  const commit = commands.run.head_sha;
  links.run = { ...links.run, event: "workflow_dispatch", head_sha: commit };
  const expected = "Built launch links";
  assert.match(
    (await readLaunchDocs(replay(commands, links), { commit, date })).observed,
    /Built launch links passed \(current revision\)/u,
  );

  const command = commands.job.steps[0];
  const link = links.job.steps[0];
  assert.ok(command && link);
  command.conclusion = "skipped";
  link.conclusion = "failure";
  const failed = await readLaunchDocs(replay(commands, links), { commit, date });
  assert.equal(failed.status, "red");
  assert.match(failed.observed, /Packed launch commands missing \(current revision\)/u);
  assert.ok(failed.observed.includes(`${expected} failed (current revision)`));
  assert.ok(failed.evidence[1]?.endsWith("/140923705098#step:9:1"));
});

test("different revisions, fork runs and future results cannot set a current failure", async () => {
  const { commands, links } = await recordings();
  const commit = links.run.head_sha;
  const command = commands.job.steps[0];
  const link = links.job.steps[0];
  assert.ok(command && link);
  command.conclusion = "failure";
  link.conclusion = "failure";
  const prior = await readLaunchDocs(replay(commands, links), { commit, date });
  assert.equal(prior.status, "amber");
  assert.match(prior.observed, /failed \(prior revision 53362508\).*failed \(prior PR check at 2ff5d594\)/u);

  commands.run.head_repository.full_name = "some-fork/offing";
  links.run.updated_at = "2026-12-01T00:00:00Z";
  const unavailable = await readLaunchDocs(replay(commands, links), { commit, date });
  assert.equal(unavailable.status, "amber");
  assert.match(unavailable.observed, /Packed launch commands missing .*Built launch links missing/u);
  assert.deepEqual(unavailable.evidence.slice(0, 2), [
    `${base}/actions/workflows/package-smoke.yml`,
    `${base}/actions/workflows/docs-doctor.yml`,
  ]);
});

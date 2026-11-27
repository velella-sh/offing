import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { fixers } from "../src/fix/index.js";
import { dockerArgs } from "../benchmarks/fix-evals/docker.js";
import { evaluate, type Case, type Input, sha256 } from "../benchmarks/fix-evals/evaluate.js";
import { summarize } from "../benchmarks/fix-evals/report.js";
import { fixtureSource, tempSource } from "../benchmarks/fix-evals/source.js";

const nodeFix = fixers.filter(({ id }) => id === "node-buffer");

async function fixtureEval(kind: string, output: string) {
  const input: Input = { id: kind, repository: null, commit: null, profile: "npm" };
  return evaluate(input, (root) => fixtureSource(root, join("tests/fixtures/fix-evals", kind)), {
    output,
    fixers: nodeFix,
    async backend(_profile, root) {
      const bytes = await readFile(join(root, "index.cjs"), "utf8");
      return async (command, sink) => {
        sink.stdout(Buffer.from(bytes));
        return { exitCode: kind === "red" && command[2]?.endsWith("npm test") ? 1 : 0 };
      };
    },
  });
}

test("real scan and Git patch are measured, red baselines are excluded, and raw output is hashed", async () => {
  await tempSource(async (output) => {
    const green = await fixtureEval("green", output);
    const red = await fixtureEval("red", output);
    const result = green.cases[0];
    assert.deepEqual(result?.metrics, {
      deterministic: true,
      applied: true,
      resolved: null,
      noNewFinding: true,
      idempotent: true,
      buildKeptGreen: true,
      testsKeptGreen: true,
    });
    assert.deepEqual(
      [red.excluded, red.cases.length, red.baseline?.test?.attempts.length],
      ["baseline-not-green", 0, 2],
    );
    const stdout = await readFile(join(output, "green/node-buffer/test-1.stdout"));
    assert.match(stdout.toString("utf8"), /Buffer\.from/u);
    assert.equal(result?.checks?.test?.attempts[0].logs.stdout.sha256, sha256(stdout));
    assert.equal(result?.patch.sha256, sha256(await readFile(join(output, "green/node-buffer/fix.patch"))));
    assert.equal(summarize([green, red], ["node-buffer", "empty-fixer"]).repositories, 0);
    assert.deepEqual(
      summarize([green, red], ["node-buffer", "empty-fixer"]).fixers.map(({ id, cases, status }) => [
        id,
        cases,
        status,
      ]),
      [
        ["empty-fixer", 0, "too few cases"],
        ["node-buffer", 1, "too few cases"],
      ],
    );
  });
});

test("the GitHub Actions validation profile measures a resolved finding without claiming a test", async () => {
  await tempSource(async (output) => {
    const evidence = await evaluate(
      { id: "workflow", repository: null, commit: null, profile: "github-actions" },
      async (root) => {
        const workflows = join(root, ".github/workflows");
        await mkdir(workflows, { recursive: true });
        await writeFile(
          join(workflows, "ci.yml"),
          "name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
        );
      },
      {
        output,
        fixers: fixers.filter(({ id }) => id === "github-actions-uses"),
        backend: () => Promise.resolve(() => Promise.resolve({ exitCode: 0 })),
      },
    );
    assert.equal(evidence.cases[0]?.metrics.resolved, true);
    assert.equal(evidence.cases[0]?.metrics.testsKeptGreen, null);
    assert.equal(evidence.cases[0]?.checks?.test, undefined);
  });
});

test("headlines use applicable cases and carry a link back to every failure", () => {
  const metrics: Case["metrics"] = {
    deterministic: true,
    applied: true,
    resolved: null,
    noNewFinding: true,
    idempotent: true,
    buildKeptGreen: true,
    testsKeptGreen: true,
  };
  const inputs = Array.from({ length: 5 }, (_, index) => ({
    id: `repo-${index}`,
    repository: `public/repo-${index}`,
    commit: "a".repeat(40),
    profile: "npm" as const,
    cases: [
      {
        fixer: "node-buffer",
        patch: { path: "fix.patch", sha256: "a".repeat(64) },
        metrics: { ...metrics, buildKeptGreen: index !== 2 },
      },
    ],
  }));
  const headline = summarize(inputs, ["node-buffer"]).fixers[0];
  assert.deepEqual(headline?.metrics.buildKeptGreen, { passed: 4, applicable: 5, percent: 80 });
  assert.deepEqual(headline?.metrics.resolved, { passed: 0, applicable: 0, percent: null });
  assert.deepEqual(headline?.failures, [
    { repository: "repo-2", failures: ["buildKeptGreen"], evidence: "repo-2/evidence.json" },
  ]);
});

test("approved Docker runner sends sources on stdin and exposes no environment or writable mounts", () => {
  const argv = dockerArgs("unique", "docker.io/library/node@sha256:test", ["npm", "test"]);
  for (const pair of [
    "--network none",
    "--pull=never --platform linux/amd64",
    "--user 65532:65532",
    "--cap-drop ALL",
  ]) {
    assert.match(argv.join(" "), new RegExp(pair));
  }
  assert.ok(argv.includes("--read-only"));
  assert.ok(argv.includes("-i"));
  assert.ok(!argv.includes("--mount") && !argv.includes("--volume") && !argv.includes("--env-file"));
  assert.deepEqual(argv.slice(-3), ["sh", "npm", "test"]);
});

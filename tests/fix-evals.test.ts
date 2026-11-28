import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";

import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";

import { fixers } from "../src/fix/index.js";
import { runApprovedTest } from "../src/test-runners/run.js";
import { dockerArgs, dockerExecArgs, pinnedDockerRunner, sandbox } from "../src/test-runners/docker.js";
import { profiles } from "../src/test-runners/profiles.js";
import { evaluate, type Case, type Input, sha256 } from "../benchmarks/fix-evals/evaluate.js";
import { summarize } from "../benchmarks/fix-evals/report.js";
import { fixtureSource, tempSource } from "../benchmarks/fix-evals/source.js";

const nodeFix = fixers.filter(({ id }) => id === "node-buffer");

const commitSha = z.string().regex(/^[a-f0-9]{40}$/u);
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);
const selection = z.object({
  offingCommit: commitSha,
  ebbVersion: z.string().min(1),
  scannedAt: z.iso.datetime(),
  repositories: z
    .array(
      z.object({
        repository: z.string().regex(/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/iu),
        commit: commitSha,
        baseline: z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("isolated"),
            image: z.string().regex(/(?:^|@)sha256:[a-f0-9]{64}$/u),
            checks: z.array(z.object({ command: z.array(z.string()).min(1), exitCode: z.literal(0) })).min(1),
          }),
          z.object({
            kind: z.literal("upstream"),
            job: z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+\/job\/\d+$/u),
            checks: z.array(z.string().min(1)).min(1),
          }),
        ]),
        patches: z.array(z.object({ fixer: z.string(), sha256: sha256Hex, paths: z.array(z.string()).min(1) })).min(1),
      }),
    )
    .min(60),
});

test("acc-fix-evals selection has one source pin per repository and evidence for every registered fixer", async () => {
  const data = selection.parse(JSON.parse(await readFile("benchmarks/fix-evals/selection.json", "utf8")));
  const repositories = data.repositories.map(({ repository }) => repository.toLowerCase());
  assert.equal(new Set(repositories).size, repositories.length);
  const covered = new Set(data.repositories.flatMap(({ patches }) => patches.map(({ fixer }) => fixer)));
  for (const { id } of fixers) assert.ok(covered.has(id), `The selection lacks a baseline and patch for ${id}.`);
  for (const { baseline, repository } of data.repositories) {
    if (baseline.kind === "upstream") {
      assert.ok(new URL(baseline.job).pathname.toLowerCase().startsWith(`/${repository.toLowerCase()}/actions/runs/`));
    }
  }
});

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
    const record: unknown = JSON.parse(await readFile(join(output, "green/node-buffer/test.v1.json"), "utf8"));
    const schema: object = JSON.parse(await readFile("schemas/test-run.v1.schema.json", "utf8"));
    const validate = new Ajv2020({ strict: false }).compile(schema);
    assert.equal(validate(record), true, JSON.stringify(validate.errors));
    const { files, ...evidence } = result?.checks?.test ?? assert.fail("Missing test result");
    assert.deepEqual(record, evidence);
    assert.equal(files[0]?.stdout, "green/node-buffer/test-1.stdout");
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

test("approved Docker runner isolates the worktree and keeps command arguments literal", () => {
  const argv = dockerArgs("unique", "docker.io/library/node@sha256:test");
  for (const pair of [
    "--network none",
    "--pull=never --platform linux/amd64",
    "--user 65532:65532",
    "--cap-drop ALL",
  ]) {
    assert.match(argv.join(" "), new RegExp(pair));
  }
  assert.ok(argv.includes("--read-only"));
  assert.ok(argv.includes("--detach"));
  assert.ok(!argv.includes("--mount") && !argv.includes("--volume") && !argv.includes("--env-file"));
  assert.deepEqual(dockerExecArgs("unique", ["npm", "test", "literal; arg"]), [
    "exec",
    "--workdir",
    "/work/tree",
    "unique",
    "timeout",
    "130",
    "npm",
    "test",
    "literal; arg",
  ]);
});

test("Docker reads bounded JUnit separately from the captured command logs and removes the sandbox", async () => {
  const report = '<testsuite><testcase name="example"/></testsuite>';
  const archive = Buffer.from("synthetic archive");
  const samples = [
    { readReports: true, payload: Buffer.from(report + "\0" + report + "\0"), reports: [report, report] },
    { readReports: true, previous: Buffer.from(report + "\0"), payload: Buffer.from(report + "\0"), reports: [] },
    { readReports: true, payload: Buffer.from(report), reports: [] },
    { readReports: true, payload: Buffer.from("x".repeat(1024 * 1024 + 1) + "\0"), reports: [] },
    { readReports: true, payload: Buffer.alloc(0), reports: [] },
    { readReports: false, payload: Buffer.from(report + "\0"), reports: undefined },
  ];
  for (const { readReports, previous, payload, reports } of samples) {
    const phases: string[] = [];
    let reads = 0;
    const signals = new Set<AbortSignal | undefined>();
    const docker: Parameters<typeof sandbox>[0] = (args, signal) => {
      const phase =
        args[0] === "exec" ? (args[1] === "-i" ? "unpack" : args[4] === "timeout" ? "test" : "read") : args[0];
      assert.ok(phase);
      phases.push(phase);
      if (phase !== "rm") signals.add(signal);
      const stdin = new PassThrough();
      const child = Object.assign(new ChildProcess(), { stdin });
      const result = (async () => {
        if (phase === "unpack") {
          const input: Buffer[] = [];
          for await (const chunk of stdin) input.push(Buffer.from(chunk));
          assert.deepEqual(Buffer.concat(input), archive);
        }
        const stdout =
          phase === "read" ? (reads++ === 0 ? (previous ?? Buffer.alloc(0)) : payload) : Buffer.from(phase);
        return { stdout, stderr: Buffer.from("diagnostics") };
      })();
      return Object.assign(result, { child });
    };
    const signal = AbortSignal.timeout(1000);
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await sandbox(docker, "image", archive)(
      ["npm", "test"],
      { signal, stdout: (chunk) => stdout.push(chunk), stderr: (chunk) => stderr.push(chunk) },
      readReports,
    );
    assert.deepEqual(result.reports, reports);
    assert.deepEqual(
      phases,
      readReports ? ["run", "unpack", "read", "test", "read", "rm"] : ["run", "unpack", "test", "rm"],
    );
    assert.deepEqual([...signals], [signal]);
    assert.equal(Buffer.concat(stdout).toString(), "test");
    assert.equal(Buffer.concat(stderr).toString(), "diagnostics");
  }
});

test("a command deadline preserves received bytes and removes the container on a separate signal", async () => {
  let removed = false;
  const docker: Parameters<typeof sandbox>[0] = (args, signal) => {
    const child = Object.assign(new ChildProcess(), { stdin: new PassThrough() });
    const result = (async () => {
      if (args[4] === "timeout") {
        await setTimeout(5000, undefined, { signal }).catch((error: unknown) => {
          throw Object.assign(new Error("Synthetic Docker cancellation", { cause: error }), {
            stdout: Buffer.from("started"),
            stderr: Buffer.from("waiting"),
          });
        });
      }
      if (args[0] === "rm") {
        assert.equal(signal?.aborted, false);
        removed = true;
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    })();
    return Object.assign(result, { child });
  };
  const execute = sandbox(docker, "image", Buffer.alloc(0));
  const result = await runApprovedTest(["npm", "test"], (command, output) => execute(command, output, false), 25);
  assert.equal(removed, true);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].status, "timed-out");
  assert.equal(result.attempts[0].logs.stdout.tail, "started");
  assert.equal(result.attempts[0].logs.stderr.tail, "waiting");
});

test("the shared Docker runner caches each pinned image and snapshots the current checkout", async () => {
  const inspected: string[] = [];
  const archives: Buffer[] = [];
  const recipe = "FROM scratch";
  const builtImage = "sha256:" + "a".repeat(64);
  const docker: Parameters<typeof pinnedDockerRunner>[0] = (args) => {
    const stdin = new PassThrough();
    const child = Object.assign(new ChildProcess(), { stdin });
    const result = (async () => {
      let stdout = "";
      if (args[0] === "image") {
        inspected.push(args.at(-1) ?? "");
        stdout = "linux/amd64";
      }
      if (args[0] === "build" || (args[0] === "exec" && args[1] === "-i")) {
        const payload: Buffer[] = [];
        for await (const chunk of stdin) payload.push(Buffer.from(chunk));
        const bytes = Buffer.concat(payload);
        if (args[0] === "build") {
          assert.equal(bytes.toString(), recipe);
          stdout = builtImage;
        } else archives.push(bytes);
      }
      return { stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
    })();
    return Object.assign(result, { child });
  };
  const runner = pinnedDockerRunner(docker, async () => recipe);
  const pinnedImage = "node@sha256:" + "b".repeat(64);
  await tempSource(async (root) => {
    const snapshot = join(root, "fixture.txt");
    const command = ["npm", "test"] as const;
    await writeFile(snapshot, "first checkout");
    const earlier = await runner.prepare("npm", root);
    await writeFile(snapshot, "later checkout");
    const later = await runner.prepare("npm", root);
    await runner.prepare("npm", root, { image: pinnedImage });
    await runner.prepare("kubernetes", root);
    for (const executor of [earlier, later]) {
      await runApprovedTest(command, (argv, output) => executor(argv, output, false), 1000);
    }
  });
  assert.deepEqual(inspected, [profiles.npm.image, pinnedImage]);
  assert.deepEqual(Object.fromEntries(runner.images), {
    npm: profiles.npm.image,
    [`npm:${pinnedImage}`]: pinnedImage,
    kubernetes: builtImage,
  });
  assert.deepEqual(
    archives.map((bytes) => bytes.includes("later checkout")),
    [false, true],
  );
});

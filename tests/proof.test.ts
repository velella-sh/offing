import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";

import { advanceRun, startRun } from "../src/autopilot/state.js";
import { digest, logName, PROOF_FILE } from "../src/proof/document.js";
import {
  prepareAutopilotProofPublication,
  prepareProofPublication,
  type AutopilotProofEvidence,
  type Proof,
} from "../src/proof/publish.js";
import { runApprovedTest } from "../src/test-runners/run.js";
import { runCli } from "./cli-runner.js";

interface Fixture {
  repo: string;
  cases: { variant: string; file: string }[];
}

async function sample(t: TestContext) {
  const { fixtures }: { fixtures(root: string): Promise<Fixture> } = await import(
    pathToFileURL(resolve("docs/spec/proof/conformance/fixtures.mjs")).href
  );
  const root = await mkdtemp(join(tmpdir(), "offing-proof-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { repo, cases } = await fixtures(root);
  const valid = cases.find(({ variant }) => variant === "valid")?.file;
  assert.ok(valid);
  const proof = JSON.parse(await readFile(valid, "utf8")) as Proof;
  return { root, repo, cases, valid, proof };
}

test("proof verifies Git objects and every unique sidecar from a clean directory", async (t) => {
  const { cases, repo, valid } = await sample(t);
  const reports = new Map([
    ["valid", { code: 0, message: /Proof verified/ }],
    ["tampered-log", { code: 1, message: /SHA-256 disagrees.*stdout/ }],
    ["mismatched-range", { code: 1, message: /scan identities/ }],
    ["mismatched-diff", { code: 1, message: /diff added/ }],
    ["bad-schema", { code: 4, message: /Invalid proof schema/ }],
  ]);
  for (const { variant, file } of cases) {
    const output = await runCli(["proof", "verify", file, "--repo", repo], { env: { GIT_DIR: "ignored" } });
    assert.equal(output.code, reports.get(variant)?.code, output.stderr);
    assert.match(output.stdout + output.stderr, reports.get(variant)?.message ?? /unknown fixture/);
  }
  assert.equal((await runCli(["proof", "verify", valid], { cwd: repo })).code, 0);
  execFileSync("git", ["config", "diff.relative", "true"], { cwd: repo });
  const nested = join(repo, "nested");
  await mkdir(nested);
  assert.equal((await runCli(["proof", "verify", valid, "--repo", nested])).code, 0);
  for (const args of [
    [],
    ["other", valid],
    ["verify", valid, "extra"],
    ["verify", valid, "--repo"],
    ["verify", valid, "--repo", ""],
  ]) {
    const error = await runCli(["proof", ...args]);
    assert.equal(error.code, 2);
    assert.match(error.stderr, /Usage: offing proof verify/);
  }
});

test("proof rejects unavailable commits, invalid commands, verdicts and inline log tails", async (t) => {
  const { proof, root, repo } = await sample(t);
  const file = join(root, PROOF_FILE);
  const command = proof.verify.commands[0];
  assert.ok(command);
  for (const [edit, message] of [
    [
      (doc: Proof) => {
        doc.range.head = "1".repeat(40);
        doc.verify.after.commit = doc.range.head;
      },
      /head commit is unavailable/,
    ],
    [
      (doc: Proof) => {
        doc.verify.counts.resolved = 1;
      },
      /resolved findings/,
    ],
    [
      (doc: Proof) => {
        doc.verify.verdict = "failed";
      },
      /verdict disagrees/,
    ],
    [
      (doc: Proof) => {
        doc.verify.commands = [{ ...command, status: "skipped" }];
      },
      /Inconsistent evidence.*command 1/,
    ],
    [
      (doc: Proof) => {
        const run = doc.testRuns[0];
        assert.ok(run);
        run.attempts[0].logs.stdout.tail = "raw";
      },
      /empty log tail.*stdout/,
    ],
    [() => {}, /unreadable log.*stdout/],
  ] as const) {
    const doc = structuredClone(proof);
    edit(doc);
    await writeFile(file, JSON.stringify(doc));
    const result = await runCli(["proof", "verify", file, "--repo", repo]);
    assert.match(result.stderr, message);
  }
  await writeFile(file, Buffer.from([0x80]));
  assert.match((await runCli(["proof", "verify", file, "--repo", repo])).stderr, /valid UTF-8 JSON/);
  assert.match((await runCli(["proof", "verify", root, "--repo", repo])).stderr, /regular proof file/);
});

test("proof only opens regular sibling logs and hashes their exact bytes", async (t) => {
  const { valid, repo, root, proof } = await sample(t);
  const run = proof.testRuns[0];
  assert.ok(run);
  const sidecar = resolve(valid, "..", logName(run.attempts[0].logs.stdout.sha256));
  await rm(sidecar);
  if (process.platform !== "win32") {
    const outside = join(root, "outside.txt");
    await writeFile(outside, "synthetic passing test\n");
    await symlink(outside, sidecar);
    assert.match((await runCli(["proof", "verify", valid, "--repo", repo])).stderr, /unreadable log.*stdout/);
    await rm(sidecar);
  }
  await writeFile(sidecar, Buffer.from([0xff, 0x0a]));
  assert.match((await runCli(["proof", "verify", valid, "--repo", repo])).stderr, /SHA-256 disagrees.*stdout/);
});

test("PR proof redacts source evidence before rendering or returning any publication files", async (t) => {
  const { proof, root, repo } = await sample(t);
  const run = proof.testRuns[0];
  const agent = proof.agentRuns[0];
  const command = proof.verify.commands[0];
  assert.ok(run && agent && command);
  const marked = "synthetic sensitive fixture value";
  const patterned = "ghp_" + "FixtureOnly".repeat(3);
  const log = `test emitted ${marked} and ${patterned}\n`;
  const secretInput = digest(log);
  const stdout = run.attempts[0].logs.stdout;
  const stderr = run.attempts[0].logs.stderr;
  stdout.sha256 = command.logSha256 = secretInput;
  stdout.tail = log;
  agent.summary = `${marked}\n<!-- offing-proof:v1 -->\n\`\`\`\n${patterned}`;
  const logs = new Map([
    [secretInput, log],
    [stderr.sha256, ""],
  ]);
  const env = { PROOF_FIXTURE_SECRET: marked };
  const publication = await prepareProofPublication(proof, logs, env, ["PROOF_FIXTURE_SECRET"]);

  const expectedLog = "test emitted [REDACTED] and [REDACTED]\n";
  assert.equal(publication.files.get(logName(digest(expectedLog))), expectedLog);
  const saved = publication.files.get(PROOF_FILE);
  assert.ok(saved);
  const output = JSON.parse(saved) as Proof;
  assert.equal(output.verify.commands[0]?.logSha256, digest(expectedLog));
  assert.deepEqual(output.testRuns[0]?.attempts[0].logs.stdout, { sha256: digest(expectedLog), tail: "" });
  assert.equal(stdout.tail, log);
  assert.equal(stdout.sha256, secretInput);
  assert.match(
    publication.body,
    /Outcome — done.+\n- Agent runs — 1, 1 reported turns.+\n- Test runs — 1 passed of 1\n- Budget used — 30 ms, unreported/,
  );
  assert.equal(publication.body.split("<!-- offing-proof:v1 -->").length, 2);
  assert.ok(publication.body.includes(saved));
  for (const [name, contents] of publication.files) {
    assert.ok(!contents.includes(marked) && !contents.includes(patterned));
    await writeFile(join(root, name), contents);
  }
  assert.equal((await runCli(["proof", "verify", join(root, PROOF_FILE), "--repo", repo])).code, 0);
  await assert.rejects(prepareProofPublication(proof, new Map(), env, ["PROOF_FIXTURE_SECRET"]), /source log/);
});

test("PR proof falls back to named, hashed JSON for oversized UTF-8 and reports a stopped outcome", async (t) => {
  const { proof } = await sample(t);
  const run = proof.testRuns[0];
  const agent = proof.agentRuns[0];
  const command = proof.verify.commands[0];
  assert.ok(run && agent && command);
  proof.outcome = "stopped";
  proof.budget.costUsd = 0;
  proof.verify.verdict = "failed";
  command.status = "failed";
  command.exitCode = 1;
  agent.turns = null;
  agent.summary = "🧪".repeat(13_000);
  run.attempts[0].status = "failed";
  const { stdout, stderr } = run.attempts[0].logs;
  const logs = new Map([
    [stdout.sha256, "synthetic passing test\n"],
    [stderr.sha256, ""],
  ]);
  const { body, files } = await prepareProofPublication(proof, logs, {}, []);
  const artifact = files.get(PROOF_FILE);
  assert.ok(artifact);
  assert.match(body, /Outcome — stopped \(verification failed\)/);
  assert.match(body, /0 reported turns, 1 runs with unreported turns/);
  assert.match(body, /Test runs — 0 passed of 1\n- Budget used — 30 ms, USD 0/);
  assert.ok(body.endsWith(`Artifact: \`offing-proof.json\` (SHA-256 \`${digest(artifact)}\`).\n`));
  assert.ok(!body.includes("\`\`\`"));
});

test("publishes green and stopped PR bodies from recorded state, tested commands, and real Git objects", async (t) => {
  const { proof, root, repo } = await sample(t);
  for (const outcome of ["done", "stopped"] as const) {
    const marker = "synthetic receipt fixture secret";
    const stdout = "fixture stdout\n";
    const stderr = outcome === "done" ? "" : "fixture stderr with " + marker;
    const exit = outcome === "done" ? 0 : 7;
    const argv = ["fixture", "test"];
    const testRun = await runApprovedTest(
      ["fixture", "test"],
      async (_, sink) => {
        sink.stdout(Buffer.from(stdout));
        sink.stderr(Buffer.from(stderr));
        return { exitCode: exit };
      },
      500,
    );
    const run = startRun("prepare");
    run.checkout = { id: "Fixtur", branch: "offing/autopilot/Fixtur", baseCommit: proof.range.base };
    for (const phase of ["plan", "baseline-tests", "codemods", "agent-turn", "tests", "verify"] as const)
      advanceRun(run, phase);
    advanceRun(run, outcome === "done" ? "done" : { stop: "fixture-failed" });
    const record = join(root, outcome + ".run.json");
    await writeFile(record, JSON.stringify(run));
    const verify = structuredClone(proof.verify);
    verify.commands = [
      { command: argv.join(" "), purpose: "Checked", status: "not-run", exitCode: null, logSha256: null },
      { command: "fixture skipped", purpose: "Skipped", status: "not-run", exitCode: null, logSha256: null },
      { command: "fixture future", purpose: "Waiting", status: "not-run", exitCode: null, logSha256: null },
    ];
    const evidence: AutopilotProofEvidence = {
      repo,
      verify,
      testRuns: [testRun],
      agentRuns: proof.agentRuns,
      budget: { elapsedMs: 30, costUsd: outcome === "done" ? 0 : null },
      tools: proof.tools,
      commandResults: [
        { commandIndex: 0, testRunIndex: 0 },
        { commandIndex: 1, testRunIndex: null },
      ],
    };
    const source = new Map([
      [digest(stdout), stdout],
      [digest(stderr), stderr],
    ]);
    const stored = JSON.parse(await readFile(record, "utf8")) as unknown;
    const { body, files } = await prepareAutopilotProofPublication(stored, evidence, source, { TEST_MARKER: marker }, [
      "TEST_MARKER",
    ]);
    const file = files.get(PROOF_FILE);
    assert.ok(file);
    const output = JSON.parse(file) as Proof;
    const display = body.split("\n\n<!-- offing-proof:v1 -->")[0] + "\n";
    assert.equal(display, await readFile(join("tests/fixtures/proof", outcome + ".md"), "utf8"));
    assert.ok(body.includes(file));
    assert.deepEqual(output.range, proof.range);
    assert.deepEqual(output.diff, proof.diff);
    assert.deepEqual(output.agentRuns, evidence.agentRuns);
    assert.equal(output.testRuns[0]?.attempts.at(-1)?.exitCode, exit);
    const combined = "[stdout]\n" + stdout + "\n[stderr]\n" + stderr.replace(marker, "[REDACTED]");
    assert.deepEqual(
      output.verify.commands.map(({ status, exitCode, logSha256 }) => [status, exitCode, logSha256]),
      [
        [outcome === "done" ? "passed" : "failed", exit, digest(combined)],
        ["skipped", null, null],
        ["not-run", null, null],
      ],
    );
    assert.equal(files.get(logName(digest(combined))), combined);
    assert.equal(evidence.verify.commands[0]?.status, "not-run");
    const folder = join(root, outcome);
    await mkdir(folder);
    for (const [name, contents] of files) {
      assert.ok(!contents.includes(marker));
      await writeFile(join(folder, name), contents);
    }
    const result = await runCli(["proof", "verify", join(folder, PROOF_FILE), "--repo", repo]);
    assert.equal(result.code, 0, result.stderr);
    if (outcome === "done") {
      await assert.rejects(
        prepareAutopilotProofPublication(
          stored,
          {
            ...evidence,
            testRuns: [],
            commandResults: [{ commandIndex: 1, testRunIndex: null }],
          },
          source,
          {},
          [],
        ),
        /completed run requires passing verification and a passing recorded test/,
      );
      const stopped = { ...run, state: "stopped", transitions: ["scan", "plan", "stopped"], stopReason: "preflight" };
      const early = await prepareAutopilotProofPublication(
        stopped,
        { ...evidence, agentRuns: [], testRuns: [], commandResults: [] },
        new Map(),
        {},
        [],
      );
      assert.match(early.body, /Outcome — stopped[\s\S]*Test runs — 0 passed of 0/);
      await assert.rejects(
        prepareAutopilotProofPublication({ ...stopped, mode: "dry-run" }, evidence, source, {}, []),
        /dry run cannot provide checkout/,
      );
    }
    await assert.rejects(prepareAutopilotProofPublication(stored, evidence, new Map(), {}, []), /source log/);
    const duplicate = { commandIndex: 0, testRunIndex: 0 };
    await assert.rejects(
      prepareAutopilotProofPublication(stored, { ...evidence, commandResults: [duplicate, duplicate] }, source, {}, []),
      /repeated verification command/,
    );
    if (outcome === "stopped") {
      const junitFailure = structuredClone(testRun);
      const attempt = junitFailure.attempts.at(-1);
      assert.ok(attempt);
      attempt.exitCode = 0;
      attempt.totals = { tests: 1, passed: 0, failed: 1, skipped: 0 };
      const published = await prepareAutopilotProofPublication(
        stored,
        { ...evidence, testRuns: [junitFailure] },
        source,
        {},
        [],
      );
      const json = published.files.get(PROOF_FILE);
      assert.ok(json);
      const result = JSON.parse(json) as Proof;
      assert.equal(result.verify.commands[0]?.status, "failed");
      assert.equal(result.verify.commands[0]?.exitCode, 0);
    }
    await assert.rejects(
      prepareAutopilotProofPublication(
        stored,
        {
          ...evidence,
          commandResults: [{ commandIndex: 1, testRunIndex: 0 }],
        },
        source,
        {},
        [],
      ),
      /linked test run argv/,
    );
    await assert.rejects(
      prepareAutopilotProofPublication(
        {
          ...run,
          transitions: ["scan", outcome],
        },
        evidence,
        source,
        {},
        [],
      ),
      outcome === "done" ? /invalid transition/ : /recorded Autopilot turns/,
    );
    const reversed = { ...run, checkout: { ...run.checkout, baseCommit: proof.range.head } };
    await assert.rejects(
      prepareAutopilotProofPublication(
        reversed,
        {
          ...evidence,
          verify: { ...verify, before: verify.after, after: verify.before },
        },
        source,
        {},
        [],
      ),
      /must be an ancestor/,
    );
  }
});

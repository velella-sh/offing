import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { prepareAutopilotProofPublication, prepareProofPublication } from "@velella/offing/proof";

import { fixtures } from "./fixtures.mjs";

const [cli, ...args] = process.argv.slice(2);
assert(cli, "Usage: node suite.mjs <offing executable> [initial args]");
const standalone = fileURLToPath(new URL("./check.mjs", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "offing-proof-conformance-"));
const diagnostics = new Map([
  ["tampered-log", /Log SHA-256 disagrees.*stdout/],
  ["mismatched-range", /scan identities/],
  ["mismatched-diff", /diff added/],
  ["bad-schema", /Invalid proof schema/],
]);
const hash = (text) => createHash("sha256").update(text).digest("hex");
function verifyWithBoth(file, repo) {
  return [
    spawnSync(cli, [...args, "proof", "verify", file, "--repo", repo], { cwd: root, encoding: "utf8" }),
    spawnSync(process.execPath, [standalone, file, repo], { cwd: root, encoding: "utf8" }),
  ];
}

async function checkPublication(file, repo) {
  const proof = JSON.parse(await readFile(file, "utf8"));
  const secret = "synthetic publication marker";
  const contents = `log contains ${secret}\n`;
  const { logs } = proof.testRuns[0].attempts[0];
  logs.stdout.sha256 = proof.verify.commands[0].logSha256 = hash(contents);
  logs.stdout.tail = contents;
  proof.agentRuns[0].summary = secret;
  const input = new Map([[logs.stdout.sha256, contents], [logs.stderr.sha256, ""]]);
  const { files, body } = await prepareProofPublication(proof, input, { FIXTURE_MARKER: secret }, ["FIXTURE_MARKER"]);
  const folder = join(root, "published");
  await mkdir(folder);
  assert.match(body, /Outcome — done[\s\S]*<!-- offing-proof:v1 -->/);
  assert(!body.includes(secret));
  for (const [name, text] of files) {
    assert(!text.includes(secret));
    await writeFile(join(folder, name), text);
  }
  for (const result of verifyWithBoth(join(folder, "offing-proof.json"), repo)) {
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  }
}

async function checkRecordedRun(file, repo) {
  for (const state of ["done", "stopped"]) {
    const proof = JSON.parse(await readFile(file, "utf8"));
    const recordPath = join(root, state + ".run.json");
    const record = {
      schemaVersion: "offing.autopilot-run.v1",
      mode: "prepare",
      state,
      transitions: ["scan", "plan", "baseline-tests", "codemods", "agent-turn", "tests", "verify", state],
      checkout: { id: "Proof1", branch: "offing/autopilot/Proof1", baseCommit: proof.range.base },
      ...(state === "stopped" ? { stopReason: "fixture-timeout" } : {}),
    };
    await writeFile(recordPath, JSON.stringify(record));
    const secret = "synthetic recorded-run marker";
    const stdout = "fixture test ran\n";
    const stderr = state === "stopped" ? "timed out with " + secret : "";
    const attempt = proof.testRuns[0].attempts[0];
    attempt.status = state === "done" ? "passed" : "timed-out";
    attempt.exitCode = state === "done" ? 0 : null;
    attempt.totals = state === "done" ? attempt.totals : null;
    attempt.logs.stdout.sha256 = hash(stdout);
    attempt.logs.stderr.sha256 = hash(stderr);
    const command = { status: "not-run", exitCode: null, logSha256: null, purpose: "Fixture verification" };
    proof.verify.commands = ["fixture test", "fixture skipped", "fixture future"].map((text) => ({ ...command, command: text }));
    const { verify, testRuns, agentRuns, budget, tools } = proof;
    const { body, files } = await prepareAutopilotProofPublication(JSON.parse(await readFile(recordPath, "utf8")), {
      repo, verify, testRuns, agentRuns, budget, tools,
      commandResults: [{ commandIndex: 0, testRunIndex: 0 }, { commandIndex: 1, testRunIndex: null }],
    }, new Map([[hash(stdout), stdout], [hash(stderr), stderr]]), { FIXTURE_MARKER: secret }, ["FIXTURE_MARKER"]);
    const output = JSON.parse(files.get("offing-proof.json"));
    assert.deepEqual(output.range, proof.range);
    assert.deepEqual(output.agentRuns, proof.agentRuns);
    assert.equal(output.testRuns[0].attempts[0].status, attempt.status);
    const combined = "[stdout]\n" + stdout + "\n[stderr]\n" + stderr.replace(secret, "[REDACTED]");
    assert.deepEqual(output.verify.commands.map(({ status, exitCode, logSha256 }) => [status, exitCode, logSha256]), [
      [state === "done" ? "passed" : "failed", attempt.exitCode, hash(combined)],
      ["skipped", null, null],
      ["not-run", null, null],
    ]);
    assert.equal(files.get("offing-log-" + hash(combined) + ".txt"), combined);
    const human = body.split("<!-- offing-proof:v1 -->")[0];
    assert.match(human, /Outcome — (done|stopped)[\s\S]*reported turns[\s\S]*Test runs[\s\S]*1 skipped, 1 not run[\s\S]*Budget used/);
    assert(human.includes("Outcome — " + state));
    const folder = join(root, state);
    await mkdir(folder);
    for (const [name, text] of files) {
      assert(!text.includes(secret));
      await writeFile(join(folder, name), text);
    }
    for (const result of verifyWithBoth(join(folder, "offing-proof.json"), repo)) {
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    }
  }
}

try {
  const { repo, cases } = await fixtures(root);
  for (const { file, variant } of cases) {
    const diagnostic = diagnostics.get(variant);
    for (const result of verifyWithBoth(file, repo)) {
      assert.ifError(result.error);
      if (diagnostic) {
        assert(result.status > 0, variant);
        assert.match(result.stderr, diagnostic, variant);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Proof verified/);
      }
    }
    if (variant === "valid") {
      await checkPublication(file, repo);
      await checkRecordedRun(file, repo);
    }
  }
  console.log("acc-proof-bundle: installed and independent verifiers agree on five fixtures, the redacted publication, and green/stopped recorded runs with four command outcomes");
} finally {
  await rm(root, { recursive: true, force: true });
}

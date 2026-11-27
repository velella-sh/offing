import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { prepareProofPublication } from "@velella/offing/proof";

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
    if (variant === "valid") await checkPublication(file, repo);
  }
  console.log("acc-proof-bundle: installed and independent verifiers agree on five fixtures and the redacted publication");
} finally {
  await rm(root, { recursive: true, force: true });
}

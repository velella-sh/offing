import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { fixtureFiles, writeFixture } from "../src/fix/kit/fixture.js";
import { required } from "../src/required.js";

const bin = resolve(required(process.argv[2], "npm-installed Offing executable"));
const fixtures = resolve("tests/fixtures/codemods");
const cases = [
  "runtime-pins/public-toolchain",
  "python/public-packaging-config",
  "github-actions-uses/public-runtime-matrix",
  "action-runtime/idempotency",
  "kubernetes/public-api-migrations",
  "kubernetes/api-manual-cases",
];

async function load(phase: "before" | "after"): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const name of cases) {
    for (const [path, bytes] of await fixtureFiles(join(fixtures, name, phase), true)) {
      assert.equal(files.has(path), false, `Duplicate smoke input ${path}`);
      files.set(path, bytes);
    }
  }
  return files;
}

const root = await mkdtemp(join(tmpdir(), "offing-codemod-coverage-smoke-"));
try {
  const before = await load("before");
  await writeFixture(root, before);
  const preview = execFileSync(bin, ["fix", root, "--dry-run"], { encoding: "utf8", cwd: root });
  assert.match(preview, /^--- a\//m);
  assert.deepEqual(await fixtureFiles(root, false), before);
  const output = execFileSync(bin, ["fix", root, "--dry-run", "--json"], { encoding: "utf8", cwd: root });
  const plan: unknown = JSON.parse(output);
  assert.ok(typeof plan === "object" && plan !== null && "schemaVersion" in plan && "refusals" in plan);
  assert.equal(plan.schemaVersion, "offing.fix.v1");
  assert.ok(Array.isArray(plan.refusals));
  const refusals: unknown[] = plan.refusals;
  const declined = (path: string, message: string) =>
    refusals.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "path" in entry &&
        "reason" in entry &&
        entry.path === path &&
        typeof entry.reason === "string" &&
        entry.reason.includes(message),
    );
  assert.ok(declined("empty-budget.yml", "every pod"));
  assert.ok(declined("crd.yml", "structural schema"));
  assert.ok(declined("security-policy.yml", "migration packet"));

  const gitApply = ["apply", "--no-index", "--whitespace=nowarn"];
  execFileSync("git", [...gitApply, "--check", "-"], { cwd: root, input: preview });
  execFileSync("git", [...gitApply, "-"], { cwd: root, input: preview });
  assert.deepEqual(await fixtureFiles(root, false), await load("after"));
  assert.equal(execFileSync(bin, ["fix", root, "--dry-run"], { encoding: "utf8", cwd: root }), "");
  process.stdout.write("Installed fix preview, Git application, explicit refusals, and idempotence verified.\n");
} finally {
  await rm(root, { recursive: true, force: true });
}

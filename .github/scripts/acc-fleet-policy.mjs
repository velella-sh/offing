import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [installedCli, actionBundle] = process.argv.slice(2);
assert(installedCli && actionBundle, "Usage: node acc-fleet-policy.mjs <installed Offing> <Action bundle>");
const bin = resolve(installedCli);
const temp = await mkdtemp(join(tmpdir(), "offing-fleet-policy-smoke-"));
const runOptions = { cwd: temp, encoding: "utf8", timeout: 20_000 };
try {
  await writeFile(join(temp, "package.json"), '{"dependencies":{"request":"2.88.2"}}');
  await writeFile(join(temp, "org.json"), JSON.stringify({
    schemaVersion: "offing.fleet-policy.v1",
    policy: { rules: [{ id: "dependency-policy", severity: "info" }] },
  }));
  const args = ["scan", "--policy", "org.json", "--json"];
  const scan = bin.endsWith(".js") ? spawnSync(process.execPath, [bin, ...args], runOptions) : spawnSync(bin, args, runOptions);
  assert.equal(scan.status, 1, scan.stderr + scan.stdout);
  const result = JSON.parse(scan.stdout);
  assert(result.policy.violations.some(({ rule }) => rule === "dependency-policy"));

  const action = spawnSync(process.execPath, [resolve(actionBundle)], {
    ...runOptions,
    env: { ...process.env, GITHUB_WORKSPACE: temp, RUNNER_TEMP: temp, INPUT_POLICY: "org.json", "INPUT_FAIL-ON-SEVERITY": "none" },
  });
  assert.equal(action.status, 1, action.stdout + action.stderr);
  assert.match(action.stdout, /Policy rule dependency-policy failed/);
  const report = JSON.parse(await readFile(join(temp, "offing-report.json"), "utf8"));
  assert.deepEqual(report.policy.violations, result.policy.violations);
  console.log("acc-fleet-policy: packaged CLI and bundled Action evaluated the same organization policy.");
} finally {
  await rm(temp, { recursive: true, force: true });
}

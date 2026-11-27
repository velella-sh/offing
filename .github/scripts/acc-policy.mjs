import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [installedCli, actionBundle] = process.argv.slice(2);
if (!installedCli || !actionBundle) throw new Error("Usage: node acc-policy.mjs <installed offing bin> <Action bundle>");
const cwd = await mkdtemp(join(tmpdir(), "offing-policy-consumer-"));
const common = { cwd, encoding: "utf8", timeout: 20_000 };
const bin = resolve(installedCli);
const cli = (...args) => bin.endsWith(".js")
  ? spawnSync(process.execPath, [bin, ...args], common)
  : spawnSync(bin, args, common);

try {
  await writeFile(join(cwd, "package.json"), '{"engines":{"node":"22"}}');
  await writeFile(join(cwd, ".offing.json"), JSON.stringify({
    policy: {
      rules: [{ id: "node-support", severity: "info", ecosystem: "npm" }],
      exceptions: [{ path: "package.json", reason: "Earlier migration approval", expires: "2000-01-01" }],
    },
  }));
  const validation = cli("config", "validate", "--json");
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(JSON.parse(validation.stdout).valid, true);
  const scan = cli("scan", "--json", "--lookahead", "90d", "--as-of", "2027-04-01");
  assert.equal(scan.status, 1, scan.stderr);
  const result = JSON.parse(scan.stdout);
  assert.deepEqual(result.policy.violations.map(({ rule }) => rule), ["node-support", "--lookahead"]);
  assert.equal(result.policy.violations[0].expiredException.expires, "2000-01-01");
  assert.match(scan.stderr, /Policy rule node-support failed/);

  const action = spawnSync(process.execPath, [resolve(actionBundle)], {
    ...common,
    env: { ...process.env, GITHUB_WORKSPACE: cwd, RUNNER_TEMP: cwd, "INPUT_FAIL-ON-SEVERITY": "none" },
  });
  assert.equal(action.status, 1, action.stdout + action.stderr);
  assert.match(action.stdout, /Policy rule node-support failed/);
  const report = JSON.parse(await readFile(join(cwd, "offing-report.json"), "utf8"));
  assert.deepEqual(report.policy.violations, result.policy.violations.slice(0, 1));

  console.log("acc-policy passed for packaged config validation, CLI lookahead, expired exception and Action policy gate");
} finally {
  await rm(cwd, { recursive: true, force: true });
}

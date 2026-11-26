import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const source = fileURLToPath(new URL("../..", import.meta.url));
const fixture = (file) => join(source, "tests/fixtures/config-validate", file);
const [packageFile, installedCli, preCommit] = process.argv.slice(2);
if (!packageFile || !installedCli || !preCommit) {
  throw new Error("Usage: node .github/scripts/acc-config-validate.mjs <tarball> <offing-bin> <pre-commit-bin>");
}

const cwd = mkdtempSync(join(tmpdir(), "offing-config-consumer-"));
const bin = resolve(installedCli);
const hookBin = resolve(preCommit);
const env = { ...process.env, PRE_COMMIT_HOME: join(cwd, ".pre-commit-cache") };
const config = join(cwd, ".offing.json");
const run = (command, args, expected = 0) => {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, [command, ...args, "\n", result.stdout, result.stderr].join(" "));
  return result.stdout;
};
const validate = (expected) => JSON.parse(run(bin, ["config", "validate", "--json"], expected));
const runHook = (expected) => run(hookBin, ["run", "offing-config", "--all-files", "--color", "never"], expected);

try {
  run("git", ["init", "--quiet"]);
  const manifest = parse(readFileSync(join(source, ".pre-commit-hooks.yaml"), "utf8"));
  const hook = manifest.find(({ id }) => id === "offing-config");
  assert.ok(hook);
  assert.equal(hook.language, "node");
  // Use the shipping hook definition verbatim, installing the exact npm tarball under test.
  const localHook = { ...hook, additional_dependencies: [resolve(packageFile)] };
  writeFileSync(join(cwd, ".pre-commit-config.yaml"), JSON.stringify({ repos: [{ repo: "local", hooks: [localHook] }] }));
  assert.match(runHook(0), /Skipped/);

  copyFileSync(fixture("valid.json"), config);
  run("git", ["add", ".offing.json"]);
  assert.equal(validate(0).valid, true);
  assert.match(runHook(0), /Passed/);

  copyFileSync(fixture("invalid.json"), config);
  run("git", ["add", ".offing.json"]);
  const result = validate(2);
  assert.equal(result.schemaVersion, "offing.config-validation.v1");
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.diagnostics.map(({ code, line, column }) => [code, line, column]),
    [["invalid-value", 2, 13], ["deprecated-key", 3, 3], ["invalid-value", 3, 30],
     ["invalid-value", 3, 33], ["unknown-key", 4, 3]],
  );
  const rejected = runHook(1);
  assert.match(rejected, /\.offing\.json:2:13: error:/);
  assert.match(rejected, /\.offing\.json:3:3: warning: .*Use "ignore"/);
  assert.match(rejected, /\.offing\.json:4:3: error: Unknown key/);

  const commit = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  const report = [
    "### acc-config-validate",
    "",
    `- Tarball ${basename(packageFile)}`,
    `- Installed CLI version ${run(bin, ["--version"]).trim()}`,
    `- Tested commit ${commit}`,
    "- The npm CLI and pre-commit hook accepted the valid config and rejected the invalid config with source locations.",
    "",
  ].join("\n");
  process.stdout.write(report);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, report, { flag: "a" });
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

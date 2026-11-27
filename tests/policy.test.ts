import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { isIsoDate } from "@velella/ebb/registry";
import { Ajv2020 } from "ajv/dist/2020.js";

import { ConfigError, validateConfig } from "../src/config.js";
import type { LifecyclePolicy, ScanResult } from "../src/domain.js";
import { renderFailure, runGitHubAction } from "../src/github-action.js";
import { parseLookahead } from "../src/policy.js";
import { runCli } from "./cli-runner.js";

async function repository(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "offing-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "services"));
  await writeFile(join(root, "services", "package.json"), '{"engines":{"node":"22"}}');
  await writeFile(join(root, "package.json"), '{"private":true,"workspaces":["services"],"engines":{"node":"22"}}');
  return root;
}

async function writePolicy(root: string, policy: LifecyclePolicy, failOn?: string): Promise<void> {
  await writeFile(join(root, ".offing.json"), JSON.stringify({ policy, failOn }));
}

test("policy configuration grammar agrees with the published schema", async () => {
  const schema = JSON.parse(await readFile("schemas/config.v1.schema.json", "utf8"));
  const validate = new Ajv2020({ allowUnionTypes: true }).addFormat("date", isIsoDate).compile(schema);
  const rule = { id: "planned", "days-left": 90, severity: "low", path: "services/", ecosystem: "npm" };
  const exception = { path: "services/", reason: "migration", expires: "2028-02-29" };
  const valid = { policy: { rules: [rule], exceptions: [exception] } };
  assert.equal(validate(valid), true);
  assert.deepEqual(validateConfig(valid), valid);
  for (const policy of [
    null,
    [],
    {},
    { rules: [] },
    { rules: [null] },
    { rules: [rule], unexpected: true },
    { rules: [{ id: "only-id" }] },
    { rules: [{ ...rule, id: "bad id" }] },
    { rules: [{ ...rule, "days-left": -1 }] },
    { rules: [{ ...rule, "days-left": "90" }] },
    { rules: [{ ...rule, "after-eol": "true" }] },
    { rules: [{ ...rule, severity: "none" }] },
    { rules: [{ ...rule, path: " " }] },
    { rules: [{ ...rule, extra: true }] },
    { rules: [rule], exceptions: null },
    { rules: [rule], exceptions: [{ reason: "migration", expires: exception.expires }] },
    { rules: [rule], exceptions: [{ ...exception, reason: "" }] },
    { rules: [rule], exceptions: [{ ...exception, expires: "2027-02-29" }] },
  ]) {
    assert.equal(validate({ policy }), false, JSON.stringify(policy));
    assert.throws(() => validateConfig({ policy }), ConfigError);
  }
});

test("policy scopes, date boundaries, exceptions and legacy gates remain distinct", async (t) => {
  const root = await repository(t);
  const rules = [
    { id: "upgrade-service", "days-left": 29, severity: "low", ecosystem: "npm", path: "services/" },
    { id: "ended", "after-eol": true, ecosystem: "npm" },
    { id: "future-high", "after-eol": false, severity: "high" },
    { id: "other-ecosystem", ecosystem: "missing", "days-left": 0 },
  ] as LifecyclePolicy["rules"];
  const scan = (...flags: string[]) => runCli(["scan", root, "--json", ...flags]);
  await writePolicy(root, {
    rules,
    exceptions: [{ path: "services/", reason: "migration booked", expires: "2027-04-01" }],
  });
  const active = await scan("--as-of", "2027-04-01");
  assert.equal(active.code, 0, active.stderr);
  assert.deepEqual((JSON.parse(active.stdout) as ScanResult).policy?.violations, []);
  const ended = await scan("--as-of", "2027-04-30");
  assert.equal(ended.code, 1);
  assert.match(ended.stderr, /upgrade-service.*Exception expired on 2027-04-01/);
  const report = JSON.parse(ended.stdout) as ScanResult;
  const violations = report.policy?.violations ?? [];
  assert.deepEqual(
    violations.map(({ rule, path }) => [rule, path]),
    [
      ["upgrade-service", "services/package.json"],
      ["ended", "package.json"],
      ["ended", "services/package.json"],
    ],
  );
  assert.equal(violations[0]?.expiredException?.reason, "migration booked");
  const ignored = await scan("--as-of", "2027-04-30", "--ignore", "services/");
  assert.deepEqual(
    (JSON.parse(ignored.stdout) as ScanResult).policy?.violations.map(({ rule }) => rule),
    ["ended"],
  );
  const text = await runCli(["scan", root, "--as-of", "2027-04-30"]);
  assert.match(text.stdout, /Policy rule upgrade-service failed/);
  assert.match(text.stdout, /Policy rule ended failed/);

  await writePolicy(root, { rules: [{ id: "later", "after-eol": true }] }, "medium");
  const legacy = await scan("--as-of", "2027-04-01", "--min-support-days", "29");
  assert.equal(legacy.code, 1);
  assert.match(legacy.stderr, /--fail-on medium/);
  assert.equal((await scan("--as-of", "2027-04-01", "--min-support-days", "29", "--fail-on", "none")).code, 0);
});

test("lookahead validates a duration, keeps past-due findings, and reports a named rule", async (t) => {
  const root = await repository(t);
  const scan = (...flags: string[]) => runCli(["scan", root, "--json", ...flags]);
  assert.equal(parseLookahead("2w"), 14);
  assert.equal(parseLookahead("1y"), 365);
  assert.equal(parseLookahead("10y"), 3650);
  assert.equal(parseLookahead("11y"), undefined);
  assert.equal((await scan("--lookahead")).code, 2);
  assert.equal((await scan("--lookahead", "90")).code, 2);
  assert.equal((await scan("--lookahead", "1w", "--lookahead", "2w")).code, 2);
  assert.equal((await scan("--lookahead", "90d", "--today", "invalid")).code, 2);
  assert.equal((await scan("--lookahead", "28d", "--today", "2027-04-01")).code, 0);
  for (const date of ["2027-04-01", "2027-05-01"]) {
    const result = await scan("--lookahead", "29d", "--today", date);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Policy rule --lookahead failed/);
    const out = JSON.parse(result.stdout) as ScanResult;
    assert.equal(out.policy?.violations.length, 2);
  }
});

test("several repository scans apply each config and keep one JSON document", async (t) => {
  const one = await repository(t);
  const two = await repository(t);
  await writePolicy(two, { rules: [{ id: "second", "days-left": 30 }] });
  const output = await runCli(["scan", one, two, "--today", "2027-04-01", "--json"]);
  assert.equal(output.code, 1);
  const response = JSON.parse(output.stdout) as { projects: Array<{ result: ScanResult }> };
  assert.equal(response.projects.filter(({ result }) => result.policy === undefined).length, 1);
  const violations = response.projects.flatMap(({ result }) => result.policy?.violations ?? []);
  assert.deepEqual(
    violations.map(({ rule }) => rule),
    ["second", "second"],
  );
  assert.match(output.stderr, /Policy rule second failed/);
});

test("the Action reads the same policy and reports expired exceptions with the rule", async (t) => {
  const root = await repository(t);
  await writePolicy(root, {
    rules: [{ id: "service", "days-left": 90, path: "services/" }],
    exceptions: [{ ecosystem: "npm", reason: "temporary approval", expires: "2027-03-31" }],
  });
  const reportPath = join(root, "report.json");
  const outcome = await runGitHubAction({ root, reportPath, failOnSeverity: "none", today: "2027-04-01" });
  assert.equal(outcome.failed, true);
  assert.equal(outcome.gateFailed, false);
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")).policy, outcome.result.policy);
  assert.match(renderFailure(outcome) ?? "", /Policy rule service failed.*Exception expired on 2027-03-31/);
});

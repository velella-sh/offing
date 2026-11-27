import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { Ajv2020 } from "ajv/dist/2020.js";

import type { Finding, ScanResult } from "../src/domain.js";
import { buildReceipt } from "../src/receipt.js";
import { buildVerifyResult, renderVerifyResultBlock, type VerifyResult } from "../src/verify-result.js";

const execute = promisify(execFile);
const checker = resolve("docs/spec/verify/conformance/check.mjs");
const finding = (id: string): Finding => ({
  id,
  ruleId: "test.rule",
  detector: "test",
  title: id,
  summary: "fixture",
  location: { path: "package.json", line: 1 },
  severity: "medium",
  confidence: "exact",
  sources: [],
});

function scan(findings: Finding[]): ScanResult {
  return { schemaVersion: "offing.scan.v1", root: "/fixture", scannedAt: "", findings, diagnostics: [] };
}

function documentFixture(): VerifyResult {
  const before = scan([finding("z"), finding("a"), finding("m")]);
  const after = scan([finding("m"), finding("n")]);
  const result = buildVerifyResult(buildReceipt(before, after), before, after);
  result.commands = [
    { command: "A", purpose: "ran successfully", status: "passed", exitCode: 0, logSha256: "a".repeat(64) },
    { command: "B", purpose: "ran unsuccessfully", status: "failed", exitCode: 1, logSha256: "b".repeat(64) },
    { command: "C", purpose: "not run", status: "not-run", exitCode: null, logSha256: null },
    { command: "D", purpose: "not applicable", status: "skipped", exitCode: null, logSha256: null },
  ];
  return result;
}

test("passes the JSON schema and the standalone checker; the checker rejects each invariant violation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "offing-verify-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const payload = join(directory, "document.json");
  const runner = join(directory, "check.mjs");
  await writeFile(runner, await readFile(checker));
  const run = async (document: unknown) => {
    await writeFile(payload, JSON.stringify(document));
    return execute(process.execPath, [runner, payload], { cwd: directory });
  };
  const baseline = documentFixture();
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(JSON.parse(await readFile("schemas/verify-result.v1.schema.json", "utf8")));
  assert.equal(validate(baseline), true, JSON.stringify(validate.errors));
  assert.match((await run(baseline)).stdout, /valid document/);
  const badCases: Array<[string, (doc: VerifyResult) => void, RegExp]> = [
    ["shape", (doc) => Reflect.deleteProperty(doc, "commands"), /invalid result shape/],
    ["schema", (doc) => Reflect.set(doc, "schemaVersion", "old"), /unsupported schemaVersion/],
    ["identity shape", (doc) => Reflect.deleteProperty(doc.before, "commit"), /invalid scan identity shape/],
    ["commit", (doc) => (doc.before.commit = "abc"), /invalid commit/],
    ["producer version", (doc) => (doc.after.offingVersion = ""), /invalid Offing version/],
    ["data version", (doc) => (doc.after.ebbDataVersion = ""), /invalid Ebb data version/],
    ["counts", (doc) => (doc.counts.resolved += 1), /count mismatch/],
    ["ordering", (doc) => doc.resolved.reverse(), /not ordered and unique/],
    ["disjoint", (doc) => (doc.introduced = doc.remaining.slice()), /overlapping finding id/],
    ["duplicate", (doc) => doc.resolved.splice(1, 1, ...doc.resolved.slice(0, 1)), /duplicate or overlapping/],
    ["finding shape", (doc) => Reflect.deleteProperty(doc.resolved[0] ?? {}, "title"), /invalid finding shape/],
    ["finding title", (doc) => Reflect.set(doc.resolved[0] ?? {}, "title", ""), /invalid finding title/],
    [
      "finding severity",
      (doc) => Reflect.set(doc.resolved[0] ?? {}, "severity", "unknown"),
      /invalid finding severity/,
    ],
    ["finding line", (doc) => Reflect.set(doc.resolved[0] ?? {}, "line", 0), /invalid finding line/],
    ["verdict", (doc) => (doc.verdict = "passed"), /verdict disagrees/],
    ["command shape", (doc) => Reflect.deleteProperty(doc.commands[0] ?? {}, "status"), /invalid command shape/],
    [
      "unknown command status",
      (doc) => Reflect.set(doc.commands[0] ?? {}, "status", "unknown"),
      /invalid command or status/,
    ],
    [
      "unexecuted evidence",
      (doc) => Reflect.set(doc.commands[2] ?? {}, "exitCode", 0),
      /unexecuted command has evidence/,
    ],
    ["missing exit", (doc) => Reflect.set(doc.commands[0] ?? {}, "exitCode", null), /invalid exit code/],
    ["status and exit", (doc) => Reflect.set(doc.commands[0] ?? {}, "exitCode", 1), /status disagrees with exit code/],
    ["missing hash", (doc) => Reflect.set(doc.commands[0] ?? {}, "logSha256", null), /invalid log hash/],
    ["command ordering", (doc) => doc.commands.reverse(), /commands: not ordered and unique/],
  ];
  for (const [name, change, expected] of badCases) {
    const fixture = structuredClone(baseline);
    change(fixture);
    await assert.rejects(run(fixture), expected, name);
  }
});

test("rebuilds a comparison from two scans and rejects different data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "offing-verify-rebuild-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const before = scan([finding("β"), finding("a"), finding("z")]);
  const after = scan([]);
  before.identity = { commit: "a".repeat(40), offingVersion: "0.1.4" };
  after.identity = { commit: "b".repeat(40), offingVersion: "0.1.4" };
  const baseline = buildVerifyResult(buildReceipt(before, after), before, after);
  assert.deepEqual(
    baseline.resolved.map(({ id }) => id),
    ["a", "z", "β"],
  );
  assert.equal(baseline.verdict, "passed");
  const files = [join(directory, "verify.json"), join(directory, "before.json"), join(directory, "after.json")];
  const write = async (value: VerifyResult) => {
    for (const [index, payload] of [value, before, after].entries()) {
      const file = files[index];
      if (file) await writeFile(file, JSON.stringify(payload));
    }
  };
  const run = () => execute(process.execPath, [checker, ...files]);
  await write(baseline);
  assert.match((await run()).stdout, /rebuilt from two scans/);
  await write({ ...baseline, before: { ...baseline.before, commit: "c".repeat(40) } });
  await assert.rejects(run(), /before identity differs/);
  const changed = structuredClone(baseline);
  const first = changed.resolved[0];
  assert.ok(first);
  first.title = "not in the scan";
  await write(changed);
  await assert.rejects(run(), /resolved differs from scan comparison/);
});

test("the PR receipt uses an artifact reference above the UTF-8 block limit", () => {
  const document = documentFixture();
  assert.match(renderVerifyResultBlock(document), /^<!-- offing-verify-result:v1 -->\n```json\n/);
  const first = document.resolved[0];
  assert.ok(first);
  first.title = "پ".repeat(26_000);
  assert.equal(
    renderVerifyResultBlock(document),
    "<!-- offing-verify-result:v1 -->\nArtifact: `offing-verify-result.json`\n",
  );
});

test("branch JSON, saved-scan CLI receipt and the embedded PR document agree", async () => {
  const { stdout } = await execute(
    process.execPath,
    [".github/scripts/acc-verify-contract.mjs", resolve("dist/src/cli.js")],
    { env: { ...process.env, OFFING_DATA_VERSION: "bundled", OFFING_NO_CACHE: "1" } },
  );
  assert.match(stdout, /branch fix, receipt, pull request block and independent comparison agree/);
});

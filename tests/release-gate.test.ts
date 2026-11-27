import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import { isIsoDate } from "@velella/ebb/registry";

import { git } from "../src/diff.js";
import { readReleaseGateDays, releaseGateSummary, runReleaseGate } from "../src/github-action/release-gate.js";
import { runGitHubAction } from "../src/github-action/run.js";
import { renderFailure } from "../src/github-action/render.js";
import {
  decideRelease,
  gateWindow,
  type GateReport,
  type LifecycleObservation,
  type NoDataMode,
} from "../src/release-gate/decision.js";
import { runCli } from "./cli-runner.js";

const sbom = resolve("tests/fixtures/release-gate/blocked.cdx.json");
const today = ["--today", "2026-03-31"];
const env = { OFFING_DATA_VERSION: "bundled" };
const cli = (args: string[], cwd?: string) => runCli(args, { ...(cwd ? { cwd } : {}), env });

async function fixture(t: { after(callback: () => Promise<void>): void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "offing-release-gate-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function commit(root: string, tag: string): void {
  git(root, ["add", "."]);
  git(root, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", tag]);
  git(root, ["tag", tag]);
}

test("gate conforms to downloaded UTC, exception and missing-evidence examples", async () => {
  const vectors: {
    asOf: string;
    supportUntil: string;
    cases: Array<{ name: string; noData: NoDataMode; deadline?: string; expires?: string; expected: unknown[] }>;
  } = JSON.parse(await readFile("docs/spec/release-gate/conformance/fixtures.json", "utf8"));
  for (const { name, noData, deadline, expires, expected } of vectors.cases) {
    const window = gateWindow(vectors.asOf, undefined, vectors.supportUntil, noData);
    const rule = {
      id: "npm.example.support",
      event: "end-of-support",
      date: deadline,
      sources: ["https://example.com"],
    } as const;
    const observation: LifecycleObservation = {
      component: "example",
      detector: "npm",
      ...(deadline ? { rule: { ...rule, date: deadline } } : {}),
    };
    const exceptions = expires ? [{ ecosystem: "npm", expires, reason: "Transition" }] : [];
    const decision = decideRelease({ kind: "path", target: "." }, [observation], window, exceptions);
    const reason = decision.reasons[0];
    assert.deepEqual(
      [decision.verdict, reason?.outcome, reason?.daysLeft].filter((item) => item !== undefined),
      expected,
      name,
    );
  }
  assert.match(
    execFileSync(process.execPath, ["docs/spec/release-gate/conformance/check.mjs"], { encoding: "utf8" }),
    /9 standalone decision fixtures passed/,
  );
});

test("packed-format CLI reports consistent SBOM verdicts in text, JSON and SARIF", async () => {
  const args = ["release-gate", ...today, "--sbom", sbom, "--within-days", "1"];
  const [text, json, sarif] = [
    await cli(args),
    await cli([...args, "--json"]),
    await cli([...args, "--format", "sarif"]),
  ];
  assert.deepEqual([text.code, json.code, sarif.code], [1, 1, 1]);
  assert.match(text.stdout, /container.alpine.eol-3.20-and-older ends 2026-04-01 \(1 days left\)/);
  const result: GateReport = JSON.parse(json.stdout);
  const schema: object = JSON.parse(await readFile("schemas/release-gate.v1.schema.json", "utf8"));
  const ajv = new Ajv2020({ strictRequired: false, strictTypes: false }).addFormat("date", isIsoDate);
  const validate = ajv.compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  const log = JSON.parse(sarif.stdout);
  assert.equal(log.runs[0].results[0].level, "error");
  assert.deepEqual(log.runs[0].properties.offingReleaseGate, result);
  const pass = await cli(["release-gate", "--sbom", sbom, ...today, "--support-until", "2026-03-31"]);
  assert.equal(pass.code, 0);
  assert.match(pass.stdout, /PASS/);
});

test("Git decisions scan exact tags, ignore export filters and preserve dirty working files", async (t) => {
  const root = await fixture(t);
  git(root, ["init", "-q"]);
  await writeFile(join(root, ".gitattributes"), "mise.toml export-ignore\n");
  await writeFile(join(root, "mise.toml"), '[tools]\nnode = "18"\n');
  commit(root, "v1.0.0");
  await writeFile(join(root, "mise.toml"), '[tools]\nnode = "24"\n');
  commit(root, "v2.0.0");
  await writeFile(join(root, "mise.toml"), '[tools]\nnode = "20"\n');
  const before = git(root, ["status", "--porcelain"]).toString();
  const sent = await cli(["release-gate", "v1.0.0", "--today", "2025-04-01", "--within-days", "29"], root);
  assert.equal(sent.code, 1, sent.stderr);
  assert.match(sent.stdout, /nodejs.runtime.eol-18 ends 2025-04-30/);
  const rollback = await cli(
    [
      "rollback-readiness",
      "v2.0.0",
      "--candidate",
      "v2.0.0",
      "--candidate",
      "v1.0.0",
      "--today",
      "2025-04-01",
      "--within-days",
      "29",
      "--json",
    ],
    root,
  );
  assert.equal(rollback.code, 1, rollback.stderr);
  const report: GateReport = JSON.parse(rollback.stdout);
  assert.equal(report.releaseRef, "v2.0.0");
  assert.deepEqual(
    report.decisions.map(({ input, verdict }) => [input.target, verdict]),
    [
      ["v2.0.0", "pass"],
      ["v1.0.0", "block"],
    ],
  );
  assert.equal(git(root, ["status", "--porcelain"]).toString(), before);
  assert.match(await readFile(join(root, "mise.toml"), "utf8"), /20/);
  const invalid = await cli(["rollback-readiness", "HEAD", "--candidate", "HEAD"], root);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /refs\/tags\/HEAD/);
});

test("the path adapter applies matching policy exceptions and ignores unrelated or deprecation-only evidence", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "mise.toml"), '[tools]\nnode = "18"\n');
  await writeFile(join(root, "package.json"), '{"dependencies":{"request":"2.88.2"}}');
  await writeFile(
    join(root, ".offing.json"),
    JSON.stringify({
      policy: {
        rules: [{ id: "lifecycle", severity: "high" }],
        exceptions: [
          { path: "other.toml", reason: "Unrelated", expires: "2025-03-31" },
          { ecosystem: "nodejs", path: "mise.toml", reason: "Migration scheduled", expires: "2025-04-01" },
        ],
      },
    }),
  );
  const args = ["release-gate", ".", "--within-days", "30"];
  const active = await cli([...args, "--today", "2025-04-01"], root);
  assert.equal(active.code, 0, active.stderr);
  assert.match(active.stdout, /\[excepted\].+Migration scheduled/);
  assert.doesNotMatch(active.stdout, /package.request/);
  const expired = await cli([...args, "--today", "2025-04-02"], root);
  assert.equal(expired.code, 1, expired.stderr);
  assert.match(expired.stdout, /Exception expired on 2025-04-01/);
});

test("report missing SBOM versions, unknown packages and missing PURLs with the selected policy", async (t) => {
  const root = await fixture(t);
  const file = join(root, "inventory.cdx.json");
  await writeFile(
    file,
    JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      components: [
        { purl: "pkg:docker/library/alpine" },
        { purl: "pkg:npm/offing-release-gate-no-data" },
        { name: "incomplete" },
      ],
    }),
  );
  for (const [mode, code, verdict] of [
    ["warn", 0, "warn"],
    ["fail", 1, "block"],
    ["ignore", 0, "pass"],
  ]) {
    const result = await cli(["release-gate", "--sbom", file, ...today, "--no-data", String(mode), "--json"], root);
    assert.equal(result.code, code, result.stderr);
    const report: GateReport = JSON.parse(result.stdout);
    assert.equal(report.decisions[0]?.verdict, verdict);
    assert.equal(report.decisions[0]?.reasons.length, mode === "ignore" ? 0 : 3);
  }
  await writeFile(file, '{"bomFormat":"CycloneDX","specVersion":"1.5"}');
  assert.match((await cli(["release-gate", "--sbom", file], root)).stdout, /empty SBOM/);
  await writeFile(file, "{");
  assert.equal((await cli(["release-gate", "--sbom", file], root)).code, 4);
});

test("invalid syntax and dates use documented errors", async () => {
  for (const [args, code] of [
    [[], 2],
    [[".", "--sbom", sbom], 2],
    [["--attestation", "x"], 2],
    [[".", "--repo", "a/b"], 2],
    [[".", "--within-days", "-3"], 2],
    [[".", "--within-days", "1", "--support-until", "2030-01-01"], 2],
    [[".", "--json", "--format", "text"], 2],
    [[".", "--format", "yaml"], 2],
    [["--unknown"], 2],
    [[".", "--today", "2026-02-30"], 4],
    [[".", ...today, "--support-until", "2024-01-01"], 4],
    [[".", "--no-data", "safe"], 2],
    [[sbom], 2],
    [[".", "--within-days", "9007199254740991"], 2],
  ] as const) {
    assert.equal((await cli(["release-gate", ...args])).code, code, String(args));
  }
});

test("Action gate fails separately from severity and writes readable summaries for clean consumers", async (t) => {
  const root = await fixture(t);
  const source = { root, reportPath: join(root, "scan.json"), failOnSeverity: "none" as const, today: "2026-03-31" };
  const clean = await runGitHubAction({ ...source, releaseGateDays: 1 });
  assert.equal(clean.failed, false);
  assert.match(releaseGateSummary(clean.releaseGate), /PASS \./);
  const blocked = await runGitHubAction({
    ...source,
    root: dirname(sbom),
    sbom: "blocked.cdx.json",
    releaseGateDays: 1,
  });
  assert.equal(blocked.failed, true);
  assert.equal(blocked.gateFailed, false);
  assert.match(renderFailure(blocked) ?? "", /release blocked by lifecycle policy/);
  assert.match(releaseGateSummary(blocked.releaseGate), /Release gate[\s\S]*BLOCK blocked.cdx.json/);
  assert.equal(releaseGateSummary(undefined), "");
  assert.equal(readReleaseGateDays("  "), undefined);
  assert.equal(readReleaseGateDays(" 0 "), 0);
  assert.throws(() => readReleaseGateDays("-1"), /non-negative/);
  await assert.rejects(
    runReleaseGate(root, { ...source, releaseGateDays: 1, mode: "diff" }, undefined, source.today),
    /one root/,
  );
});

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";

import { parse as parseYaml } from "yaml";

import { addReviewDetails } from "../src/action-agent-review-details.js";
import { markAgentComment, publishAgentReview } from "../src/action-agent-review-store.js";
import { createBaseline, writeBaseline } from "../src/baseline.js";
import { builtInDetectors } from "../src/detectors/index.js";
import { scanRepository } from "../src/engine/index.js";
import type { Finding } from "../src/domain.js";
import { renderBadgeSvg } from "../src/badge.js";
import { renderBadge, renderFailure, runGitHubAction } from "../src/github-action.js";
import { changedLines } from "../src/github-action/diff.js";
import { validateMigrationPacket } from "../src/migration-packet.js";

import { copyFixtureTree } from "./fixture-copies.js";

const fixtureRoots: string[] = [];
const smokeFixture = await copyFixtureTree(resolve("tests/fixtures/smoke"), fixtureRoots);
after(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true })));
});

const UPLOAD_ARTIFACT = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9";

const temporaryRoots: string[] = [];

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "offing-action-"));
  temporaryRoots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ engines: { node: "20" } }));
  return root;
}

async function runActionFixture(
  root: string,
  inputs: Record<string, string> = {},
  entry = resolve("dist/src/action.js"),
): Promise<{ code: number; stdout: string; outputs: string; summary: string }> {
  const runner = join(root, ".runner");
  const output = join(runner, "outputs.txt");
  const summary = join(runner, "summary.md");
  await mkdir(runner, { recursive: true });
  await Promise.all([writeFile(output, ""), writeFile(summary, "")]);

  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      GITHUB_WORKSPACE: root,
      RUNNER_TEMP: runner,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      INPUT_ATTRIBUTION: "false",
      ...inputs,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number>((resolveCode, reject) => {
    child.once("error", reject);
    child.once("close", (status) => resolveCode(status ?? 1));
  });
  assert.equal(stderr, "");
  return { code, stdout, outputs: await readFile(output, "utf8"), summary: await readFile(summary, "utf8") };
}

test("the standalone v1 conformance runner verifies the failure gate, dated outputs and local SARIF", async () => {
  const root = await fixtureRepository();
  const workflows = join(root, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  await writeFile(join(workflows, "ci.yml"), "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n");
  const gate = await runActionFixture(root, { INPUT_SARIF: "true" });
  assert.equal(gate.code, 1);
  const outputs = Object.fromEntries(
    gate.outputs
      .trimEnd()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  const verifier = resolve("docs/spec/action/conformance/run.mjs");
  const result = execFileSync(process.execPath, [verifier, "gate", "failure"], { input: JSON.stringify(outputs) });
  assert.match(result.toString(), /acc-action-v1: gate passed/);

  const sarif = outputs["sarif-path"];
  assert.ok(sarif);
  const profileChecker = resolve("docs/spec/sarif/conformance/check.mjs");
  const profile = execFileSync(process.execPath, [profileChecker, sarif], { encoding: "utf8" });
  assert.match(profile, /acc-sarif-profile: profile v1 passed/);

  const cleanRoot = await fixtureRepository();
  await writeFile(join(cleanRoot, "package.json"), JSON.stringify({ private: true }));
  const clean = await runActionFixture(cleanRoot);
  assert.equal(clean.code, 0);
  assert.match(clean.outputs, /^next-eol-days=$/m);
  assert.doesNotMatch(clean.outputs, /^sarif-path=/m);
});

test("the GitHub Action reports only regressions and enforces severity gates", async () => {
  const root = await fixtureRepository();
  const baselinePath = join(root, ".offing-baseline.json");
  await writeBaseline(baselinePath, createBaseline(await scanRepository(root, builtInDetectors)));
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(root, ".github", "workflows", "ci.yml"),
    "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n",
  );

  const reportPath = join(root, "reports", "offing.json");
  const outcome = await runGitHubAction({
    root,
    baselinePath,
    reportPath,
    failOnSeverity: "high",
  });

  assert.equal(outcome.result.findings.length, 1);
  assert.match(outcome.result.diagnostics.at(-1) ?? "", /Suppressed 1 finding/);
  assert.equal(outcome.failed, true);
  assert.equal(
    renderFailure(outcome),
    `Offing failed: 1 finding met or exceeded the high severity gate. JSON report: ${reportPath}. Next steps: review the annotations and JSON report, then fix the findings or update the baseline and rerun Offing.`,
  );
  assert.deepEqual(outcome.annotations[0], {
    level: "error",
    title: "Offing: Unsupported actions/checkout runtime",
    message: `${outcome.result.findings[0]?.summary}\nReplacement: actions/checkout@v5 or later\nFinding: ${outcome.result.findings[0]?.id}`,
    location: { path: ".github/workflows/ci.yml", line: 4 },
  });
  const report = JSON.parse(await readFile(reportPath, "utf8")) as { findings: unknown[] };
  assert.equal(report.findings.length, 1);

  const criticalOnly = await runGitHubAction({
    root,
    baselinePath,
    reportPath: join(root, "critical.json"),
    failOnSeverity: "critical",
  });
  assert.equal(criticalOnly.failed, false);
});

test("representative public, private, and no-findings Action runs honor baselines and gates", async () => {
  const publicRoot = await mkdtemp(join(tmpdir(), "offing-action-public-"));
  temporaryRoots.push(publicRoot);
  await writeFile(join(publicRoot, "package.json"), JSON.stringify({ engines: { node: "24" } }));
  await mkdir(join(publicRoot, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(publicRoot, ".github", "workflows", "ci.yml"),
    "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n",
  );
  const publicRun = await runActionFixture(publicRoot, { "INPUT_FAIL-ON-SEVERITY": "high" });
  assert.equal(publicRun.code, 1, "a public repository without a baseline fails its configured gate");
  assert.match(publicRun.stdout, /Offing policy gate failed/);
  assert.match(publicRun.stdout, /1 finding met or exceeded the high severity gate/);
  assert.match(
    publicRun.stdout,
    new RegExp(
      `JSON report: ${join(publicRoot, ".runner", "offing-report.json").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ),
  );
  assert.match(publicRun.outputs, /finding-count=1/);

  const privateRoot = await fixtureRepository();
  const baseline = join(privateRoot, ".offing-baseline.json");
  await writeBaseline(baseline, createBaseline(await scanRepository(privateRoot, builtInDetectors)));
  const privateRun = await runActionFixture(privateRoot, {
    INPUT_BASELINE: ".offing-baseline.json",
    "INPUT_FAIL-ON-SEVERITY": "high",
  });
  assert.equal(privateRun.code, 0, "a private repository can keep known findings in a local baseline");
  assert.match(privateRun.outputs, /finding-count=0/);
  assert.match(privateRun.summary, /Found \*\*0\*\* new lifecycle findings; passed the severity gate\./);

  const cleanRoot = await mkdtemp(join(tmpdir(), "offing-action-clean-"));
  temporaryRoots.push(cleanRoot);
  await writeFile(join(cleanRoot, "package.json"), JSON.stringify({ engines: { node: "24" } }));
  const cleanRun = await runActionFixture(cleanRoot, { "INPUT_FAIL-ON-SEVERITY": "high" });
  assert.equal(cleanRun.code, 0);
  assert.match(cleanRun.outputs, /finding-count=0/);
  assert.match(cleanRun.stdout, /Offing found 0 new lifecycle findings\./);
});

test("the GitHub Action rejects an invalid severity gate", async () => {
  const root = await fixtureRepository();
  await assert.rejects(
    runGitHubAction({
      root,
      reportPath: join(root, "report.json"),
      failOnSeverity: "urgent" as never,
    }),
    /Invalid severity gate: urgent/,
  );
});

test("action metadata packages the scan and report upload as a reusable action", async () => {
  const metadata = parseYaml(await readFile(resolve("action.yml"), "utf8")) as {
    runs?: { using?: string; steps?: Array<{ run?: string; uses?: string; if?: string }> };
  };
  assert.equal(metadata.runs?.using, "composite");
  assert.ok(metadata.runs?.steps?.some((step) => step.run?.includes("dist/action/index.js")));
  assert.ok(
    metadata.runs?.steps?.some(
      (step) =>
        step.uses === UPLOAD_ARTIFACT &&
        step.if === "always() && inputs.upload-report == 'true' && steps.scan.outputs.report-path != ''",
    ),
  );
});

test("the GitHub Action writes SARIF only when asked, and it matches the report", async () => {
  const root = await fixtureRepository();
  const reportPath = join(root, "reports", "offing.json");

  const without = await runGitHubAction({ root, reportPath, failOnSeverity: "none" });
  assert.equal(without.sarifPath, undefined);

  const sarifPath = join(root, "reports", "offing.sarif");
  const outcome = await runGitHubAction({ root, reportPath, sarifPath, failOnSeverity: "none" });
  assert.equal(outcome.sarifPath, sarifPath);
  const sarif = JSON.parse(await readFile(sarifPath, "utf8")) as {
    version: string;
    runs: Array<{
      results: Array<{ ruleId: string; locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }>;
    }>;
  };
  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    findings: Array<{ ruleId: string; location: { path: string } }>;
  };
  assert.equal(sarif.version, "2.1.0");
  assert.deepEqual(
    sarif.runs[0]!.results.map((result) => [
      result.ruleId,
      result.locations[0]!.physicalLocation.artifactLocation.uri,
    ]).sort(),
    report.findings.map((finding) => [finding.ruleId, finding.location.path]).sort(),
  );
});

test("action metadata declares the optional SARIF upload to code scanning", async () => {
  const metadata = parseYaml(await readFile(resolve("action.yml"), "utf8")) as {
    inputs?: Record<string, { default?: string }>;
    outputs?: Record<string, unknown>;
    runs?: { steps?: Array<{ uses?: string; if?: string; with?: Record<string, string> }> };
  };
  assert.equal(metadata.inputs?.["upload-sarif"]?.default, "false");
  assert.ok(metadata.outputs?.["sarif-path"]);
  const upload = metadata.runs?.steps?.find((step) => step.uses?.startsWith("github/codeql-action/upload-sarif@"));
  assert.ok(upload, "an upload-sarif step exists");
  assert.match(upload.if ?? "", /inputs\.upload-sarif == 'true'/);
  assert.match(upload.if ?? "", /steps\.scan\.outputs\.sarif-path != ''/);
  assert.equal(upload.with?.sarif_file, "${{ steps.scan.outputs.sarif-path }}");
});

const finding = (id: string, severity: Finding["severity"], title: string, path: string, line?: number): Finding => ({
  id,
  ruleId: id.split(":")[0]!,
  detector: "npm",
  title,
  summary: "s",
  severity,
  confidence: "exact",
  location: line === undefined ? { path } : { path, line },
  sources: [{ title: "Vendor | notice", url: "https://example.com/notice" }],
});

const data = {
  source: "bundled" as const,
  version: "0.2.0",
  createdAt: null,
  reviewedThrough: "2026-10-17",
  ageDays: 3,
  stale: false,
};

test("the job summary snapshot: severity counts, top findings with evidence, data age, and attribution", async () => {
  const { renderSummary } = await import("../src/github-action.js");
  const findings = [
    finding("a.low:p:1", "low", "Low one", "a/package.json", 3),
    finding("b.high:p:2", "high", "High | one", "package.json", 7),
    finding("c.high:p:3", "high", "High two", ".nvmrc"),
    finding("d.critical:p:4", "critical", "Critical one", "Dockerfile", 2),
  ];
  assert.equal(
    renderSummary(findings, true, "high", data, true),
    [
      "## Offing",
      "",
      "Found **4** new lifecycle findings; failed the **high** severity gate.",
      "",
      "| Severity | Findings |",
      "|---|---|",
      "| critical | 1 |",
      "| high | 2 |",
      "| low | 1 |",
      "",
      "| Severity | Finding | Location | Evidence |",
      "|---|---|---|---|",
      "| critical | Critical one | `Dockerfile:2` | [Vendor \\| notice](https://example.com/notice) |",
      "| high | High \\| one | `package.json:7` | [Vendor \\| notice](https://example.com/notice) |",
      "| high | High two | `.nvmrc` | [Vendor \\| notice](https://example.com/notice) |",
      "| low | Low one | `a/package.json:3` | [Vendor \\| notice](https://example.com/notice) |",
      "",
      "Data: bundled 0.2.0, evidence reviewed through 2026-10-17 (3 days ago)",
      "",
      "<sub>Scanned by [Offing](https://github.com/velella-sh/offing)</sub>",
      "",
    ].join("\n"),
  );
});

test("the summary lists at most ten findings, says how many more there are, and warns about stale data", async () => {
  const { renderSummary } = await import("../src/github-action.js");
  const many = Array.from({ length: 13 }, (_, index) =>
    finding(`r${String(index).padStart(2, "0")}:p:1`, "medium", `Finding ${index}`, "package.json", index + 1),
  );
  const text = renderSummary(many, false, "high", { ...data, stale: true, ageDays: 40 }, false);
  assert.equal(text.split("\n").filter((line) => line.startsWith("| medium | Finding")).length, 10);
  assert.match(text, /…and 3 more; the JSON report lists every finding\./);
  assert.match(text, /\| medium \| 13 \|/);
  assert.match(text, /> \*\*Warning:\*\* the lifecycle data is stale/);
  assert.equal(text.includes("Scanned by"), false, "attribution off");
});

test("with no findings the summary has no tables, and the attribution line can be switched off", async () => {
  const { ATTRIBUTION_LINE, renderSummary } = await import("../src/github-action.js");
  assert.equal(
    renderSummary([], false, "high", undefined, true),
    `## Offing\n\nFound **0** new lifecycle findings; passed the severity gate.\n\n${ATTRIBUTION_LINE}\n`,
  );
  assert.equal(
    renderSummary([], false, "high", undefined, false),
    "## Offing\n\nFound **0** new lifecycle findings; passed the severity gate.\n",
  );
  assert.match(ATTRIBUTION_LINE, /\[Offing\]\(https:\/\/github\.com\/velella-sh\/offing\)/);
});

test("action.yml declares the attribution input, on by default, and passes it to the scan step", async () => {
  const { readFile } = await import("node:fs/promises");
  const { parse } = await import("yaml");
  const action = parse(await readFile("action.yml", "utf8")) as {
    inputs: Record<string, { default?: string }>;
    runs: { steps: Array<{ env?: Record<string, string> }> };
  };
  assert.equal(action.inputs.attribution?.default, "true");
  assert.equal(action.runs.steps[0]?.env?.INPUT_ATTRIBUTION, "${{ inputs.attribution }}");
});

test("the Action runner warns about suppressions that expire soon, for the day it is given", async () => {
  const directory = await mkdtemp(join(tmpdir(), "offing-action-expiry-"));
  try {
    const smoke = smokeFixture;
    const scan = await scanRepository(smoke, builtInDetectors);
    const baseline = join(directory, "baseline.json");
    await writeBaseline(baseline, createBaseline(scan, { owner: "platform", expires: "2026-11-05" }));
    const options = { root: smoke, reportPath: join(directory, "report.json"), baselinePath: baseline };
    const lines = async (extra: object) =>
      (await runGitHubAction({ ...options, ...extra })).result.diagnostics.filter((line) =>
        line.startsWith("Baseline suppression expires"),
      );
    assert.equal((await lines({ today: "2026-10-25" })).length, 4);
    assert.equal((await lines({ today: "2026-10-01" })).length, 0);
    assert.equal((await lines({ today: "2026-10-01", baselineWarnDays: 60 })).length, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("action.yml declares baseline-warn-days with a 14-day default and passes it to the scan step", async () => {
  const action = parseYaml(await readFile("action.yml", "utf8")) as {
    inputs: Record<string, { default?: string }>;
    runs: { steps: Array<{ env?: Record<string, string> }> };
  };
  assert.equal(action.inputs["baseline-warn-days"]?.default, "14");
  assert.equal(action.runs.steps[0]?.env?.["INPUT_BASELINE-WARN-DAYS"], "${{ inputs.baseline-warn-days }}");
});

test("the Action runner brings back an expired suppression and fails the job only under the fail policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "offing-action-policy-"));
  try {
    const smoke = smokeFixture;
    const scan = await scanRepository(smoke, builtInDetectors);
    const baseline = join(directory, "baseline.json");
    await writeBaseline(baseline, createBaseline(scan, { expires: "2026-10-01" }));
    const options = {
      root: smoke,
      reportPath: join(directory, "report.json"),
      baselinePath: baseline,
      today: "2026-10-17",
      failOnSeverity: "none" as const,
    };
    const resurface = await runGitHubAction(options);
    assert.equal(resurface.result.findings.length, scan.findings.length);
    assert.equal(resurface.failed, false, "resurface does not fail a job whose gate is none");
    assert.equal(resurface.expiredFailure, false);
    const strict = await runGitHubAction({ ...options, onExpired: "fail" });
    assert.equal(strict.failed, true);
    assert.equal(strict.gateFailed, false, "the severity gate was not the reason");
    assert.equal(strict.expiredFailure, true);
    assert.equal(
      renderFailure(strict),
      `Offing failed: 4 baseline suppressions expired while on-expired is fail. JSON report: ${options.reportPath}. Next steps: review the annotations and JSON report, then fix the findings or update the baseline and rerun Offing.`,
    );
    const early = await runGitHubAction({ ...options, onExpired: "fail", today: "2026-09-01" });
    assert.equal(early.failed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("action.yml declares on-expired, defaulting to resurface, and passes it to the scan step", async () => {
  const action = parseYaml(await readFile("action.yml", "utf8")) as {
    inputs: Record<string, { default?: string }>;
    runs: { steps: Array<{ env?: Record<string, string> }> };
  };
  assert.equal(action.inputs["on-expired"]?.default, "resurface");
  assert.equal(action.runs.steps[0]?.env?.["INPUT_ON-EXPIRED"], "${{ inputs.on-expired }}");
});

test("the job summary shows the baseline counts and the suppressions that are expiring or expired", async () => {
  const { renderSummary } = await import("../src/github-action.js");
  const text = renderSummary([], false, "high", undefined, false, {
    suppressed: 5,
    today: "2026-10-17",
    warnWithinDays: 14,
    expiring: [
      { ruleId: "nodejs.runtime.eol-18", path: "package.json", expires: "2026-10-20", daysLeft: 3, owner: "platform" },
    ],
    expired: [{ ruleId: "npm.package.request.deprecated", path: "a/package.json", expires: "2026-10-10", daysAgo: 7 }],
  });
  assert.match(text, /Baseline: 5 findings suppressed, 1 expiring within 14 days, 1 expired\./);
  assert.match(
    text,
    /\| npm\.package\.request\.deprecated \| `a\/package\.json` \| expired 7 days ago \(2026-10-10\) \| — \|/,
  );
  assert.match(
    text,
    /\| nodejs\.runtime\.eol-18 \| `package\.json` \| expires in 3 days \(2026-10-20\) \| platform \|/,
  );
  assert.equal(renderSummary([], false, "high", undefined, false).includes("Baseline:"), false, "no baseline, no line");
});

test("badge endpoints count remaining findings, warn about stale data, and honor expiry failures", () => {
  for (const [severity, color] of [
    ["critical", "#9A3F5E"],
    ["high", "#9A3F5E"],
    ["medium", "#C9822F"],
    ["low", "#B89B3C"],
    ["info", "#727169"],
  ] as const) {
    const findings = [
      finding("a:p:1", "info", "Info", "secret.json"),
      finding("b:p:1", severity, "Title", "private.json"),
    ];
    assert.deepEqual(JSON.parse(renderBadge({ findings })), {
      schemaVersion: 1,
      label: "offing",
      message: `2 ${severity}`,
      color,
      labelColor: "#1F1F28",
    });
  }
  assert.deepEqual(JSON.parse(renderBadge({ findings: [] })), {
    schemaVersion: 1,
    label: "offing",
    message: "clean",
    color: "#6A5590",
    labelColor: "#1F1F28",
  });
  assert.deepEqual(JSON.parse(renderBadge({ findings: [], data: { ...data, stale: true } })), {
    schemaVersion: 1,
    label: "offing",
    message: "stale",
    color: "#727169",
    labelColor: "#1F1F28",
  });
  assert.equal(
    JSON.parse(
      renderBadge({ findings: [finding("r:p:1", "low", "Low", "package.json")], data: { ...data, stale: true } }),
    ).message,
    "1 low · stale",
  );
  assert.deepEqual(JSON.parse(renderBadge({ findings: [finding("r:p:1", "low", "Low", "package.json")] }, true)), {
    schemaVersion: 1,
    label: "offing",
    message: "1 low · expired",
    color: "#6E2B44",
    labelColor: "#1F1F28",
  });
  assert.equal(JSON.parse(renderBadge({ findings: [] }, true)).message, "expired");
});

test("the SVG badge carries the same message and color, with a fixed-width layout", () => {
  const svg = renderBadgeSvg({ findings: [finding("r:p:1", "high", "High", "package.json")] });
  assert.match(svg, /^<svg [^>]*role="img" aria-label="offing: 1 high"/);
  assert.match(svg, /<title>offing: 1 high<\/title>/);
  assert.match(svg, /fill="#9A3F5E"/);
  assert.match(svg, /textLength="340"[^>]*>offing<\/text>/);
  assert.match(renderBadgeSvg({ findings: [] }), /fill="#6A5590"[^>]*\/>/);
  assert.equal(
    renderBadgeSvg({ findings: [] }).includes("package.json"),
    false,
    "no paths or titles leak into the badge",
  );
});

test("the badge is opt-in and is generated after baseline comparison even when the gate fails", async () => {
  const root = await fixtureRepository();
  const run = await runActionFixture(root);
  assert.equal(run.outputs.includes("badge-path="), false);
  await assert.rejects(readFile(join(root, ".runner", "offing-badge.json")), { code: "ENOENT" });
  const enabled = await runActionFixture(root, { "INPUT_UPLOAD-BADGE": "true", "INPUT_FAIL-ON-SEVERITY": "medium" });
  assert.equal(enabled.code, 1);
  const badgePath = join(root, ".runner", "offing-badge.json");
  assert.ok(enabled.outputs.includes(`badge-path=${badgePath}`));
  assert.match(JSON.parse(await readFile(badgePath, "utf8")).message, /^1 medium/);
  const svgPath = join(root, ".runner", "offing-badge.svg");
  assert.ok(enabled.outputs.includes(`badge-svg-path=${svgPath}`));
  assert.match(await readFile(svgPath, "utf8"), /aria-label="offing: 1 medium"/);
  const baselinePath = join(root, "baseline.json");
  await writeBaseline(baselinePath, createBaseline(await scanRepository(root, builtInDetectors)));
  const outcome = await runGitHubAction({ root, reportPath: join(root, "report.json"), baselinePath, badgePath });
  assert.equal(outcome.badgePath, badgePath);
  assert.match(JSON.parse(await readFile(badgePath, "utf8")).message, /^clean$/);
});

test("badge upload is opt-in and skips scans that produced no endpoint", async () => {
  const action = parseYaml(await readFile("action.yml", "utf8")) as {
    inputs: Record<string, { default?: string }>;
    outputs: Record<string, { value: string }>;
    runs: {
      steps: Array<{
        env?: Record<string, string>;
        name?: string;
        if?: string;
        uses?: string;
        with?: Record<string, unknown>;
      }>;
    };
  };
  assert.equal(action.inputs["upload-badge"]?.default, "false");
  assert.equal(action.outputs["badge-path"]?.value, "${{ steps.scan.outputs.badge-path }}");
  assert.equal(action.runs.steps[0]?.env?.["INPUT_UPLOAD-BADGE"], "${{ inputs.upload-badge }}");
  const upload = action.runs.steps.find((step) => step.name === "Upload README badge endpoint");
  assert.equal(upload?.if, "always() && inputs.upload-badge == 'true' && steps.scan.outputs.badge-path != ''");
  assert.equal(upload?.uses, UPLOAD_ARTIFACT);
  assert.equal(upload?.with?.path, "${{ steps.scan.outputs.badge-path }}\n${{ steps.scan.outputs.badge-svg-path }}\n");
  assert.equal(action.outputs["badge-svg-path"]?.value, "${{ steps.scan.outputs.badge-svg-path }}");
});

test("the pull request comment starts with the marker and re-runs update that comment instead of adding another", async () => {
  const { PR_COMMENT_MARKER, renderComment } = await import("../src/github-action.js");
  const { upsertPullRequestComment } = await import("../src/pr-comment.js");
  const body = renderComment([finding("a.high:p:1", "high", "High one", "package.json", 1)], true, "high", data, false);
  assert.ok(body.startsWith(`${PR_COMMENT_MARKER}\n## Offing`));

  const calls: Array<{ method: string; url: string; auth: string | null }> = [];
  let existing: Array<{ id: number; body: string }> = [{ id: 1, body: "unrelated" }];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url: String(url), auth: new Headers(init?.headers).get("authorization") });
    if (method === "POST") existing = [...existing, { id: 2, body: JSON.parse(String(init?.body)).body }];
    return new Response(JSON.stringify(method === "GET" ? existing : {}), { status: 200 });
  }) as typeof fetch;
  try {
    const target = { apiUrl: "https://api.github.com", repository: "o/r", pullRequest: 7, token: "t" };
    assert.equal(await upsertPullRequestComment(target, body), "created");
    assert.equal(await upsertPullRequestComment(target, body), "updated");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(
    calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    [
      "GET /repos/o/r/issues/7/comments",
      "POST /repos/o/r/issues/7/comments",
      "GET /repos/o/r/issues/7/comments",
      "PATCH /repos/o/r/issues/comments/2",
    ],
  );
  assert.ok(calls.every((call) => call.auth === "Bearer t"));
});

test("action.yml declares pr-comment off by default and passes it and the token to the scan step", async () => {
  const action = parseYaml(await readFile(resolve("action.yml"), "utf8")) as {
    inputs: Record<string, { default?: string }>;
    runs: { steps: Array<{ env?: Record<string, string> }> };
  };
  assert.equal(action.inputs["pr-comment"]?.default, "false");
  assert.equal(action.runs.steps[0]?.env?.["INPUT_PR-COMMENT"], "${{ inputs.pr-comment }}");
  assert.equal(action.runs.steps[0]?.env?.["INPUT_GITHUB-TOKEN"], "${{ inputs.github-token }}");
});

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

/** A commit with a clean `package.json`, then a commit that adds an unsupported checkout pin. */
async function gitRepositoryWithFinding(): Promise<{ root: string; base: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), "offing-action-diff-"));
  temporaryRoots.push(root);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "offing@example.com"]);
  git(root, ["config", "user.name", "Offing test"]);
  await writeFile(join(root, "package.json"), JSON.stringify({ engines: { node: "24" } }));
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]).trim();
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(root, ".github", "workflows", "ci.yml"),
    "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n",
  );
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "head"]);
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  return { root, base, head };
}

test("diff mode gates only what the pull request introduces and reports what it fixed", async () => {
  const { root, base, head } = await gitRepositoryWithFinding();
  const reportPath = join(root, "report.json");

  const introduced = await runGitHubAction({
    root,
    reportPath,
    mode: "diff",
    diffRange: `${base}..${head}`,
    failOnSeverity: "high",
  });
  assert.equal(introduced.result.findings.length, 1);
  assert.equal(introduced.failed, true, "the PR introduced the checkout finding, so the gate fails");
  assert.equal(introduced.gateFailed, true);
  assert.deepEqual(introduced.diff, { base, head, fixed: [], unchanged: 0 });
  assert.deepEqual(introduced.result.diagnostics, [], "the diff path adds no baseline diagnostics");

  const fixed = await runGitHubAction({
    root,
    reportPath,
    mode: "diff",
    diffRange: `${head}..${base}`,
    failOnSeverity: "high",
  });
  assert.deepEqual(fixed.result.findings, []);
  assert.equal(fixed.failed, false, "a PR that only removes findings passes");
  assert.equal(fixed.gateFailed, false);
  assert.equal(fixed.diff?.fixed.length, 1);
});

test("diff mode needs the pull request refs and refuses every other mode value", async () => {
  const root = await fixtureRepository();
  await assert.rejects(
    runGitHubAction({ root, reportPath: join(root, "report.json"), mode: "diff" }),
    /diff needs the base and head refs/,
  );
});

test("the job summary in diff mode lists the findings the pull request fixed", async () => {
  const { renderSummary } = await import("../src/github-action.js");
  const text = renderSummary([], false, "high", undefined, false, undefined, {
    base: "abc",
    head: "def",
    fixed: [
      finding("r.high:p:1", "high", "High one", "package.json", 2),
      finding("s.low:p:2", "low", "Low one", "package.json", 4),
    ],
    unchanged: 3,
  });
  assert.match(
    text,
    /Found \*\*0\*\* lifecycle findings introduced by this pull request \(abc\.\.def\); passed the severity gate\./,
  );
  assert.match(text, /Fixed by this pull request: \*\*2\*\* findings \(3 unchanged\)\./);
  assert.match(text, /\| high \| High one \| `package\.json:2` \|/);
  assert.match(text, /\| low \| Low one \| `package\.json:4` \|/);
  assert.equal(text.includes("Baseline:"), false, "diff mode has no baseline line");
  const scan = renderSummary([], false, "high", undefined, false);
  assert.equal(scan.includes("introduced by this pull request"), false, "the plain scan summary is unchanged");
});

test("mode: diff reads the pull request base and head from the event payload", async () => {
  const { root, base, head } = await gitRepositoryWithFinding();
  await writeFile(
    join(root, "event.json"),
    JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } }),
  );
  const run = await runActionFixture(root, { INPUT_MODE: "diff", GITHUB_EVENT_PATH: join(root, "event.json") });
  assert.equal(run.code, 1);
  assert.match(run.summary, /introduced by this pull request/);
  assert.match(run.summary, /Fixed by this pull request: \*\*0\*\* findings \(0 unchanged\)\./);
  assert.match(run.stdout, /1 finding met or exceeded the high severity gate/);
  assert.match(run.outputs, /finding-count=1/);
});

test("mode: diff uses a reserved agent branch only when the pull request is from the same repository", async () => {
  const { root, base, head } = await gitRepositoryWithFinding();
  const eventPath = join(root, "event.json");
  for (const repository of ["owner/project", "fork/project"]) {
    await writeFile(
      eventPath,
      JSON.stringify({
        pull_request: {
          user: { login: "octocat" },
          base: { sha: base, repo: { full_name: "owner/project" } },
          head: { sha: head, ref: "codex/update-fixture", repo: { full_name: repository } },
        },
      }),
    );
    const run = await runActionFixture(root, { INPUT_MODE: "diff", GITHUB_EVENT_PATH: eventPath });
    assert.equal(run.summary.includes("Agent attribution: branch-prefix."), repository === "owner/project");
  }
});

test("acc-ai-pr-review reports committed source and dependency findings through the Action entry point", async () => {
  const { root, head: base } = await gitRepositoryWithFinding();
  await writeFile(join(root, "example.ts"), "export const outdated = new Buffer(3);\n");
  await writeFile(join(root, "example.py"), "import imp\nimp.reload(existing)\n");
  await writeFile(join(root, "package.json"), '{\n  "dependencies": { "request": "2.88.2" }\n}\n');
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "add stale symbols and a deprecated dependency"]);
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  const eventPath = join(root, "event.json");
  await writeFile(
    eventPath,
    JSON.stringify({
      pull_request: {
        user: { login: "Copilot" },
        base: { sha: base },
        head: { sha: head },
      },
    }),
  );
  const run = await runActionFixture(
    root,
    {
      INPUT_MODE: "diff",
      GITHUB_EVENT_PATH: eventPath,
      "INPUT_FAIL-ON-SEVERITY": "none",
      OFFING_DATA_VERSION: "bundled",
    },
    process.env.OFFING_ACTION_FOR_REVIEW_TEST,
  );
  assert.equal(run.code, 0);
  assert.match(run.summary, /Agent attribution: author-login\./u);
  const report = JSON.parse(await readFile(join(root, ".runner", "offing-report.json"), "utf8")) as {
    findings: Finding[];
  };
  assert.deepEqual(
    report.findings.map(({ ruleId, location }) => [ruleId, location.path, location.line]),
    [
      ["nodejs.symbol.buffer.constructor", "example.ts", 1],
      ["npm.package.request.deprecated", "package.json", 2],
      ["python.module.imp.removed", "example.py", 1],
      ["python.symbol.imp.reload", "example.py", 2],
    ],
  );
});

test("acc-ai-pr-review verifies bot committers and posts opt-in head-pinned reviews on changed lines", async (t) => {
  const { root, base } = await gitRepositoryWithFinding();
  await writeFile(join(root, "package.json"), '{\n  "dependencies": { "request": "2.88.2" }\n}\n');
  git(root, ["add", "package.json"]);
  git(root, ["commit", "-q", "-m", "add a deprecated package"]);
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  const repo = { full_name: "owner/project" };
  const eventPath = join(root, "event.json");
  let reviewHead = head;
  const writeEvent = (source = repo, login = "someone", revision = head) => {
    reviewHead = revision;
    return writeFile(
      eventPath,
      JSON.stringify({
        pull_request: { number: 17, user: { login }, base: { sha: base, repo }, head: { sha: revision, repo: source } },
      }),
    );
  };
  await writeEvent();
  const requests: string[] = [];
  const reviews: unknown[] = [];
  const summaries: string[] = [];
  let verified = false;
  let rejectReview = false;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
    requests.push(`${request.method} ${request.url}`);
    assert.equal(request.headers.authorization, "Bearer fixture-token");
    response.setHeader("content-type", "application/json");
    if (request.method === "POST") {
      const parts = [];
      for await (const chunk of request) parts.push(String(chunk));
      const body = JSON.parse(parts.join(""));
      if (path.endsWith("/graphql")) {
        response.end(
          JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  state: "OPEN",
                  baseRefOid: base,
                  headRefOid: reviewHead,
                  reviews: { nodes: [] },
                  reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
                },
              },
            },
          }),
        );
        return;
      }
      if (path.endsWith("/reviews")) reviews.push(body);
      else summaries.push(body.body);
      response.writeHead(path.endsWith("/reviews") && rejectReview ? 422 : 201).end("{}");
      return;
    }
    if (path.endsWith("/comments")) {
      response.end("[]");
      return;
    }
    const row = (sha: string, signature: boolean, type = "Bot") => ({
      sha,
      committer: { type, login: "chatgpt-codex-connector[bot]" },
      commit: { verification: { verified: signature } },
    });
    response.end(JSON.stringify([row(base, true), row(head, false), row(head, true, "User"), row(head, verified)]));
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  t.after(async () => new Promise<void>((ready) => server.close(() => ready())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const execute = (settings: Record<string, string> = {}) =>
    runActionFixture(
      root,
      {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: "owner/project",
        GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        GITHUB_SERVER_URL: "https://github.example.invalid",
        GITHUB_RUN_ID: "42",
        GITHUB_RUN_ATTEMPT: "2",
        INPUT_MODE: "diff",
        "INPUT_GITHUB-TOKEN": "fixture-token",
        "INPUT_FAIL-ON-SEVERITY": "none",
        OFFING_DATA_VERSION: "bundled",
        ...settings,
      },
      process.env.OFFING_ACTION_FOR_REVIEW_TEST,
    );

  assert.equal((await execute()).code, 0);
  assert.deepEqual(requests, []);
  await writeFile(
    join(root, ".github", "workflows", "ci.yml"),
    "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4 # dirty-fixture-private\n",
  );
  const unverified = await execute({ "INPUT_VERIFY-AGENT-COMMITTERS": "true" });
  assert.doesNotMatch(unverified.summary, /bot-committer/u);
  assert.deepEqual(requests, ["GET /repos/owner/project/pulls/17/commits?per_page=100&page=1"]);
  verified = true;
  const review = await execute({ "INPUT_AGENT-REVIEW": "true" });
  assert.equal(review.code, 0);
  assert.match(review.summary, /Agent attribution: bot-committer/u);
  assert.deepEqual(requests.slice(1), [
    "GET /repos/owner/project/pulls/17/commits?per_page=100&page=1",
    "POST /graphql",
    "POST /graphql",
    "POST /repos/owner/project/pulls/17/reviews",
  ]);
  const expected = {
    commit_id: head,
    event: "COMMENT",
    body: "<!-- offing-agent-review -->\nOffing lifecycle review",
  };
  const first = reviews[0];
  assert.ok(first && typeof first === "object" && "comments" in first && Array.isArray(first.comments));
  assert.match(first.comments[0]?.body, /checkout.*\n\nReplacement: .+\n\nSource: <https:\/\/.+>\n\nDays left: .+/isu);
  assert.match(first.comments[1]?.body, /request.*\n\nReplacement: .+\n\nSource: <https:\/\/.+>\n\nDays left: .+/isu);
  assert.match(first.comments[0]?.body, /```suggestion\n +- uses: actions\/checkout@v5\n```/u);
  assert.doesNotMatch(first.comments[0]?.body, /dirty-fixture-private/u);
  assert.match(first.comments[1]?.body, /No deterministic codemod suggestion is available on these lines\./u);
  const packetPath = /^agent-packet-path=(.+)$/mu.exec(review.outputs)?.[1];
  assert.ok(packetPath);
  const filenames = await readdir(packetPath);
  assert.equal(filenames.length, 2);
  for (const comment of first.comments) {
    const filename = /\x60(migration-[a-f0-9]+\.json)\x60/u.exec(comment.body)?.[1];
    assert.ok(filename && filenames.includes(filename));
    assert.match(
      comment.body,
      /Ask your agent to fix this.*offing-agent-migration-packets-2.*github\.example\.invalid\/owner\/project\/actions\/runs\/42#artifacts/u,
    );
    const json = await readFile(join(packetPath, filename), "utf8");
    assert.ok(!json.includes(root));
    assert.doesNotMatch(json, /dirty-fixture-private/u);
    const packet = validateMigrationPacket(JSON.parse(json));
    assert.equal(packet.repositoryRoot, ".");
    assert.equal(packet.finding.location.path, comment.path);
    assert.ok(packet.usages.every((usage) => usage.excerpt === ""));
  }
  assert.deepEqual(first, {
    ...expected,
    comments: [
      { path: ".github/workflows/ci.yml", line: 4, side: "RIGHT", body: first.comments[0]?.body },
      { path: "package.json", line: 2, side: "RIGHT", body: first.comments[1]?.body },
    ],
  });

  await writeEvent(repo, "Copilot");
  requests.length = 0;
  assert.equal((await execute({ "INPUT_AGENT-REVIEW": "true", "INPUT_REVIEW-EVENT": "request-changes" })).code, 0);
  assert.deepEqual(requests, ["POST /graphql", "POST /graphql", "POST /repos/owner/project/pulls/17/reviews"]);
  assert.deepEqual(reviews[1], { ...first, event: "REQUEST_CHANGES" });

  requests.length = 0;
  await execute({ "INPUT_AGENT-REVIEW": "true", GITHUB_EVENT_NAME: "pull_request_target" });
  await writeEvent({ full_name: "fork/project" }, "Copilot");
  await execute({ "INPUT_AGENT-REVIEW": "true", "INPUT_REVIEW-EVENT": "request-changes" });
  const invalid = await execute({ "INPUT_AGENT-REVIEW": "true", "INPUT_REVIEW-EVENT": "approve" });
  assert.equal(invalid.code, 1);
  assert.match(invalid.stdout, /review-event must be comment or request-changes/u);
  assert.deepEqual(requests, []);
  assert.equal(reviews.length, 2);

  await writeEvent(repo, "Copilot");
  const flags = { "INPUT_AGENT-REVIEW": "true", "INPUT_PR-COMMENT": "true" };
  const combined = await execute({ ...flags, "INPUT_SUGGEST-FIXES": "true" });
  assert.equal(combined.code, 0);
  assert.deepEqual(requests, [
    "POST /graphql",
    "POST /graphql",
    "POST /repos/owner/project/pulls/17/reviews",
    "GET /repos/owner/project/issues/17/comments?per_page=100&page=1",
    "POST /repos/owner/project/issues/17/comments",
  ]);
  assert.match(
    summaries[0] ?? "",
    /Found \*\*2\*\* lifecycle findings.*\n\nSee the inline lifecycle review for 2 findings\./u,
  );
  assert.doesNotMatch(summaries[0] ?? "", /actions\/checkout|request is deprecated/u);
  assert.match(combined.summary, /actions\/checkout/u);
  assert.match(combined.outputs, /finding-count=2/u);

  rejectReview = true;
  const rejected = await execute(flags);
  assert.equal(rejected.code, 0);
  assert.match(rejected.stdout, /Offing could not post the agent review/u);
  assert.doesNotMatch(rejected.outputs, /agent-packet-path=/u);
  assert.match(summaries[1] ?? "", /actions\/checkout/u);
  assert.doesNotMatch(summaries[1] ?? "", /See the inline lifecycle review/u);

  await writeFile(
    join(root, ".github", "workflows", "ci.yml"),
    "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4 # password=fixture-only-credential\n",
  );
  git(root, ["add", ".github/workflows/ci.yml"]);
  git(root, ["commit", "-q", "-m", "add a synthetic credential to the changed line"]);
  await writeEvent(repo, "Copilot", git(root, ["rev-parse", "HEAD"]).trim());
  rejectReview = false;
  const protectedReview = await execute({ "INPUT_AGENT-REVIEW": "true" });
  assert.equal(protectedReview.code, 0);
  assert.doesNotMatch(JSON.stringify(reviews.at(-1)), /fixture-only-credential|\x60{3}suggestion/u);
  assert.match(JSON.stringify(reviews.at(-1)), /No deterministic codemod suggestion/u);

  const meta = parseYaml(await readFile(resolve("action.yml"), "utf8")) as {
    runs: { steps: Array<{ name: string; if?: string; uses?: string; with?: Record<string, string | number> }> };
  };
  const upload = meta.runs.steps.find((step) => step.name === "Upload agent migration packets");
  assert.equal(upload?.uses, UPLOAD_ARTIFACT);
  assert.equal(upload?.if, "always() && steps.scan.outputs.agent-packet-path != ''");
  assert.equal(upload?.with?.name, "offing-agent-migration-packets-${{ github.run_attempt }}");
  assert.equal(upload?.with?.path, "${{ steps.scan.outputs.agent-packet-path }}");
  assert.equal(upload?.with?.["retention-days"], 14);
});

test("acc-ai-pr-review keeps the core comment if its optional source snapshot exceeds the path budget", async () => {
  const root = await fixtureRepository();
  const item: Finding = {
    ...finding("nodejs.symbol.buffer.constructor:index.js:1", "high", "Legacy Buffer constructor", "index.js", 1),
    usages: Array.from({ length: 250 }, (_, index) => ({
      kind: "call",
      language: "javascript",
      symbol: "Buffer",
      location: { path: `src/use-${index}.js`, line: 1 },
      excerpt: "",
    })),
  };
  const comment = { path: "index.js", line: 1, side: "RIGHT" as const, body: item.title };
  const details = await addReviewDetails(
    { schemaVersion: "offing.scan.v1", root, scannedAt: new Date().toISOString(), findings: [item], diagnostics: [] },
    "unused",
    [{ finding: item, comment }],
    new Map(),
    {},
    () => false,
  );
  assert.deepEqual(details, {
    comments: [
      { ...comment, body: `${item.title}\n\nNo deterministic codemod suggestion is available on these lines.` },
    ],
  });
});

test("acc-ai-pr-review reconciles only its current bot-authored threads and leaves manual threads intact", async (t) => {
  const base = "a".repeat(40);
  const head = "b".repeat(40);
  const comment = markAgentComment({ path: "workflow.yml", line: 4, side: "RIGHT", body: "Original" }, "rule.one");
  const gone = markAgentComment({ ...comment, path: "gone.yml", body: "Was present" }, "rule.two");
  const changed = markAgentComment({ ...comment, body: "Updated" }, "rule.one");
  const thread = (id: string, item: typeof comment, viewerDidAuthor = true, bot = true) => ({
    id,
    path: item.path,
    line: item.line,
    startLine: null,
    diffSide: "RIGHT",
    isResolved: false,
    viewerCanResolve: true,
    isOutdated: false,
    comments: {
      nodes: [
        {
          id: `comment-${id}`,
          body: item.body,
          viewerDidAuthor,
          viewerCanUpdate: true,
          replyTo: null,
          author: { __typename: bot ? "Bot" : "User" },
        },
      ],
    },
  });
  const writes: unknown[] = [];
  let nodes = [thread("manual", comment, false), thread("same-user", changed, true, false)];
  let staleBeforeMutation = false;
  const server = createServer(async (request, response) => {
    const parts = [];
    for await (const chunk of request) parts.push(String(chunk));
    const body = JSON.parse(parts.join(""));
    response.setHeader("content-type", "application/json");
    if (request.url?.endsWith("/reviews")) {
      writes.push({ review: body });
      nodes.push(thread("kept", comment));
      return response.writeHead(201).end("{}");
    }
    if (String(body.query).startsWith("mutation")) {
      writes.push(body.variables);
      const id = body.variables.id;
      return response.end(
        JSON.stringify({
          data: {
            updatePullRequestReviewComment: { pullRequestReviewComment: { id } },
            resolveReviewThread: { thread: { id } },
          },
        }),
      );
    }
    const current = !String(body.query).startsWith("query OffingAgentReviewHead") || !staleBeforeMutation;
    return response.end(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              state: "OPEN",
              baseRefOid: base,
              headRefOid: current ? head : "c".repeat(40),
              reviews: { nodes: [] },
              reviewThreads: { nodes, pageInfo: { hasNextPage: false } },
            },
          },
        },
      }),
    );
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  t.after(async () => new Promise<void>((ready) => server.close(() => ready())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const target = {
    apiUrl: `http://127.0.0.1:${address.port}`,
    repository: "owner/project",
    pullRequest: 17,
    token: "fixture",
  };
  const draft = { base, head, event: "COMMENT" as const, comments: [comment] };
  await publishAgentReview(target, draft);
  assert.equal(writes.length, 1);
  writes.length = 0;
  await publishAgentReview(target, draft);
  assert.deepEqual(writes, []);
  nodes = [...nodes, thread("gone", gone)];
  await publishAgentReview(target, { ...draft, comments: [changed] });
  assert.deepEqual(writes, [{ id: "comment-kept", body: changed.body }, { id: "gone" }]);
  writes.length = 0;
  staleBeforeMutation = true;
  await assert.rejects(publishAgentReview(target, { ...draft, comments: [] }), /changed before Agent review/u);
  assert.deepEqual(writes, []);
});

interface RecordedProviderDiff {
  path: string;
  status: "added" | "modified";
  hunks: Array<{ oldStart: number; newStart: number; lines: string }>;
  addedRanges: Array<{ start: number; end: number }>;
}

/** Rebuild line positions from the provider's recorded hunk classes without storing or executing source. */
function neutralProviderFiles(diff: RecordedProviderDiff): { before: string; after: string } {
  const before: string[] = [];
  const after: string[] = [];
  const context = () => {
    const line = `unchanged_${before.length}`;
    before.push(line);
    after.push(line);
  };
  for (const hunk of diff.hunks) {
    while (before.length < Math.max(0, hunk.oldStart - 1)) context();
    assert.equal(after.length, hunk.newStart - 1);
    for (const kind of hunk.lines) {
      if (kind === "C") context();
      else if (kind === "A") after.push(`added_${after.length}`);
      else if (kind === "D") before.push(`deleted_${before.length}`);
      else assert.fail("Unknown recorded diff line class.");
    }
  }
  return { before: before.join("\n") + "\n", after: after.join("\n") + "\n" };
}

test("acc-ai-pr-review replays five recorded provider payloads and diffs with a common positive lifecycle case", async (t) => {
  const { root, base } = await gitRepositoryWithFinding();
  const fixture = resolve("tests/fixtures/agent-review");
  const recordings = JSON.parse(await readFile(join(fixture, "provider-replays.json"), "utf8")) as {
    cases: Array<{
      provider: string;
      observed: {
        pullRequest: string;
        number: number;
        login: string;
        actorType: string;
        headRef: string;
        headCommit: string;
        baseRepository: string;
        headRepository: string;
        diff: RecordedProviderDiff;
      };
      pullRequest: { user: { login: string }; head: { ref: string } };
      commitMessage?: string;
      commit?: Record<string, unknown>;
      signal: string;
    }>;
  };
  const eventPath = join(root, "provider-event.json");
  let replayBase = base;
  let revision = "";
  let endpoint = "";
  let commits: unknown[] = [];
  const bodies: Array<{ commit_id: string; comments: Array<{ path: string; line: number; body: string }> }> = [];
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url?.includes("/commits?")) return response.end(JSON.stringify(commits));
    if (request.url === "/graphql")
      return response.end(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                state: "OPEN",
                baseRefOid: replayBase,
                headRefOid: revision,
                reviews: { nodes: [] },
                reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
              },
            },
          },
        }),
      );
    assert.equal(request.url, endpoint);
    const parts = [];
    for await (const chunk of request) parts.push(String(chunk));
    bodies.push(JSON.parse(parts.join("")));
    return response.writeHead(201).end("{}");
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  t.after(async () => new Promise<void>((ready) => server.close(() => ready())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  assert.equal(recordings.cases.length, 5);
  for (const sample of recordings.cases) {
    const { observed } = sample;
    assert.equal(observed.actorType, "Bot");
    assert.equal(observed.pullRequest, `https://github.com/${observed.baseRepository}/pull/${observed.number}`);
    assert.match(observed.headCommit, /^[a-f0-9]{40}$/u);
    git(root, ["checkout", "--quiet", "--detach", base]);
    const { before, after } = neutralProviderFiles(observed.diff);
    const file = join(root, observed.diff.path);
    await mkdir(dirname(file), { recursive: true });
    if (observed.diff.status === "modified") {
      await writeFile(file, before);
      git(root, ["add", "--", observed.diff.path]);
      git(root, ["commit", "--quiet", "-m", "Replay the recorded baseline line classes"]);
    }
    replayBase = git(root, ["rev-parse", "HEAD"]).trim();
    await writeFile(file, after);
    git(root, ["apply", join(fixture, "checkout.patch")]);
    git(root, ["add", "--", ".github/workflows/ci.yml", observed.diff.path]);
    git(root, ["commit", "--quiet", "-m", sample.commitMessage ?? "Review fixture"]);
    revision = git(root, ["rev-parse", "HEAD"]).trim();
    assert.deepEqual(
      changedLines(root, `${replayBase}..${revision}`).get(observed.diff.path),
      observed.diff.addedRanges,
      sample.provider,
    );
    const repo = { full_name: observed.baseRepository };
    const headRepo = { full_name: observed.headRepository };
    endpoint = `/repos/${repo.full_name}/pulls/${observed.number}/reviews`;
    commits = sample.commit ? [{ sha: revision, ...sample.commit }] : [];
    const execute = async (login: string, ref: string, signal: string) => {
      await writeFile(
        eventPath,
        JSON.stringify({
          pull_request: {
            number: observed.number,
            user: { login, type: observed.actorType },
            base: { sha: replayBase, repo },
            head: { ref, sha: revision, repo: headRepo },
          },
        }),
      );
      const run = await runActionFixture(
        root,
        {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_REPOSITORY: repo.full_name,
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          INPUT_MODE: "diff",
          "INPUT_AGENT-REVIEW": "true",
          "INPUT_GITHUB-TOKEN": "fixture-token",
          "INPUT_FAIL-ON-SEVERITY": "none",
          OFFING_DATA_VERSION: "bundled",
        },
        process.env.OFFING_ACTION_FOR_REVIEW_TEST,
      );
      assert.equal(run.code, 0, sample.provider);
      assert.ok(run.summary.includes(`Agent attribution: ${signal}.`), sample.provider);
      const payload = bodies.at(-1);
      assert.ok(payload, sample.provider);
      assert.equal(payload.commit_id, revision, sample.provider);
      assert.deepEqual(
        payload.comments.map(({ path, line }) => [path, line]),
        [[".github/workflows/ci.yml", 4]],
        sample.provider,
      );
    };
    await execute(observed.login, observed.headRef, "author-login");
    if (sample.signal !== "author-login")
      await execute(sample.pullRequest.user.login, sample.pullRequest.head.ref, sample.signal);
  }
  assert.equal(bodies.length, 8);
});

test("acc-ai-pr-review replays the fork signal and separate read/write jobs without checking out fork content", async (t) => {
  const { root, base } = await gitRepositoryWithFinding();
  await writeFile(join(root, ".gitattributes"), ".github/workflows/ci.yml export-ignore\n");
  await writeFile(join(root, "host-only.json"), '{"engines":{"node":"8"}}');
  await writeFile(join(root, "link-target"), join(root, "host-only.json"));
  const link = git(root, ["hash-object", "-w", "link-target"]).trim();
  git(root, ["add", ".gitattributes"]);
  git(root, ["update-index", "--add", "--cacheinfo", `120000,${link},shadow/package.json`]);
  git(root, ["commit", "--quiet", "-m", "Add archive attribute and synthetic symlink"]);
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  const remote = join(root, "remote.git");
  git(root, ["clone", "--quiet", "--bare", root, remote]);
  git(remote, ["update-ref", "refs/pull/17/head", head]);
  git(remote, ["update-server-info"]);

  const repository = { id: 881, full_name: "owner/project" };
  const fork = { id: 992, full_name: "fork/project", fork: true };
  const path = ".github/workflows/offing-agent-review-scan.yml";
  const run = {
    id: 440,
    run_attempt: 2,
    workflow_id: 33,
    path,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    repository,
    head_repository: fork,
    head_sha: head,
    head_branch: "vendor/update",
    pull_requests: [],
  };
  const event = join(root, "workflow-run.json");
  await writeFile(event, JSON.stringify({ action: "completed", repository, workflow_run: run }));
  const pull = {
    number: 17,
    state: "open",
    draft: false,
    user: { login: "Copilot" },
    base: { repo: repository, sha: base, ref: "main" },
    head: { repo: fork, sha: head, ref: run.head_branch },
  };
  let current = pull;
  let duplicate = false;
  let refetchChangesHead = false;
  let graphSawCurrent = false;
  const requests: Array<{ path: string; authorization?: string }> = [];
  const reviews: Array<{
    event: string;
    commit_id: string;
    comments: Array<{ path: string; line: number; body: string }>;
  }> = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    const authorization = request.headers.authorization;
    requests.push({ path: url.pathname, ...(authorization ? { authorization } : {}) });
    if (url.pathname.startsWith("/owner/project.git/")) {
      const asset = url.pathname.slice("/owner/project.git/".length);
      if (
        !/^(?:HEAD|info\/refs|objects\/(?:info\/packs|[a-f0-9]{2}\/[a-f0-9]{38}|pack\/pack-[a-f0-9]+\.(?:idx|pack)))$/u.test(
          asset,
        )
      ) {
        return response.writeHead(404).end();
      }
      const bytes = await readFile(join(remote, asset)).catch(() => undefined);
      if (!bytes) return response.writeHead(404).end();
      return response.writeHead(200, { "content-type": "text/plain" }).end(bytes);
    }
    response.setHeader("content-type", "application/json");
    const send = (value: unknown) => response.end(JSON.stringify(value));
    if (url.pathname.endsWith("/actions/workflows/offing-agent-review-scan.yml"))
      return send({ id: 33, path, state: "active" });
    if (url.pathname.endsWith("/actions/runs/440")) return send(run);
    if (url.pathname.endsWith("/pulls")) {
      assert.equal(url.searchParams.get("head"), "fork:vendor/update");
      const actual =
        refetchChangesHead && graphSawCurrent
          ? { ...current, head: { ...current.head, sha: "c".repeat(40) } }
          : current;
      return send(duplicate ? [actual, { ...actual, number: 18 }] : [actual]);
    }
    if (url.pathname.endsWith("/pulls/17")) return send(current);
    if (url.pathname === "/graphql") {
      graphSawCurrent = true;
      return send({
        data: {
          repository: {
            pullRequest: {
              state: "OPEN",
              baseRefOid: base,
              headRefOid: head,
              reviews: { nodes: [] },
              reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
            },
          },
        },
      });
    }
    assert.equal(url.pathname, "/repos/owner/project/pulls/17/reviews");
    const parts = [];
    for await (const chunk of request) parts.push(String(chunk));
    reviews.push(JSON.parse(parts.join("")));
    return response.writeHead(201).end("{}");
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  t.after(async () => new Promise<void>((ready) => server.close(() => ready())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const readTemplate = parseYaml(
    await readFile(resolve("templates/workflows/offing-agent-review-scan.yml"), "utf8"),
  ) as {
    name: string;
    permissions: unknown;
    on: Record<string, unknown>;
    jobs: { signal: { steps: unknown[] } };
  };
  const writer = parseYaml(await readFile(resolve("templates/workflows/offing-agent-review-fork.yml"), "utf8")) as {
    on: { workflow_run: { workflows: string[] } };
    permissions: unknown;
    jobs: Record<
      "prepare" | "publish",
      { permissions: unknown; steps: [{ uses: string; with: Record<string, string> }] }
    >;
  };
  assert.deepEqual(readTemplate.permissions, {});
  assert.ok(readTemplate.on.pull_request);
  assert.deepEqual(readTemplate.jobs.signal.steps, [{ name: "Signal a fork pull request", run: "true" }]);
  assert.deepEqual(writer.on.workflow_run.workflows, [readTemplate.name]);
  assert.deepEqual(writer.permissions, {});
  assert.deepEqual(writer.jobs.prepare.permissions, { actions: "read", contents: "read", "pull-requests": "read" });
  assert.deepEqual(writer.jobs.publish.permissions, { actions: "read", "pull-requests": "write" });
  const execute = (stage: "prepare" | "publish", plan?: string) => {
    const steps = writer.jobs[stage].steps;
    assert.equal(steps.length, 1);
    const config = steps[0].with;
    return runActionFixture(
      root,
      {
        GITHUB_EVENT_NAME: "workflow_run",
        GITHUB_EVENT_PATH: event,
        GITHUB_REPOSITORY: repository.full_name,
        GITHUB_REPOSITORY_ID: String(repository.id),
        GITHUB_API_URL: origin,
        GITHUB_SERVER_URL: origin,
        "INPUT_AGENT-REVIEW": config["agent-review"] ?? "",
        "INPUT_FORK-REVIEW-MODE": config["fork-review-mode"] ?? "",
        "INPUT_GITHUB-TOKEN": stage === "prepare" ? "fork-read-token" : "fork-write-token",
        ...(plan ? { "INPUT_FORK-REVIEW-PLAN": plan } : {}),
        OFFING_DATA_VERSION: "bundled",
      },
      process.env.OFFING_ACTION_FOR_REVIEW_TEST,
    );
  };
  const prepared = await execute("prepare");
  assert.equal(prepared.code, 0, prepared.stdout);
  assert.equal(reviews.length, 0);
  const plan = /^fork-review-plan=(.+)$/mu.exec(prepared.outputs)?.[1];
  assert.ok(plan, prepared.stdout);
  assert.ok(
    requests.some(
      ({ path, authorization }) =>
        path.startsWith("/owner/project.git/") &&
        authorization === "Basic " + Buffer.from("x-access-token:fork-read-token").toString("base64"),
    ),
  );
  requests.length = 0;
  const published = await execute("publish", plan);
  assert.equal(published.code, 0, published.stdout);
  assert.ok(
    requests.every(
      ({ path, authorization }) =>
        !path.startsWith("/owner/project.git/") && authorization === "Bearer fork-write-token",
    ),
  );
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]?.event, "COMMENT");
  assert.equal(reviews[0]?.commit_id, head);
  assert.deepEqual(
    reviews[0]?.comments.map(({ path, line }) => [path, line]),
    [[".github/workflows/ci.yml", 4]],
  );
  assert.ok(!JSON.stringify(reviews).includes(root));
  assert.ok(!JSON.stringify(reviews).includes("fork-read-token"));
  assert.ok(!JSON.stringify(reviews).includes("fork-write-token"));

  duplicate = true;
  assert.doesNotMatch((await execute("prepare")).outputs, /fork-review-plan=/u);
  duplicate = false;
  current = { ...pull, head: { ...pull.head, repo: { ...fork, id: 1234 } } };
  assert.equal((await execute("publish", plan)).code, 0);
  current = pull;
  graphSawCurrent = false;
  refetchChangesHead = true;
  const rejected = await execute("publish", plan);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stdout, /Fork review provenance changed/u);
  assert.equal(reviews.length, 1);
});

test("mode: diff falls back to a scan outside pull request events", async () => {
  const { root } = await gitRepositoryWithFinding();
  await writeFile(join(root, "event.json"), JSON.stringify({ push: { after: "abc" } }));
  const run = await runActionFixture(root, {
    INPUT_MODE: "diff",
    GITHUB_EVENT_PATH: join(root, "event.json"),
    "INPUT_FAIL-ON-SEVERITY": "high",
  });
  assert.equal(run.code, 1, "the fallback scans the checked-out tree, which carries the finding");
  assert.match(run.stdout, /diff mode skipped/);
  assert.match(run.summary, /Found \*\*1\*\* new lifecycle finding; failed the \*\*high\*\* severity gate/);
  assert.equal(run.summary.includes("Fixed by this pull request"), false);
});

test("an invalid mode fails the run before any scan", async () => {
  const root = await fixtureRepository();
  const run = await runActionFixture(root, { INPUT_MODE: "fast", "INPUT_FAIL-ON-SEVERITY": "none" });
  assert.equal(run.code, 1);
  assert.match(run.stdout, /Invalid mode: fast/);
});

test("action.yml declares mode with a scan default and passes it to the scan step", async () => {
  const action = parseYaml(await readFile(resolve("action.yml"), "utf8")) as {
    inputs: Record<string, { default?: string }>;
    runs: { steps: Array<{ env?: Record<string, string> }> };
  };
  assert.equal(action.inputs.mode?.default, "scan");
  assert.equal(action.runs.steps[0]?.env?.INPUT_MODE, "${{ inputs.mode }}");
});

test("acc-sbom-scan: Action sbom input reports component findings and uses its severity gate", async () => {
  const root = await fixtureRepository();
  await writeFile(join(root, "consumer.sbom.json"), await readFile("examples/sbom/image.cdx.json"));
  const outcome = await runActionFixture(root, {
    INPUT_SBOM: "consumer.sbom.json",
    INPUT_SARIF: "true",
    "INPUT_FAIL-ON-SEVERITY": "info",
  });
  assert.equal(outcome.code, 1);
  const reportPath = outcome.outputs.match(/^report-path=(.+)$/m)?.[1];
  assert.ok(reportPath, outcome.outputs);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.findings[0].ruleId, "npm.package.request.deprecated");
  assert.equal(report.findings[0].location.jsonPointer, "/components/0");
  assert.match(outcome.outputs, /^sarif-path=/m);

  const conflict = await runActionFixture(root, { INPUT_SBOM: "consumer.sbom.json", INPUT_PATHS: "." });
  assert.equal(conflict.code, 1);
  assert.match(conflict.stdout, /cannot be combined with paths/);
});

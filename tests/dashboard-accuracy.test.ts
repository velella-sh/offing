import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { parse } from "yaml";
import { archiveCorpusRun } from "../benchmarks/corpus-run-archive.js";
import type { FullRunRecord, Thresholds } from "../benchmarks/thresholds.js";
import { buildDashboardDataFromRoot, renderDashboardCollections } from "../tools/build-dashboard-data.js";
import { buildDashboardAccuracy } from "../tools/dashboard-accuracy.js";

const perDetector = {
  npm: { truePositives: 10, falsePositives: 1, falseNegatives: 0 },
  python: { truePositives: 1, falsePositives: 2, falseNegatives: 2 },
};
const run: FullRunRecord = {
  date: "2026-11-20",
  commit: "deadbee",
  repositories: 2,
  findings: 14,
  precision: 0.7857,
  recall: 0.8462,
  perDetector,
};
const thresholds: Thresholds = {
  schemaVersion: "offing.corpus-thresholds.v1",
  detectors: {
    npm: { level: "stable", stable: true, minPrecision: 0.95 },
    python: { level: "stable", stable: true, minPrecision: 0.95 },
  },
  lastFullRun: run,
};
const pin = "0123456789012345678901234567890123456789";
const archive = archiveCorpusRun(run, "0.2.0", [
  {
    repository: "example/a",
    ecosystem: "node",
    commit: pin,
    ...perDetector.npm,
    missing: [],
    unexpected: ["npm.example:package.json:4"],
  },
  {
    repository: "example/b",
    ecosystem: "python",
    commit: pin,
    ...perDetector.python,
    missing: ["python.example:environment.yml:7"],
    unexpected: [],
  },
]);
const earlier = { ...archive, date: "2026-11-10", commit: "abcdef0" };
const accuracy = buildDashboardAccuracy(thresholds, ["node", "python", "unknown"], [earlier, archive], {
  scope: ["nodejs.runtime"],
  summary: { repositories: 1, truePositives: 1, falsePositives: 1, falseNegatives: 0 },
  repositories: [],
});

test("the dashboard pools counts, ranks measured ecosystems, and retains per-run evidence", () => {
  assert.deepEqual(
    accuracy.ecosystems.map(({ id }) => id),
    ["python", "node", "unknown"],
  );
  assert.deepEqual(accuracy.ecosystems[0]?.scores, {
    truePositives: 1,
    falsePositives: 2,
    falseNegatives: 2,
    precision: 0.3333,
    recall: 0.3333,
  });
  assert.equal(accuracy.ecosystems[0]?.repositories, 1);
  assert.equal(accuracy.trends.python?.[1]?.repositories, 1);
  assert.equal(accuracy.trends.python?.[1]?.commit, run.commit);
  assert.match(accuracy.ecosystems[0]?.misses[0] ?? "", /example\/b\/blob\/\w+\/environment\.yml#L7/);
  assert.deepEqual(accuracy.maturity.find(({ id }) => id === "stable")?.scores, {
    truePositives: 11,
    falsePositives: 3,
    falseNegatives: 2,
    precision: 0.7857,
    recall: 0.8462,
  });
  assert.equal(accuracy.comparison[1]?.precision, 0.5);
  assert.equal(accuracy.comparison[1]?.date, "not recorded");
});

test("the dashboard renders with pinned Mizzen and Lateen while network calls are blocked", async (t) => {
  const tools = resolve(process.env.OFFING_SITE_TOOLS ?? ".github/site-tools");
  const mizzen = join(tools, "node_modules/@velella/mizzen/bin/mizzen.js");
  const theme = join(tools, "node_modules/@velella/lateen");
  try {
    await access(mizzen);
  } catch {
    if (process.env.OFFING_SITE_TOOLS) throw new Error(`Mizzen is missing under ${tools}`);
    t.skip("Install .github/site-tools to run the offline site integration check.");
    return;
  }

  const directory = await mkdtemp(join(tmpdir(), "offing-dashboard-site-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const production = parse(await readFile("docs/mizzen.yml", "utf8")) as {
    collections: Record<string, unknown>;
  };
  const collections = Object.fromEntries(
    Object.entries(production.collections).filter(([name]) => name.startsWith("dashboard")),
  );
  const site = join(directory, "docs");
  for (const sub of ["_data", "_templates", "assets/brand", "dashboard", "decisions"]) {
    await mkdir(join(site, sub), { recursive: true });
  }
  await writeFile(
    join(site, "mizzen.yml"),
    JSON.stringify({ title: "Offing", url: "https://velella.sh", base: "/offing", collections }),
  );
  for (const path of [
    "dashboard/index.md",
    "_templates/dashboard-ecosystem.md",
    "assets/brand/accuracy-dashboard.svg",
    "decisions/0013-detector-maturity.md",
    "decisions/0030-corpus-selection-and-200-target.md",
  ]) {
    await copyFile(join("docs", path), join(site, path));
  }
  const data = { ...(await buildDashboardDataFromRoot(".", "run-date")), accuracy };
  await writeFile(join(site, "_data/dashboard.json"), JSON.stringify(data));
  for (const [path, contents] of Object.entries(renderDashboardCollections(data))) {
    await writeFile(join(directory, path), contents);
  }
  const denial = join(directory, "deny-network.mjs");
  await writeFile(
    denial,
    `
    import { Socket } from "node:net";
    function refuse() { throw new Error("The dashboard build tried to reach the network."); }
    globalThis.fetch = refuse;
    Socket.prototype.connect = refuse;
  `,
  );
  const out = join(directory, "out");
  await promisify(execFile)(
    process.execPath,
    ["--import", denial, mizzen, "build", site, "--theme", theme, "--out", out, "--workers", "1"],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  const index = await readFile(join(out, "dashboard/index.html"), "utf8");
  assert.match(index, /\/offing\/dashboard\/ecosystems\/python\//);
  assert.match(index, /Full corpus and held-out results/);
  assert.match(index, /og:image[^>]+accuracy-dashboard\.svg/);
  const detail = await readFile(join(out, "dashboard/ecosystems/python/index.html"), "utf8");
  assert.match(detail, /class="line-chart-svg"/);
  assert.match(detail, /environment\.yml#L7/);
  assert.match(detail, /0\.2\.0/);
  const unknown = await readFile(join(out, "dashboard/ecosystems/unknown/index.html"), "utf8");
  assert.doesNotMatch(unknown, /class="line-chart-svg"/);
  assert.match(unknown, /Trend requires two runs/);
});

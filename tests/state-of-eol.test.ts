import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import { configureActiveData, getActiveData } from "@velella/ebb/data-source";
import { parse } from "yaml";
import { parseGitHubForecastInput } from "../src/forecast-tool/remote/input.js";
import { readLineageInputs } from "../src/lineage/inputs.js";
import { freezeStudyArchive, loadStudyArchive, type StudyArchive } from "../tools/state-of-eol/archive.js";
import { readCohort, type Cohort } from "../tools/state-of-eol/cohort.js";
import type { StudyCapture } from "../tools/state-of-eol/capture.js";
import { imageBreakdown, resolveStudyLineage } from "../tools/state-of-eol/lineage.js";
import {
  actionBreakdown,
  attachRuleCatalog,
  ecosystemBreakdown,
  headlines,
  upgradeBreakdown,
  type Measured,
} from "../tools/state-of-eol/metrics.js";
import { renderStudyCollections } from "../tools/state-of-eol/report.js";
import { defaultCohort } from "../tools/state-of-eol/scan.js";

const asOf = "2026-11-27";
const commit = "a".repeat(40);
const emptyUpgrades: StudyCapture["upgrade"] = [
  { status: "failed", target: { runtime: "nodejs", version: "22" } },
  { status: "failed", target: { runtime: "python", version: "3.13" } },
];

function observed(rank: number, capture: Partial<StudyCapture>): Measured {
  const name = `example/repo-${rank}`;
  return {
    rank,
    repository: name,
    commit,
    state: {
      name,
      host: "https://github.com",
      defaultBranch: "main",
      commit,
      reason: null,
      status: "scanned",
      bytesFetched: 12,
    },
    capture: {
      findings: [],
      coverage: { ecosystems: ["nodejs"], filesRead: [], unsupportedFiles: [] },
      scannerDiagnostics: 0,
      noData: {},
      actions: [],
      upgrade: emptyUpgrades,
      lineage: null,
      ...capture,
    },
  };
}

function finding(ruleId: string, detector: string, deadline: string): StudyCapture["findings"][number] {
  return { ruleId, detector, deadline, event: null, purl: null, location: { path: ".nvmrc" }, severity: "high" };
}

test("recalculates UTC headlines from one nearest event per repo, and exposes sparse and overlapping denominators", () => {
  const a = finding("node-ended", "nodejs", "2026-11-26");
  const b = finding("python-next", "python", "2026-11-29");
  const c = finding("node-next", "nodejs", "2026-12-01");
  const catalog: StudyArchive["rules"] = [
    { id: a.ruleId, event: "end-of-life", purl: "pkg:generic/nodejs", deadline: a.deadline },
    { id: b.ruleId, event: "end-of-support", purl: "pkg:generic/python", deadline: b.deadline },
    { id: c.ruleId, event: "scheduled-end-of-life", purl: "pkg:generic/nodejs", deadline: c.deadline },
  ];
  const rows = attachRuleCatalog(
    [
      observed(1, {
        findings: [a, b, b, c],
        noData: { "github-actions": 2 },
        actions: [{ path: "build.yml", runtimes: ["setup-node:20", "setup-node:22", "setup-node:20"] }],
      }),
      observed(2, {
        findings: [c],
        actions: [{ path: "build.yml", runtimes: ["setup-node:22", "setup-node:unknown"] }],
      }),
      observed(3, { coverage: null }),
      observed(4, { coverage: { ecosystems: [], filesRead: [], unsupportedFiles: [] } }),
    ],
    catalog,
  );
  assert.deepEqual(headlines(rows, 6, asOf), {
    until: "2027-11-27",
    ended: { count: 1, denominator: 4, noData: 1, unknown: 3 },
    median: { days: 3, denominator: 2, noData: 1, unknown: 3, scannedWithoutEvent: 1 },
    common: { rule: "node-next", count: 2, denominator: 2, noData: 1, unknown: 3, scannedWithoutEvent: 1 },
  });
  assert.deepEqual(ecosystemBreakdown(rows, 6), [
    { id: "github-actions", affected: 0, denominator: 2, noData: 1, unknown: 2 },
    { id: "nodejs", affected: 2, denominator: 2, noData: 0, unknown: 2 },
    { id: "python", affected: 1, denominator: 1, noData: 0, unknown: 2 },
  ]);
  assert.deepEqual(actionBreakdown(rows, 6), [
    { id: "setup-node:20", observed: 1, denominator: 2, noData: 1, unknown: 3 },
    { id: "setup-node:22", observed: 2, denominator: 2, noData: 1, unknown: 3 },
    { id: "setup-node:unknown", observed: 1, denominator: 2, noData: 1, unknown: 3 },
  ]);
});

test("ranks package blockers once per repository and keeps missing analyzers distinct from failures", () => {
  const blocker = {
    analyzer: "npm-lock",
    level: "blocker" as const,
    subject: "@example/old@1.0.0",
    path: "package-lock.json",
    reason: "Fixture incompatibility",
    evidence: { kind: "lockfile" as const, value: "<22" },
  };
  const target = { runtime: "nodejs", version: "22" };
  const first: StudyCapture["upgrade"][number] = {
    status: "scanned",
    report: {
      schemaVersion: "offing.upgrade.v1",
      target,
      verdict: "blocked",
      issues: [blocker, blocker],
      analyzers: ["npm-lock"],
      graph: {
        total: 2,
        roots: [],
        ungrouped: [{ subject: blocker.subject, path: blocker.path, firstSupported: "unknown" }],
      },
    },
  };
  const unknown: StudyCapture["upgrade"][number] = {
    status: "scanned",
    report: {
      schemaVersion: "offing.upgrade.v1",
      target,
      verdict: "unknown",
      issues: [],
      analyzers: [],
      graph: { total: 0, roots: [], ungrouped: [] },
    },
  };
  const rows = [
    observed(1, { upgrade: [first, ...emptyUpgrades.slice(1)] }),
    observed(2, { upgrade: [unknown, ...emptyUpgrades.slice(1)] }),
    observed(3, {}),
  ];
  assert.deepEqual(upgradeBreakdown(rows, 4), [
    { id: "Node.js 22", denominator: 1, noData: 1, unknown: 2, packages: [["@example/old", 1]] },
    { id: "Python 3.13", denominator: 0, noData: 0, unknown: 4, packages: [] },
  ]);
});

async function scratch(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "offing-study-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("retains the initial failed exact pin when a verified retry succeeds", async (t) => {
  const root = await scratch(t);
  const success = observed(1, {});
  const startedAt = `${asOf}T12:00:00.000Z`;
  const cohort: Cohort = {
    schemaVersion: "offing.state-of-eol.cohort.v1",
    startedAt,
    retrievedAt: startedAt,
    activeSince: "2025-11-27",
    cutoff: { stars: 100, available: 1, selected: 1 },
    repositories: [{ repository: success.repository, commit, pushedAt: startedAt, branch: "main", stars: 100 }],
  };
  configureActiveData({ pinnedVersion: "bundled" });
  const { info } = await getActiveData();
  const digest = "a".repeat(64);
  const plan = {
    schemaVersion: "offing.state-of-eol.scan.v1",
    sourceCommit: commit,
    offing: "0.0.0-fixture",
    data: { version: info.version, digest: info.contentDigest },
    packageLockDigest: digest,
    cohortDigest: digest,
    node: process.version,
    platform: process.platform,
    asOf,
    startedAt,
    start: 1,
    end: 1,
    jobs: 1,
  };
  const { capture, ...initial } = success;
  const failure = {
    ...initial,
    state: { ...initial.state, status: "failed", reason: "Fixture read failed", bytesFetched: 0 },
  };
  const directories = [join(root, "initial"), join(root, "retry")];
  for (const [index, directory] of directories.entries()) {
    await mkdir(directory);
    await writeFile(join(directory, "plan.json"), JSON.stringify(plan));
    await writeFile(join(directory, "0001.json"), JSON.stringify(index === 0 ? failure : { ...initial, capture }));
  }
  const path = join(root, "evidence.json.gz");
  await freezeStudyArchive(directories, path, cohort, digest);
  const archive = await loadStudyArchive(path, cohort, digest);
  assert.deepEqual(
    archive.rows.map(({ state }) => state.status),
    ["scanned"],
  );
  assert.deepEqual(archive.retries, [
    { rank: 1, scanIndex: 0, status: "failed", reason: "Fixture read failed", bytesFetched: 0 },
    { rank: 1, scanIndex: 1, status: "scanned", reason: null, bytesFetched: 12 },
  ]);
});

test("counts only evidence-backed lineage when the consumer has no direct ended image", async (t) => {
  const root = await scratch(t);
  await mkdir(join(root, ".github/workflows"), { recursive: true });
  await writeFile(join(root, "base.Dockerfile"), "FROM alpine:3.18\n");
  await writeFile(join(root, "app.Dockerfile"), "FROM ghcr.io/example/base:3\n");
  await writeFile(
    join(root, ".github/workflows/base.yml"),
    `jobs:
  image:
    steps:
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: base.Dockerfile
          push: true
          tags: ghcr.io/example/base:3
`,
  );
  const name = "example/repo-1";
  const lineage = { ...(await readLineageInputs(root)), repository: { name, host: "https://github.com", commit } };
  const evidence = await resolveStudyLineage([observed(1, { lineage })], asOf);
  const results = imageBreakdown(evidence, 0, asOf);
  assert.equal(results.denominator, 2);
  assert.equal(results.lineageOnly, 1);
  assert.equal(results.evidence[0]?.chain.path, "app.Dockerfile");
  assert.ok(
    results.evidence[0]?.chain.links.some(
      ({ path, ruleId }) => path === "base.Dockerfile" && ruleId?.includes("alpine"),
    ),
  );
});

const outreach = "docs/launch/state-of-eol-2027";
const publicOutreach = "https://velella.sh/offing/launch/state-of-eol-2027/";
const publicReport = "https://velella.sh/offing/reports/state-of-eol-2027/";

function markdownDestinations(text: string): Set<string> {
  return new Set([...text.matchAll(/\]\(([^\s()]+)\)/g)].flatMap(([, url]) => (url ? [url] : [])));
}

test("the State of EOL outreach drafts carry the dated report link and fit the short-post budgets", async () => {
  const outlets = ["show-hn", "reddit-devops", "reddit-node", "dev"];
  const index = markdownDestinations(await readFile(join(outreach, "README.md"), "utf8"));
  assert.ok(markdownDestinations(await readFile("docs/launch/README.md", "utf8")).has(publicOutreach));
  for (const outlet of outlets) {
    const text = await readFile(join(outreach, `${outlet}.md`), "utf8");
    assert.ok(markdownDestinations(text).has(publicReport), `${outlet} should link to the dated study`);
    assert.ok(index.has(`${publicOutreach}${outlet}/`), `${outlet} should be indexed under /offing`);
  }
  assert.ok(index.has(`${publicOutreach}social/`));
  const social = await readFile(join(outreach, "social.md"), "utf8");
  const drafts = [...social.matchAll(/^## (.+)\n\n```text\n([^`]+)```/gm)];
  assert.deepEqual(
    drafts.map(([, outlet]) => outlet),
    ["X", "Bluesky", "Mastodon"],
  );
  for (const [index, limit] of [280, 300, 500].entries()) {
    const draft = drafts[index]?.[2]?.trim() ?? assert.fail("missing social copy");
    assert.equal(draft.split(/\s+/u).at(-1), publicReport);
    assert.ok([...draft].length <= limit);
  }
});

test("acc-state-of-eol builds the real report collection and accessible chart with pinned site tools", async (t) => {
  const tools = resolve(process.env.OFFING_SITE_TOOLS ?? ".github/site-tools");
  const mizzen = join(tools, "node_modules/@velella/mizzen/bin/mizzen.js");
  if (!process.env.OFFING_SITE_TOOLS) return t.skip("Set OFFING_SITE_TOOLS on the Node 24 documentation runner.");
  await access(mizzen);
  const directory = await scratch(t);
  const docs = join(directory, "docs");
  const out = join(directory, "site");
  const production: { collections: Record<string, unknown> } = parse(await readFile("docs/mizzen.yml", "utf8"));
  const collections = Object.fromEntries(
    Object.entries(production.collections).filter(([name]) => name.startsWith("state-of-eol-2027-")),
  );
  await mkdir(join(docs, "_data"), { recursive: true });
  await mkdir(join(docs, "_templates"));
  await copyFile("docs/_templates/state-of-eol-2027.md", join(docs, "_templates/state-of-eol-2027.md"));
  await copyFile("docs/_templates/state-of-eol-2027-gallery.md", join(docs, "_templates/state-of-eol-2027-gallery.md"));
  await writeFile(join(docs, "mizzen.yml"), JSON.stringify({ title: "Offing", base: "/offing", collections }));
  const data = await renderStudyCollections(".", process.env.OFFING_STATE_OF_EOL_TEST_ARCHIVE);
  const reportData = data["state-of-eol-2027.json"] ?? assert.fail("Missing study report");
  const report: { coverage: { scanned: number; cohort: number }; headlines: { ended: { count: number } } } =
    JSON.parse(reportData);
  const readme = await readFile("README.md", "utf8");
  const { scanned, cohort } = report.coverage;
  assert.ok(markdownDestinations(readme).has(publicReport));
  assert.ok(readme.includes(`${scanned} of ${cohort.toLocaleString("en")} pinned public GitHub repositories`));
  assert.ok(readme.includes(`${report.headlines.ended.count} of the ${scanned} successful scans`));
  for (const [file, contents] of Object.entries(data)) await writeFile(join(docs, "_data", file), contents);
  const deny = join(directory, "deny-network.mjs");
  await writeFile(
    deny,
    `import { Socket } from 'node:net';\nfunction deny() { throw Error('Unexpected network'); }\nSocket.prototype.connect = deny;\nglobalThis.fetch = deny;\n`,
  );
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      deny,
      mizzen,
      "build",
      docs,
      "--theme",
      join(tools, "node_modules/@velella/lateen"),
      "--out",
      out,
      "--workers",
      "1",
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  const html = await readFile(join(out, "reports/state-of-eol-2027/index.html"), "utf8");
  assert.match(html, /Headline estimates and evidence gaps/);
  assert.match(html, /bar-chart-svg/);
  assert.match(html, /Repositories with at least one finding by detector/);
  assert.match(html, /<table class="chart-data-table">/);
  const ecosystemData = data["state-of-eol-2027-ecosystems.json"] ?? assert.fail("Missing ecosystem data");
  const ecosystemRows: { id: string; affected: number }[] = JSON.parse(ecosystemData);
  for (const { id, affected } of ecosystemRows) {
    assert.ok(
      html.includes(`<th scope="row">${id}</th><td>${affected.toLocaleString("en")}</td>`),
      `Chart data table should show the same ${id} count`,
    );
  }
  assert.match(html, /Repositories with findings by detector/);
  assert.match(html, /GitHub Actions runtime declarations/);
  assert.match(html, /2027-raw\.json\.gz/);
  assert.doesNotMatch(html, /:field\[/);
  const gallery = await readFile(join(out, "gallery/state-of-eol-2027/index.html"), "utf8");
  const selection = await readCohort(defaultCohort);
  const pins = new Map(selection.repositories.map(({ repository, commit }) => [repository, commit]));
  const links = [
    ...gallery.matchAll(/href="https:\/\/velella\.sh\/offing\/forecast-web\/app\/#([^"]+)"[^>]*>([^<]+)<\/a>/g),
  ];
  assert.equal(links.length, 50);
  assert.equal(new Set(links.map(([, , label]) => label)).size, 50);
  for (const [, reference, label] of links) {
    assert.ok(reference && label);
    const { owner, repo, ref } = parseGitHubForecastInput(reference);
    assert.equal(label, `${owner}/${repo}`);
    assert.equal(ref, pins.get(label));
  }
});

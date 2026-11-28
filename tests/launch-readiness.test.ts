import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { collectReadiness, renderReadiness } from "../tools/launch-readiness.js";
import { countMilestoneIssues } from "../tools/launch-readiness/evidence.js";
import { checkSitemap, sitemapUrl } from "../tools/launch-readiness/site.js";
import { readColdInstall } from "../tools/launch-readiness/timing.js";

const home = "https://velella.sh/offing/";
const guide = `${home}guide/`;
const commit = "ab".repeat(20);

async function temporary(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "offing-readiness-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const sitemap = (...urls: string[]) => `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;
const html = (title: string) => `<!doctype html><html><head><title>${title}</title></head></html>`;

async function siteFixture(context: TestContext): Promise<string> {
  const directory = await temporary(context);
  await mkdir(join(directory, "guide"));
  await Promise.all([
    writeFile(join(directory, "sitemap.xml"), sitemap(home, guide)),
    writeFile(join(directory, "index.html"), html("Offing")),
    writeFile(join(directory, "guide", "index.html"), html("Guide · Offing")),
  ]);
  return directory;
}

test("counts across GitHub pages without double-counting repeated issues or counting pull requests", async () => {
  const pages: string[] = [];
  const result = await countMilestoneIssues(2, async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.github.com");
    if (url.pathname.endsWith("/milestones/2")) return Response.json({ number: 2, state: "open" });
    assert.equal(url.searchParams.get("milestone"), "2");
    assert.equal(url.searchParams.get("state"), "open");
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "manual");
    const page = url.searchParams.get("page") ?? "";
    pages.push(page);
    if (page === "1") {
      return Response.json(
        [
          { number: 1, state: "open" },
          { number: 3, state: "open", pull_request: {} },
        ],
        {
          headers: { link: '<https://untrusted.invalid/>; rel="next"' },
        },
      );
    }
    return Response.json([
      { number: 1, state: "open" },
      { number: 2, state: "open" },
    ]);
  });
  assert.equal(result, 2);
  assert.deepEqual(pages, ["1", "2"]);
});

test("compares every deployed sitemap title against the built site", async (context) => {
  const directory = await siteFixture(context);
  const result = await checkSitemap(directory, async (input, options) => {
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "manual");
    if (input === sitemapUrl) return new Response(sitemap(guide, home));
    if (input === guide) return new Response(html("Changed title"));
    assert.equal(input, home);
    return new Response(null, { status: 302, headers: { location: "https://untrusted.invalid/" } });
  });
  assert.deepEqual(result, {
    pages: 2,
    issues: [
      { address: home, kind: "mismatch", detail: "HTTP 302" },
      { address: guide, kind: "mismatch", detail: "Published title differs from build" },
    ],
  });
});

test("rejects an off-site location before doing any page request", async (context) => {
  const directory = await siteFixture(context);
  await assert.rejects(
    checkSitemap(directory, async (input) => {
      assert.equal(input, sitemapUrl);
      return new Response(sitemap(home, "https://untrusted.invalid/offing/guide/"));
    }),
    /Invalid sitemap origin/,
  );
});

test("retries a transient gateway failure once and checks the returned title", async (context) => {
  const directory = await siteFixture(context);
  let visits = 0;
  const result = await checkSitemap(directory, async (input) => {
    if (input === sitemapUrl) return new Response(sitemap(home, guide));
    if (input === guide) return new Response(html("Guide · Offing"));
    assert.equal(input, home);
    visits += 1;
    return visits === 1 ? new Response(null, { status: 503 }) : new Response(html("Offing"));
  });
  assert.equal(visits, 2);
  assert.deepEqual(result, { pages: 2, issues: [] });
});

test("reports measured zeros, unavailable evidence, and matching Markdown status from the same observations", async (context) => {
  const directory = await siteFixture(context);
  await writeFile(
    join(directory, "2026-W47.json"),
    JSON.stringify({ date: "2026-11-20", github: { stars: 0, forks: 1 }, npm: { downloads: 7 } }),
  );
  await writeFile(
    join(directory, "2026-W48.json"),
    JSON.stringify({ date: "2026-11-27", github: { stars: 500 }, npm: { downloads: 300 } }),
  );
  const result = await collectReadiness(
    { date: "2026-11-26", milestone: 2, commit, site: { directory, run: "123" } },
    async (input) => {
      if (input === sitemapUrl) return new Response(sitemap(home, guide));
      if (input === home) return new Response(html("Offing"));
      if (input === guide) return new Response(html("Guide · Offing"));
      const url = new URL(String(input));
      if (url.pathname.endsWith("/releases/latest")) return new Response(null, { status: 404 });
      if (url.pathname.endsWith("/milestones/2")) return Response.json({ number: 2, state: "open" });
      if (url.searchParams.get("milestone") === "2") return new Response(null, { status: 403 });
      assert.equal(url.searchParams.get("labels"), "bug,priority: P0");
      return Response.json([]);
    },
    directory,
  );
  const checks = new Map(result.checks.map((item) => [item.name, item]));
  assert.equal(checks.get("Open P0 bugs")?.observed, "0");
  assert.equal(checks.get("Open P0 bugs")?.status, "green");
  assert.equal(checks.get("Open milestone issues")?.observed, "Unavailable");
  assert.equal(checks.get("Open milestone issues")?.status, "amber");
  assert.equal(checks.get("Public pages")?.status, "green");
  assert.equal(checks.get("npm provenance")?.status, "amber");
  assert.equal(checks.get("Adoption")?.status, "amber");
  assert.match(
    checks.get("Adoption")?.observed ?? "",
    /Stars 0 .* Forks 1 .* Dependents unavailable .* npm downloads 7 .* Public workflow usage unavailable/,
  );
  assert.deepEqual(checks.get("Adoption")?.evidence, [
    `https://github.com/velella-sh/offing/blob/${commit}/metrics/2026-W47.json`,
  ]);
  const markdown = renderReadiness(result);
  for (const check of result.checks) {
    assert.ok(markdown.includes(`| ${check.name} | ${check.status} | ${check.observed} | ${check.thresholds} |`));
    assert.ok(check.evidence.every((address) => markdown.includes(address)));
  }
});

const timingMatrix = [
  ["ubuntu", "linux"],
  ["macos", "darwin"],
  ["windows", "win32"],
] as const;

async function timingFixture(
  directory: string,
  run: string,
  options: { output: number | null; candidate?: boolean; partial?: boolean },
) {
  for (const [runner, platform] of options.partial ? timingMatrix.slice(0, 1) : timingMatrix) {
    for (const node of [22, 24]) {
      const location = join(directory, run, `first-minute-${runner}-latest-node-${node}`);
      await mkdir(location, { recursive: true });
      await writeFile(
        join(location, "first-minute.json"),
        JSON.stringify({
          package: options.candidate ? { candidate: "offing-0.1.1.tgz" } : { published: "@velella/offing@0.1.1" },
          platform,
          node: `v${node}.2.0`,
          budgetMs: 10_000,
          timings: ["koa", "sampleproject", "bubbletea"].map((repository) => ({
            repository,
            firstOutputMs: options.output,
            npmReifyMs: 2_000,
            afterReifyMs: 100,
            downloadSpanMs: 1_000,
            tarballsFetched: 12,
            exitCode: 0,
          })),
        }),
      );
    }
  }
}

test("reports the latest valid exact npm install timings and rejects candidate and stale results", async (context) => {
  const directory = await temporary(context);
  await timingFixture(directory, "2026-10-12--11", { output: 2_000 });
  await timingFixture(directory, "2026-11-27--13", { output: 2_000, candidate: true });
  assert.equal(await readColdInstall(directory, "2026-11-27", "0.1.1"), undefined);
  await timingFixture(directory, "2026-11-26--12", { output: 9_999 });
  const complete = await readColdInstall(directory, "2026-11-27", "0.1.1");
  assert.equal(complete?.status, "green");
  assert.match(complete?.observed ?? "", /6\/6 pairs .* \(koa npm install 2\.000 s, forecast 9\.999 s/);
  await timingFixture(directory, "2026-11-27--14", { output: 2_000, partial: true });
  assert.equal((await readColdInstall(directory, "2026-11-27", "0.1.1"))?.status, "amber");
  await timingFixture(directory, "2026-11-27--15", { output: 10_000, partial: true });
  assert.equal((await readColdInstall(directory, "2026-11-27", "0.1.1"))?.status, "red");
  await timingFixture(directory, "2026-11-27--100", { output: null });
  const failed = await readColdInstall(directory, "2026-11-27", "0.1.1");
  assert.equal(failed?.status, "red");
  assert.match(failed?.observed ?? "", /6\/6 pairs .* Node 22 failed .* no forecast/);
  assert.match(failed?.evidence ?? "", /runs\/100$/);
});

function releaseFixture(score: number, exact: boolean, lifecycle: string): typeof fetch {
  return async (input, options) => {
    assert.equal(options?.credentials, "omit");
    assert.equal(options.redirect, "manual");
    const url = new URL(String(input));
    if (url.hostname === "api.securityscorecards.dev")
      return Response.json({
        score,
        date: "2026-11-26T08:20:00Z",
        repo: { name: "github.com/velella-sh/offing", commit: exact ? commit : "cd".repeat(20) },
      });
    assert.equal(url.origin, "https://api.github.com");
    if (url.pathname.endsWith("/releases/tags/v0.1.1"))
      return Response.json({ tag_name: "v0.1.1", published_at: "2026-11-12T08:50:33Z", draft: false });
    if (url.pathname.endsWith("/commits/v0.1.1")) return Response.json({ sha: commit });
    if (url.pathname.endsWith("/release.yml/runs")) {
      return Response.json({
        workflow_runs: [
          { id: 77, head_branch: "v0.1.1", head_sha: commit, event: "workflow_dispatch", status: "completed" },
          {
            id: 88,
            head_branch: "v0.1.1",
            head_sha: commit,
            event: "push",
            status: "completed",
            conclusion: "failure",
            updated_at: "2026-11-12T09:00:00Z",
            head_repository: { full_name: "velella-sh/offing" },
            path: ".github/workflows/release.yml",
          },
        ],
      });
    }
    if (url.pathname.endsWith("/runs/88/jobs"))
      return Response.json({
        jobs: [
          {
            name: "publish-npm / verify-provenance",
            conclusion: "success",
            steps: [{ name: "Verify the npm provenance", conclusion: "success" }],
          },
          {
            name: "sbom / verify-attestation / lifecycle",
            conclusion: lifecycle,
            steps: [{ name: "Verify published bytes with the GitHub CLI and Cosign", conclusion: lifecycle }],
          },
        ],
      });
    if (url.pathname.endsWith("/milestones/2")) return Response.json({ number: 2, state: "open" });
    assert.ok(url.pathname.endsWith("/issues"));
    return Response.json([{ number: 123, state: "open" }]);
  };
}

test("reports exact release verification and a complete zero adoption snapshot", async (context) => {
  const directory = await temporary(context);
  await writeFile(
    join(directory, "2026-W48.json"),
    JSON.stringify({
      date: "2026-11-26",
      github: {
        stars: 0,
        forks: 0,
        dependents: 0,
        publicWorkflowUsage: 0,
      },
      npm: { downloads: 0, start: "2026-11-18", end: "2026-11-24" },
    }),
  );
  const input = { commit, date: "2026-11-27", milestone: 2, version: "0.1.1" };
  const result = await collectReadiness(input, releaseFixture(7.8, false, "skipped"), directory);
  assert.equal(result.release?.version, "0.1.1");
  const checks = new Map(result.checks.map((item) => [item.name, item]));
  assert.equal(checks.get("Open P0 bugs")?.status, "red");
  assert.equal(checks.get("Adoption")?.status, "green");
  assert.match(
    checks.get("Adoption")?.observed ?? "",
    /Dependents 0 .* npm downloads \(2026-11-18 to 2026-11-24\) 0 .* Public workflow usage 0/,
  );
  assert.equal(checks.get("Cold install")?.status, "amber");
  assert.equal(checks.get("Scorecard")?.status, "amber");
  assert.match(checks.get("Scorecard")?.observed ?? "", /7\.8 .* different commit/);
  assert.equal(checks.get("npm provenance")?.status, "green");
  assert.match(checks.get("npm provenance")?.evidence[0] ?? "", /runs\/88$/);
  assert.equal(checks.get("Release attestation")?.status, "amber");
  for (const [score, lifecycle, status] of [
    [6, "success", "green"],
    [5.9, "failure", "red"],
  ] as const) {
    const exact = await collectReadiness(input, releaseFixture(score, true, lifecycle), directory);
    for (const name of ["Scorecard", "Release attestation"]) {
      assert.equal(exact.checks.find((item) => item.name === name)?.status, status);
    }
  }
});

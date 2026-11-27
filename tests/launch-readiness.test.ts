import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { collectReadiness, renderReadiness } from "../tools/launch-readiness.js";
import { countMilestoneIssues } from "../tools/launch-readiness/evidence.js";
import { checkSitemap, sitemapUrl } from "../tools/launch-readiness/site.js";

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
    /Stars 0 .* npm downloads 7 .* Dependents and public workflow usage unavailable/,
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

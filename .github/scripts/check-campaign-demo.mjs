import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [tools, site, out, record] = process.argv.slice(2);
assert(tools && site && out, "Expected site tools, served site root and evidence directory");
assert(record === undefined || record === "--record", "Unknown visual option");
const route = "/offing/campaigns/demo/";
const lateen = pathToFileURL(realpathSync(resolve(tools, "node_modules/@velella/lateen")) + "/").href;

// Node does not strip dependencies' TypeScript itself. Limit the loader to the published Lateen package.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith(lateen) || !url.endsWith(".ts")) return nextLoad(url, context);
    return {
      shortCircuit: true,
      format: "module",
      source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8")),
    };
  },
});

const { launchChromium, newVisualContext, settle, startServer, visualCheck } =
  await import(new URL("visual/index.ts", lateen).href);
const { AxeBuilder } = await import(pathToFileURL(join(resolve(tools), "node_modules/@axe-core/playwright/dist/index.mjs")).href);
const state = JSON.parse(await readFile("tests/fixtures/campaign-20/state.json", "utf8"));
const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const labels = { verified: "Verified", review: "Awaiting review", merged: "Merged", closed: "Closed", failed: "Failed" };

function expectedOwners() {
  const owners = new Map();
  for (const row of state.repositories) {
    for (const owner of new Set(row.owners.length ? row.owners : ["Unassigned"])) {
      const counts = owners.get(owner) ?? [0, 0, 0];
      counts[0]++;
      counts[1] += Number(row.status === "merged");
      counts[2] += Number(row.status === "review");
      owners.set(owner, counts);
    }
  }
  return [...owners].sort(([left], [right]) => left.localeCompare(right)).map(([owner, counts]) => [owner, ...counts.map(String)]);
}

const cells = (table) => table.locator("tbody tr").evaluateAll((rows) =>
  rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent.trim())));

async function checkContent(page) {
  assert.match(await page.locator("main").innerText(), /8 of 20 repositories merged.*3 are\s+awaiting review/su);
  const expectedRepos = state.repositories.map((row) => [
    row.name, String(row.batch), labels[row.status],
  ]);
  assert.deepEqual(await cells(page.getByRole("table", { name: "Recorded repository status" })), expectedRepos);
  assert.deepEqual(await cells(page.getByRole("table", { name: "Repository counts by owner" })), expectedOwners());
}

async function checkNavigation(page, origin) {
  const edit = await page.locator(".edit-page-link").getAttribute("href");
  assert.equal(edit, "https://github.com/velella-sh/offing/edit/main/docs/_templates/campaign-demo.md");
  for (const path of ["/FLEET/", "/CAMPAIGNS/", "/CAMPAIGN_BOARD/", "/campaigns/demo/"]) {
    const href = "/offing" + path;
    assert.ok(await page.locator(`nav a[href="${href}"]`).count(), "Missing navigation entry " + href);
    const response = await page.request.get(origin + href);
    assert.equal(response.status(), 200, href);
  }
}

async function audit(browser, origin) {
  const findings = [];
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const context = await newVisualContext(browser, origin, viewport);
    try {
      const page = await context.newPage();
      for (const theme of ["light", "dark"]) {
        await settle(page, origin + route, { theme });
        const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
        findings.push({ theme, viewport: viewport.width, violations: violations.map(({ id, impact }) => ({ id, impact })) });
      }
      await settle(page, origin + route, { forcedColors: true });
      assert.equal(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), true);
      await checkContent(page);
      await checkNavigation(page, origin);
      await page.keyboard.press("Tab");
      assert.match(await page.locator(":focus").innerText(), /skip to/i);
    } finally {
      await context.close();
    }
  }
  return findings;
}

await mkdir(out, { recursive: true });
const server = await startServer(site, "");
let browser;
try {
  browser = await launchChromium();
  const findings = await audit(browser, server.url);
  await writeFile(join(out, "accessibility.json"), JSON.stringify({ wcag, findings }, null, 2) + "\n");
  assert.deepEqual(findings.flatMap(({ violations }) =>
    violations.filter(({ impact }) => impact === "critical" || impact === "serious")), []);
  console.log("Campaign Board demo verified repository and owner rows, navigation, keyboard and forced colors.");
} finally {
  await browser?.close();
  await server.close();
}

const visual = await visualCheck({
  site,
  pages: [
    { name: "campaign-demo", path: route, viewport: "desktop" },
    { name: "campaign-demo", path: route, viewport: "mobile" },
  ],
  out,
  baselines: record ? join(out, "baselines") : ".github/campaign-demo/baselines",
  update: record === "--record",
});
console.log(visual.lines.join("\n"));
assert.equal(visual.ok, true, "Campaign Board visual gate failed");

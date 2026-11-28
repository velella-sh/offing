import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const siteUrl = "https://velella.sh/offing/";
const routes = {
  "launch/FAQ/": {
    "recorded migration walkthrough": "launch/let-autopilot-do-the-upgrade/",
    "Fleet walkthrough": "launch/every-repository-at-once/",
    "artifact and release gate walkthrough": "launch/prove-what-you-ship/",
  },
  "launch/": { "forecast and plan across repositories": "launch/every-repository-at-once/" },
  "launch/every-repository-at-once/": {
    "Fleet guide": "FLEET/",
    "Fleet forecast guide": "FLEET_FORECAST/",
    "campaign walkthrough": "CAMPAIGNS/#replay-the-recorded-nodejs-18-to-22-campaign",
  },
};
const pages = [
  "launch/README.md",
  "launch/FAQ.md",
  "launch/let-autopilot-do-the-upgrade.md",
  "launch/every-repository-at-once.md",
  "launch/prove-what-you-ship.md",
  "FLEET.md",
  "FLEET_FORECAST.md",
  "CAMPAIGNS.md",
];

test("the built launch FAQ, index and Fleet guide link to existing site routes", async (t) => {
  const tools = resolve(process.env.OFFING_SITE_TOOLS ?? ".github/site-tools");
  const mizzen = join(tools, "node_modules/@velella/mizzen/bin/mizzen.js");
  const theme = join(tools, "node_modules/@velella/lateen");
  try {
    await access(mizzen);
  } catch {
    if (process.env.OFFING_SITE_TOOLS) throw new Error(`Mizzen is missing under ${tools}`);
    t.skip("Install .github/site-tools to run the launch site route check.");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "offing-launch-links-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "docs");
  const out = join(root, "site");
  for (const page of pages) {
    await mkdir(dirname(join(source, page)), { recursive: true });
    await copyFile(join("docs", page), join(source, page));
  }
  const config = { title: "Offing", base: "/offing", url: new URL(siteUrl).origin };
  await writeFile(join(source, "mizzen.yml"), JSON.stringify(config));
  await promisify(execFile)(
    process.execPath,
    [mizzen, "build", source, "--theme", theme, "--out", out, "--workers", "1"],
    { maxBuffer: 2 * 1024 * 1024 },
  );

  await checkBuiltRoutes(out);
});

async function checkBuiltRoutes(out: string): Promise<void> {
  for (const [sourceRoute, targets] of Object.entries(routes)) {
    const html = await readFile(join(out, sourceRoute, "index.html"), "utf8");
    const links = Array.from(html.matchAll(/<a\b[^>]* href="([^"]+)"[^>]*>([^<]+)<\/a>/gu));
    for (const [label, target] of Object.entries(targets)) {
      const link = links.find(([, , text]) => text?.trim() === label);
      assert.ok(link?.[1], `${sourceRoute} should contain the ${label} link`);
      assert.equal(new URL(link[1], siteUrl + sourceRoute).href, siteUrl + target, `${sourceRoute} ${label}`);
      const [page, fragment] = target.split("#");
      assert.ok(page);
      const destination = await readFile(join(out, page, "index.html"), "utf8");
      if (fragment) assert.ok(destination.includes(`id="${fragment}"`), target);
    }
  }
}

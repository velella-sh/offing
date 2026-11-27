import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const [cli, packageDirectory, tools, fixture] = process.argv.slice(2).map((path) => resolve(path));
assert(cli && packageDirectory && tools && fixture, "Expected installed CLI, package directory, site tools and synthetic state");
const run = promisify(execFile);
const work = await mkdtemp(join(tmpdir(), "offing-campaign-board-smoke-"));
const source = join(work, "source");
const site = join(work, "site");
const theme = join(tools, "@velella/lateen");
const mizzen = join(tools, "@velella/mizzen/bin/mizzen.js");
const read = (path) => readFile(path, "utf8");
try {
  await run(process.execPath, [cli, "campaign-board", fixture, "--out", source], { cwd: work });
  assert.equal((await readdir(source, { recursive: true })).some((path) => /\.(html|css)$/i.test(path)), false);
  await read(join(packageDirectory, "templates/campaign-board/pages.yml"));
  await run(process.execPath, [mizzen, "check", source, "--theme", theme], { cwd: work, timeout: 60_000 });
  await run(process.execPath, [mizzen, "build", source, "--theme", theme, "--base", "/operations", "--out", site], {
    cwd: work, timeout: 60_000,
  });
  const page = await read(join(site, "index.html"));
  assert.match(page, /<span class="status-label">Awaiting review<\/span>/);
  assert.match(page, /class="stat-strip"/);
  assert.match(page, /Recorded batch activity/);
  assert.match(page, /2026-11-27 UTC/);
  assert.match(page, /example\/service/);
  assert.match(page, /@example\/operations/);
  assert.match(page, /Operations &lt;review&gt;/);
  assert.match(page, /Repository progress/);
  const badge = await read(join(site, "campaign-progress.svg"));
  assert.match(badge, /aria-label="campaign: 1\/4 merged"/);
  console.log("acc-campaign-board: installed CLI, released renderer, textual states, projection and badge passed");
} finally {
  await rm(work, { recursive: true, force: true });
}

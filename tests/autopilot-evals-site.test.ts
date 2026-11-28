import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { reportAutopilotFixture } from "../benchmarks/autopilot-evals/report.js";
import { prepareAutopilotScoreboard, validateScoreboard } from "../benchmarks/autopilot-evals/scoreboard.js";
import { digest } from "../src/proof/document.js";

const fixture = resolve("tests/fixtures/autopilot-evals/recorded/results.json");
const labels = ["Green", "Stopped by budget", "Excluded", "Failed"];

test("acc-autopilot-evals validates recorded fixture counts and refuses malformed scoreboard data", async () => {
  const summary = validateScoreboard(await reportAutopilotFixture(fixture));
  assert.equal(summary.total, 4);
  assert.deepEqual(summary.counts, { green: 1, "stopped-by-budget": 1, excluded: 1, failed: 1 });
  assert.deepEqual(summary.rates, { green: 0.25, "stopped-by-budget": 0.25, excluded: 0.25, failed: 0.25 });
  assert.deepEqual(summary.turns, { median: 1, samples: 3 });
  assert.deepEqual(summary.costUsd, { median: 0, samples: 3 });
  for (const value of [
    { ...summary, source: "measured" },
    { ...summary, total: 5 },
    { ...summary, nonGreen: summary.nonGreen.slice(1) },
    { ...summary, elapsedMs: { samples: 5, median: null } },
    { ...summary, rates: { ...summary.rates, failed: 0 } },
  ]) {
    assert.throws(() => validateScoreboard(value));
  }
});

test("acc-autopilot-evals builds matching accessible table and chart offline with pinned site tools", async (t) => {
  if (!process.env.OFFING_SITE_TOOLS) return t.skip("Set OFFING_SITE_TOOLS to the pinned site dependencies.");
  const tools = resolve(process.env.OFFING_SITE_TOOLS);
  const mizzen = join(tools, "node_modules/@velella/mizzen/bin/mizzen.js");
  const theme = join(tools, "node_modules/@velella/lateen");
  await access(mizzen);
  const directory = await mkdtemp(join(tmpdir(), "offing-eval-scoreboard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const out = join(directory, "site");
  await prepareAutopilotScoreboard(fixture, source);
  const deny = join(directory, "deny-network.mjs");
  await writeFile(
    deny,
    `import { Socket } from 'node:net';\nfunction deny() { throw Error('Unexpected network'); }\nSocket.prototype.connect = deny;\nglobalThis.fetch = deny;\n`,
  );
  await promisify(execFile)(
    process.execPath,
    ["--import", deny, mizzen, "build", source, "--theme", theme, "--out", out, "--workers", "1"],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  const html = await readFile(join(out, "autopilot-evals/index.html"), "utf8");
  assert.match(html, /<h1[^>]*>Autopilot fixture scoreboard<\/h1>/u);
  assert.match(html, /recorded cases from synthetic repositories/u);
  const table = /<table\b[^>]*>[\s\S]*?<\/table>/u.exec(html)?.[0] ?? assert.fail("Missing native table");
  const chart = /<svg\b[^>]*bar-chart-svg[^>]*>[\s\S]*?<\/svg>/u.exec(html)?.[0] ?? assert.fail("Missing native chart");
  assert.match(table, /<caption[^>]*>Recorded fixture outcomes<\/caption>/u);
  assert.match(table, /<th[^>]*scope="col"[^>]*>Outcome(?:<button|<\/th>)/u);
  assert.match(chart, /role="img"/u);
  assert.match(chart, /aria-labelledby="[^"]+"/u);
  for (const label of labels) {
    assert.match(table, new RegExp(`${label}</td>\\s*<td[^>]*>1</td>\\s*<td[^>]*>25%</td>`, "u"));
    assert.match(
      chart,
      new RegExp(`${label}</text>\\s*<rect[^>]*></rect>\\s*<text class="bar-chart-value"[^>]*>1</text>`, "u"),
    );
  }
  const summary = validateScoreboard(await reportAutopilotFixture(fixture));
  for (const { id, lastFailure } of summary.nonGreen) {
    const href = `/failures/${id}.txt`;
    const anchor = new RegExp(`<a\\b[^>]*href="${href.replace(".", "\\.")}"[^>]*>[^<]+</a>`, "u").exec(html)?.[0];
    assert.ok(anchor, `Missing keyboard-reachable link for ${id}`);
    assert.doesNotMatch(anchor, /tabindex="-1"/u);
    assert.equal(digest(await readFile(join(out, "failures", `${id}.txt`))), lastFailure.sha256);
  }
});

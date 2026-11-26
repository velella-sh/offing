import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { writeChart } from "../tools/launch-metrics/chart.js";
import { collectLaunchMetrics, isoWeek, writeSnapshot } from "../tools/launch-metrics/index.js";

const github = "https://api.github.com/repos/velella-sh/offing";
const npm = "https://api.npmjs.org/downloads/point/last-week/@velella/offing";
const registry = "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.velella-sh%2Foffing/versions/latest";
const publicResponses = new Map<string, unknown>([
  [github, { stargazers_count: 6, forks_count: 2, owners: ["not in the snapshot"] }],
  [npm, { package: "@velella/offing", downloads: 120, start: "2026-11-16", end: "2026-11-22" }],
  [
    registry,
    {
      server: { name: "io.github.velella-sh/offing" },
      _meta: { "io.modelcontextprotocol.registry/official": { status: "active" } },
    },
  ],
]);
const date = new Date("2026-11-23T07:23:00Z");

test("collects only aggregates from the three anonymous public endpoints and rejects redirects", async () => {
  const calls: string[] = [];
  const snapshot = await collectLaunchMetrics(date, async (input, init) => {
    assert.equal(typeof input, "string");
    const url = String(input);
    assert.ok(publicResponses.has(url), `Unexpected endpoint: ${url}`);
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.body, undefined);
    assert.deepEqual(init?.headers, { accept: "application/json" });
    calls.push(url);
    return Response.json(publicResponses.get(url));
  });
  assert.deepEqual(calls.sort(), [github, npm, registry].sort());
  assert.deepEqual(snapshot, {
    date: "2026-11-23",
    week: "2026-W48",
    github: { stars: 6, forks: 2 },
    npm: { downloads: 120, start: "2026-11-16", end: "2026-11-22" },
    listings: { officialRegistry: 1 },
  });
});

test("GitHub rate limiting fails clearly and a missing registry listing counts as zero", async () => {
  await assert.rejects(
    collectLaunchMetrics(date, async (input) =>
      input === github
        ? new Response(null, { status: 403, headers: { "x-ratelimit-remaining": "0" } })
        : Response.json(publicResponses.get(String(input))),
    ),
    /GitHub rate limit reached/,
  );
  const snapshot = await collectLaunchMetrics(date, async (input) =>
    input === registry ? new Response(null, { status: 404 }) : Response.json(publicResponses.get(String(input))),
  );
  assert.deepEqual(snapshot.listings, { officialRegistry: 0 });
  await assert.rejects(
    collectLaunchMetrics(date, async (input) =>
      input === registry ? new Response(null, { status: 503 }) : Response.json(publicResponses.get(String(input))),
    ),
    /MCP Registry.*503/,
  );
});

test("weekly updates preserve other weeks and the one-time baseline, and chart both weeks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "offing-launch-metrics-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const now = await collectLaunchMetrics(date, async (input) => Response.json(publicResponses.get(String(input))));
  const before = { ...now, date: "2026-11-16", week: "2026-W47", github: { stars: 5, forks: 1 } };
  const oldFile = await writeSnapshot(directory, before);
  const oldContents = await readFile(oldFile, "utf8");
  const currentFile = await writeSnapshot(directory, now);
  const updated = { ...now, date: "2026-11-24", github: { stars: 8, forks: 2 } };
  assert.equal(await writeSnapshot(directory, updated), currentFile);
  assert.deepEqual(JSON.parse(await readFile(currentFile, "utf8")), updated);
  assert.equal(await readFile(oldFile, "utf8"), oldContents);
  const baseline = await writeSnapshot(directory, now, true);
  await assert.rejects(writeSnapshot(directory, updated, true), { code: "EEXIST" });
  assert.deepEqual(JSON.parse(await readFile(baseline, "utf8")), now);

  await writeChart(directory);
  const svg = await readFile(join(directory, "chart.svg"), "utf8");
  assert.match(svg, /2026-W47.*2026-W48/);
  assert.match(svg, /<title>GitHub stars: 5<\/title>/);
  assert.match(svg, /<title>GitHub stars: 8<\/title>/);
  assert.equal(svg.match(/<title>npm downloads: 120<\/title>/g)?.length, 2);
  assert.deepEqual((await readdir(directory)).sort(), ["2026-W47.json", "2026-W48.json", "baseline.json", "chart.svg"]);
});

test("ISO weeks use the UTC week-year on both sides of New Year", () => {
  assert.equal(isoWeek(new Date("2021-01-01T00:00:00Z")), "2020-W53");
  assert.equal(isoWeek(new Date("2018-12-31T00:00:00Z")), "2019-W01");
});

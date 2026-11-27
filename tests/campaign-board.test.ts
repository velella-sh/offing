import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { writeCampaignBoard } from "../src/campaign-board/export.js";
import { campaignBoard } from "../src/campaign-board/model.js";
import { readCampaignState } from "../src/campaign/document.js";
import { runCli } from "./cli-runner.js";

const fixture = resolve("tests/fixtures/campaign-board/synthetic-state.json");

test("progress counts terminal, merged, review, ownership and recorded batch pace independently", async () => {
  const state = await readCampaignState(fixture);
  const board = campaignBoard(state);
  assert.deepEqual(board.summary, {
    id: "synthetic-board",
    asOf: "2026-11-20",
    observedAt: "2026-11-23T10:00:00.000Z",
    total: 4,
    complete: 2,
    merged: 1,
    awaitingReview: 1,
    omitted: 1,
    completedBatches: 2,
    remainingBatches: 2,
    meanIntervalMs: 172800000,
    projectedFinish: "2026-11-27T10:00:00.000Z",
  });
  assert.deepEqual(
    board.owners.map(({ owner, total, complete, merged, awaitingReview }) => [
      owner,
      total,
      complete,
      merged,
      awaitingReview,
    ]),
    [
      ["Unassigned", 1, 0, 0, 0],
      ["@example/operations", 2, 1, 0, 1],
      ["@example/platform", 2, 2, 1, 0],
      ["Operations <review>", 1, 0, 0, 1],
    ],
  );
  assert.equal(board.repositories.length, 4);
  assert.deepEqual(
    board.activity.map(({ status }) => status),
    ["completed", "completed", "incomplete"],
  );
});

test("projection stays unavailable with too little timing evidence or no batches left", async () => {
  const state = await readCampaignState(fixture);
  const incomplete = { ...state, repositories: state.repositories.filter(({ batch }) => batch !== 2) };
  assert.equal(campaignBoard(incomplete).summary.projectedFinish, null);
  const finished = { ...state, repositories: state.repositories.slice(0, 2) };
  assert.equal(campaignBoard(finished).summary.projectedFinish, null);
  const simultaneous = structuredClone(state);
  for (const [index, row] of simultaneous.repositories.entries()) {
    if (index === 1) row.transitions = row.transitions.map((entry) => ({ ...entry, at: "2026-11-20T10:00:00.000Z" }));
  }
  assert.equal(campaignBoard(simultaneous).summary.projectedFinish, null);
  assert.equal(campaignBoard({ ...state, repositories: [] }).summary.total, 0);
});

test("the CLI exports collections, Markdown and an accessible SVG without overwriting a board", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-campaign-board-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "board");
  const args = ["campaign-board", fixture, "--out", output];
  const result = await runCli(args);
  assert.equal(result.code, 0, result.stderr);
  const files = (await readdir(output, { recursive: true })).map((file) => file.replaceAll("\\", "/"));
  assert.deepEqual(
    files.sort(),
    [
      "_data",
      "_data/activity.json",
      "_data/owners.json",
      "_data/repositories.json",
      "_data/summary.json",
      "campaign-progress.svg",
      "index.md",
      "mizzen.yml",
    ].sort(),
  );
  const page = await readFile(join(output, "index.md"), "utf8");
  assert.match(page, /Projected finish: \*\*2026-11-27 UTC\*\* \(estimate\)/);
  assert.match(page, /2 completed batches, 2 remaining/);
  assert.match(await readFile(join(output, "campaign-progress.svg"), "utf8"), /aria-label="campaign: 1\/4 merged"/);
  assert.equal((await runCli(args)).code, 2);
  assert.equal(await readFile(join(output, "index.md"), "utf8"), page);

  const invalid = join(root, "invalid.json");
  await writeFile(invalid, "{}");
  assert.equal((await runCli(["campaign-board", invalid, "--out", join(root, "invalid-board")])).code, 2);
  assert.equal((await runCli(["campaign-board", fixture])).code, 2);
  assert.equal((await runCli(["campaign-board", fixture, "--unexpected"])).code, 2);
  assert.deepEqual((await readdir(root)).sort(), ["board", "invalid.json"]);
});

test("the export of an untouched plan explains the missing projection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-campaign-queued-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "board");
  const planned = resolve("docs/spec/campaign/conformance/valid-state.json");
  const result = await runCli(["campaign-board", planned, "--out", output]);
  assert.equal(result.code, 0, result.stderr);
  const page = await readFile(join(output, "index.md"), "utf8");
  assert.match(page, /Projection unavailable. 0 completed batches, 1 remaining/);
  assert.doesNotMatch(page, /::timeline/);
});

test("concurrent exports publish a single complete board with no staging files left", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-campaign-board-concurrent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = await readCampaignState(fixture);
  const directory = join(root, "board");
  const results = await Promise.allSettled([
    writeCampaignBoard(state, directory),
    writeCampaignBoard(state, directory),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
  assert.deepEqual(await readdir(root), ["board"]);
  assert.match(await readFile(join(directory, "mizzen.yml"), "utf8"), /repositories:/);
});

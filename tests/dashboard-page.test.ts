import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  DETECTORS_COLLECTION_FILE,
  ECOSYSTEMS_COLLECTION_FILE,
  MINIMUMS_COLLECTION_FILE,
  RUN_COLLECTION_FILE,
  renderDashboardCollections,
  renderDashboardData,
  type DashboardData,
} from "../tools/build-dashboard-data.js";

test("docs/dashboard/index.md uses Lateen record-table and bar-chart components and documents not measured", async () => {
  const page = await readFile(resolve("docs/dashboard/index.md"), "utf8");
  assert.match(page, /^permalink:\s*\/dashboard\/$/m);
  assert.match(page, /::record-table\{from="dashboard-run"/);
  assert.match(page, /::bar-chart\{from="dashboard\.corpus\.ecosystems"/);
  assert.match(page, /::record-table\{from="dashboard-ecosystems"/);
  assert.match(page, /::record-table\{from="dashboard"/);
  assert.match(page, /::record-table\{from="dashboard-minimums"/);
  assert.match(page, /"not measured"/);
  assert.match(page, /runAgeDays/);
});

test("renderDashboardCollections emits Mizzen collection arrays with not measured for null values", async () => {
  const data = JSON.parse(await renderDashboardData(".", "run-date")) as DashboardData;
  const collections = renderDashboardCollections(data);
  const detectors = JSON.parse(collections[DETECTORS_COLLECTION_FILE]!) as Array<Record<string, unknown>>;
  const ecosystems = JSON.parse(collections[ECOSYSTEMS_COLLECTION_FILE]!) as Array<Record<string, unknown>>;
  const minimums = JSON.parse(collections[MINIMUMS_COLLECTION_FILE]!) as Array<Record<string, unknown>>;
  const run = JSON.parse(collections[RUN_COLLECTION_FILE]!) as Array<Record<string, unknown>>;

  assert.equal(detectors.length, data.detectors.length);
  assert.equal(ecosystems.length, data.corpus.ecosystems.length);
  assert.equal(minimums.length, Object.keys(data.evidenceMinimums).length);
  assert.equal(run.length, 1);
  assert.equal(run[0]!.medianScanMs, "not measured");
  assert.equal(run[0]!.p95ScanMs, "not measured");
  assert.equal(run[0]!.staleStatus, "fresh");
});

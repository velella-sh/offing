import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  SUITE_SIZE,
  formatSuiteMarkdown,
  loadLargeMonorepoSuite,
  mergeSuiteResults,
  measureSuiteTargets,
  resolveSuiteTargets,
  type LargeMonorepoSuiteResult,
} from "../benchmarks/large-monorepos.js";
import { createSyntheticMonorepo } from "../benchmarks/monorepo.js";

test("the committed suite lists exactly five unique pinned repositories including next.js", () => {
  const suite = loadLargeMonorepoSuite();
  assert.equal(suite.schemaVersion, "offing.large-monorepos.v1");
  assert.equal(suite.repositories.length, SUITE_SIZE);
  assert.equal(suite.repositories.length, new Set(suite.repositories.map((pin) => pin.id)).size);
  assert.ok(suite.repositories.some((pin) => pin.repository === "vercel/next.js"));
  for (const pin of suite.repositories) {
    assert.match(pin.commit, /^[0-9a-f]{40}$/);
    assert.match(pin.repository, /^[^/]+\/[^/]+$/);
  }
});

test("the nightly workflow reads the suite JSON and publishes the merged artifact", () => {
  const workflow = readFileSync(resolve(".github/workflows/large-monorepos.yml"), "utf8");
  assert.match(workflow, /cron:/);
  assert.match(workflow, /benchmarks\/large-monorepos\.json/);
  assert.match(workflow, /dist\/benchmarks\/large-monorepos\.js/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /--merge shard-results/);
});

test("resolveSuiteTargets requires a local checkout per id and supports --only", async () => {
  const suite = loadLargeMonorepoSuite();
  const root = await mkdtemp(join(tmpdir(), "offing-large-mono-root-"));
  try {
    const first = suite.repositories[0]!;
    await mkdir(join(root, first.id), { recursive: true });
    assert.throws(() => resolveSuiteTargets(suite, root), /missing checkout/);
    const targets = resolveSuiteTargets(suite, root, [first.id]);
    assert.equal(targets.length, 1);
    assert.equal(targets[0]!.pin.id, first.id);
    assert.throws(() => resolveSuiteTargets(suite, root, ["no-such-id"]), /unknown suite id/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("measureSuiteTargets records wall time and peak memory for a local checkout", async () => {
  const synthetic = await createSyntheticMonorepo({ fileCount: 40, packages: 4 });
  try {
    const pin = {
      id: "fixture-mono",
      repository: "example/fixture",
      commit: "0123456789abcdef0123456789abcdef01234567",
    };
    const result = await measureSuiteTargets([{ pin, path: synthetic.directory }], {
      warmupRuns: 0,
      measuredRuns: 1,
    });
    assert.equal(result.schemaVersion, "offing.large-monorepos-result.v1");
    assert.equal(result.measurements.length, 1);
    const measurement = result.measurements[0]!;
    assert.equal(measurement.id, pin.id);
    assert.equal(measurement.repository, pin.repository);
    assert.ok(measurement.fileCount >= 40);
    assert.ok(measurement.meanWallMs > 0);
    assert.ok(measurement.peakRssBytes > 0);
    assert.ok(measurement.findingsCount > 0);
  } finally {
    await synthetic.cleanup();
  }
});

test("mergeSuiteResults orders rows by the committed suite and formatSuiteMarkdown names time and memory", () => {
  const suite = loadLargeMonorepoSuite();
  const shard = (index: number): LargeMonorepoSuiteResult => {
    const pin = suite.repositories[index]!;
    return {
      schemaVersion: "offing.large-monorepos-result.v1",
      timestamp: "2026-11-14T00:00:00.000Z",
      platform: "linux",
      arch: "x64",
      nodeVersion: "v22.0.0",
      measurements: [
        {
          id: pin.id,
          repository: pin.repository,
          commit: pin.commit,
          path: `/tmp/${pin.id}`,
          fileCount: 1000 + index,
          meanWallMs: 10 + index,
          peakRssBytes: (100 + index) * 1024 * 1024,
          findingsCount: index,
          wallMsPerRun: [10 + index],
        },
      ],
    };
  };
  // Merge out of order to prove suite order wins.
  const merged = mergeSuiteResults([shard(4), shard(0), shard(2), shard(1), shard(3)]);
  assert.deepEqual(
    merged.measurements.map((row) => row.id),
    suite.repositories.map((pin) => pin.id),
  );
  const markdown = formatSuiteMarkdown(merged);
  assert.match(markdown, /Mean wall \(ms\)/);
  assert.match(markdown, /Peak RSS \(MB\)/);
  assert.match(markdown, /vercel\/next\.js/);
  assert.match(markdown, /offline/);
});

test("mergeSuiteResults fails when a suite member is absent", () => {
  const suite = loadLargeMonorepoSuite();
  const pin = suite.repositories[0]!;
  const partial: LargeMonorepoSuiteResult = {
    schemaVersion: "offing.large-monorepos-result.v1",
    timestamp: "2026-11-14T00:00:00.000Z",
    platform: "linux",
    arch: "x64",
    nodeVersion: "v22.0.0",
    measurements: [
      {
        id: pin.id,
        repository: pin.repository,
        commit: pin.commit,
        path: `/tmp/${pin.id}`,
        fileCount: 1,
        meanWallMs: 1,
        peakRssBytes: 1024,
        findingsCount: 0,
        wallMsPerRun: [1],
      },
    ],
  };
  assert.throws(() => mergeSuiteResults([partial]), /missing/);
});

test("write and load helpers round-trip a result file", async () => {
  const { writeSuiteResult, loadSuiteResultsFromDirectory } = await import("../benchmarks/large-monorepos.js");
  const dir = await mkdtemp(join(tmpdir(), "offing-large-mono-out-"));
  try {
    const suite = loadLargeMonorepoSuite();
    const pin = suite.repositories[0]!;
    const result: LargeMonorepoSuiteResult = {
      schemaVersion: "offing.large-monorepos-result.v1",
      timestamp: "2026-11-14T00:00:00.000Z",
      platform: "linux",
      arch: "x64",
      nodeVersion: "v22.0.0",
      measurements: [
        {
          id: pin.id,
          repository: pin.repository,
          commit: pin.commit,
          path: `/tmp/${pin.id}`,
          fileCount: 12,
          meanWallMs: 3,
          peakRssBytes: 2048,
          findingsCount: 0,
          wallMsPerRun: [3],
        },
      ],
    };
    await writeFile(join(dir, "shard.json"), "");
    writeSuiteResult(result, join(dir, "shard.json"));
    const loaded = loadSuiteResultsFromDirectory(dir);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.measurements[0]!.id, pin.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

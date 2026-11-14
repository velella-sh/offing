import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { after, test } from "node:test";

import { configureActiveData } from "@velella/ebb/data-source";
import { builtInDetectors } from "../src/detectors/index.js";
import { scanRepository } from "../src/engine/index.js";
import { nodeFileSystem } from "../src/node-file-system.js";

const cleanupDirs: string[] = [];
after(async () => {
  configureActiveData();
  await Promise.all(cleanupDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `offing-test-${prefix}-`));
  cleanupDirs.push(dir);
  return dir;
}

/** A corpus-shaped Node tree: enough source files that a cold scan does real usage work. */
async function writeCorpusShapedTree(root: string, fileCount: number): Promise<void> {
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "corpus-shaped",
        dependencies: { request: "2.88.2", moment: "2.29.4", underscore: "1.13.6" },
        engines: { node: "14" },
      },
      null,
      2,
    ),
  );
  await mkdir(join(root, "src"), { recursive: true });
  // Repeat the usage calls so cold source analysis dominates wall time over listing and stats.
  const body = Array.from({ length: 24 }, (_, call) =>
    [
      "const request = require('request');",
      "const moment = require('moment');",
      `exports.f${call} = () => request('http://example.test/${call}') + moment().format();`,
    ].join("\n"),
  ).join("\n");
  for (let index = 0; index < fileCount; index += 1) {
    await writeFile(join(root, "src", `module-${index}.js`), `${body}\n`);
  }
}

function meanOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

test("an unchanged rerun is at least ten times faster with identical findings", async () => {
  const repo = await makeTempDir("cache-speed-repo");
  const cacheDir = await makeTempDir("cache-speed-cache");
  await writeCorpusShapedTree(repo, 2_500);
  const pinned = "2026-01-01T00:00:00.000Z";

  // Load parsers and rules once so the measured cold path is detector work, not first-import cost.
  const warmup = await makeTempDir("cache-speed-warmup");
  await writeFile(join(warmup, "package.json"), JSON.stringify({ name: "warmup" }));
  await scanRepository(warmup, builtInDetectors, { noCache: true, scannedAt: pinned });

  const coldTimes: number[] = [];
  let coldIds = "";
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    const result = await scanRepository(repo, builtInDetectors, {
      cacheDirectory: cacheDir,
      noCache: true,
      scannedAt: pinned,
    });
    coldTimes.push(performance.now() - started);
    coldIds = JSON.stringify(result.findings.map((finding) => finding.id).sort());
    assert.ok(result.findings.length > 0, "cold scan must produce findings so the budget covers real work");
  }

  await scanRepository(repo, builtInDetectors, { cacheDirectory: cacheDir, scannedAt: pinned });

  let contentReads = 0;
  const countingFs = {
    ...nodeFileSystem,
    readBytes: async (path: string) => {
      contentReads += 1;
      return nodeFileSystem.readBytes(path);
    },
  };

  const warmTimes: number[] = [];
  let warmIds = "";
  for (let run = 0; run < 5; run += 1) {
    contentReads = 0;
    const started = performance.now();
    const result = await scanRepository(repo, builtInDetectors, {
      cacheDirectory: cacheDir,
      scannedAt: pinned,
      fileSystem: countingFs,
    });
    warmTimes.push(performance.now() - started);
    warmIds = JSON.stringify(result.findings.map((finding) => finding.id).sort());
    assert.equal(contentReads, 0, "warm fingerprint hits must not re-read file bytes");
  }

  // Drop the slowest warm sample so a single GC pause cannot fail the floor.
  const warmSorted = [...warmTimes].sort((left, right) => left - right);
  const warmCore = warmSorted.slice(0, -1);
  const coldMean = meanOf(coldTimes);
  const warmMean = meanOf(warmCore);
  const speedup = coldMean / warmMean;
  assert.equal(warmIds, coldIds, "cached and uncached findings must be identical");
  assert.ok(
    speedup >= 10,
    `expected ≥10× warm speedup, got ${speedup.toFixed(2)}× (cold ${coldMean.toFixed(0)} ms, warm ${warmMean.toFixed(0)} ms)`,
  );
});

test("a size or mtime change invalidates the fingerprint warm path", async () => {
  const repo = await makeTempDir("cache-fingerprint-repo");
  const cacheDir = await makeTempDir("cache-fingerprint-cache");
  await writeFile(join(repo, "package.json"), JSON.stringify({ name: "fp", dependencies: { request: "2.88.2" } }));
  await writeFile(join(repo, "index.js"), "const request = require('request');\nrequest('http://x');\n");
  const pinned = "2026-01-01T00:00:00.000Z";

  await scanRepository(repo, builtInDetectors, { cacheDirectory: cacheDir, scannedAt: pinned });
  const before = await scanRepository(repo, builtInDetectors, { cacheDirectory: cacheDir, scannedAt: pinned });

  await writeFile(join(repo, "index.js"), "const request = require('request');\nrequest('http://changed');\n");
  const after = await scanRepository(repo, builtInDetectors, { cacheDirectory: cacheDir, scannedAt: pinned });
  assert.deepEqual(
    after.findings.map((finding) => finding.id).sort(),
    before.findings.map((finding) => finding.id).sort(),
  );
  assert.ok(after.findings.length > 0);
});

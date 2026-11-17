import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { join } from "node:path";

import { directorySize } from "../benchmarks/corpus-cost.js";
import { checkout, cliLimits, forecastArgs, readCorpus, runCli, validationDir } from "./run.js";

const system = platform();
assert.ok(system === "darwin" || system === "linux", "this measurement uses macOS or GNU time");
const corpus = await readCorpus();
const sizes = [];
for (const entry of corpus.repositories) {
  const path = await checkout(entry);
  sizes.push({ repository: entry.repository, checkoutBytes: await directorySize(path), path });
}
sizes.sort(
  (left, right) => right.checkoutBytes - left.checkoutBytes || left.repository.localeCompare(right.repository),
);

const measurements = [];
for (const { path, ...entry } of sizes.slice(0, 10)) {
  const args = system === "darwin" ? ["-l"] : ["-f", "peak_rss_kib=%M"];
  const started = performance.now();
  const { stderr } = await runCli(
    "/usr/bin/time",
    [...args, process.execPath, ...forecastArgs(corpus, path)],
    cliLimits,
  );
  const durationMs = Math.round(performance.now() - started);
  const rss =
    system === "darwin" ? /^(\s*\d+)\s+maximum resident set size/mu.exec(stderr) : /peak_rss_kib=(\d+)/u.exec(stderr);
  assert.ok(rss?.[1], `No peak RSS measured for ${entry.repository}`);
  const peakRssBytes = Number(rss[1]) * (system === "darwin" ? 1 : 1024);
  measurements.push({ ...entry, durationMs, peakRssBytes });
}
const environment = {
  platform: system,
  arch: arch(),
  osRelease: release(),
  cpu: cpus()[0]?.model,
  node: process.version,
};
const report = { environment, measurements };
const output = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes("--record")) await writeFile(join(validationDir, "performance.json"), output);
process.stdout.write(output);
assert.ok(
  measurements.every(({ durationMs }) => durationMs < 60_000),
  "a forecast exceeded 60 seconds",
);

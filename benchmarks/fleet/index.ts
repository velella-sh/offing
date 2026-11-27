import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import type { FleetHost } from "../../src/fleet/host.js";
import { scanFleet } from "../../src/fleet/index.js";
import { githubFleetHost } from "../../src/fleet/remote.js";

// Immutable public revisions from Offing's reviewed node corpus.
const pins = new Map([
  ["expressjs/express", "a419aa7350389a275ab45fde2e849ed1f02449ef"],
  ["sindresorhus/got", "05b4476913da39a47dd8e20d29e250f28b0a6dca"],
  ["koajs/koa", "2fecd029c6ce6b79d65158d28a76538f7f6b0378"],
]);

async function sample(host: FleetHost, cacheDirectory: string) {
  const start = performance.now();
  let bytesFetched = 0;
  const result = await scanFleet(host, "public-benchmark", {
    cacheDirectory,
    jobs: 2,
    onProgress: (status) => {
      bytesFetched += status.bytesFetched;
    },
  });
  const scanned = result.repositoryStatus.filter(({ status }) => status === "scanned" || status === "cached").length;
  const cached = result.repositoryStatus.filter(({ status }) => status === "cached").length;
  if (scanned !== pins.size) throw new Error("At least one pinned benchmark repository could not be scanned.");
  return {
    repositories: scanned,
    repositoriesPerMinute: (scanned * 60_000) / (performance.now() - start),
    bytesFetched,
    cacheHitRate: cached / scanned,
  };
}

if (!process.argv.includes("--live")) {
  process.stdout.write("Use --live to fetch the three pinned public GitHub repositories.\n");
} else {
  const remote = githubFleetHost();
  const host: FleetHost = {
    ...remote,
    listRepositories: () =>
      Promise.resolve(
        [...pins.keys()].map((name) => ({
          name,
          defaultBranch: "pinned",
          archived: false,
          disabled: false,
          fork: false,
          topics: [],
        })),
      ),
    readDefaultBranchHead: ({ name }) => Promise.resolve(pins.get(name) ?? ""),
  };
  const cache = await mkdtemp(join(tmpdir(), "offing-fleet-benchmark-"));
  try {
    const cold = await sample(host, cache);
    const warm = await sample(host, cache);
    process.stdout.write(`${JSON.stringify({ pins: Object.fromEntries(pins), cold, warm }, null, 2)}\n`);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}

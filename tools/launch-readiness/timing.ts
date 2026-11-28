import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { underFirstMinuteBudget } from "../../benchmarks/first-minute.js";
import { repository } from "./evidence.js";

const platforms = { ubuntu: "linux", macos: "darwin", windows: "win32" } as const;
const matrix = Object.entries(platforms).flatMap(([runner, platform]) =>
  [22, 24].map((node) => ({ runner, platform, node, artifact: `first-minute-${runner}-latest-node-${node}` })),
);
const fixtures = ["koa", "sampleproject", "bubbletea"];
const milliseconds = z.number().nonnegative().nullable();
const timingFile = z.object({
  package: z.strictObject({ published: z.string() }),
  platform: z.string(),
  node: z.string(),
  budgetMs: z.literal(10_000),
  timings: z
    .array(
      z.object({
        repository: z.string(),
        firstOutputMs: milliseconds,
        downloadSpanMs: milliseconds,
        npmReifyMs: milliseconds,
        afterReifyMs: milliseconds,
        tarballsFetched: z.number().int().nonnegative(),
        exitCode: z.number().int().nullable(),
        error: z.string().optional(),
      }),
    )
    .length(fixtures.length),
});

async function readMatrix(directory: string, version: string) {
  return Promise.all(
    matrix.map(async ({ runner, platform, node, artifact }) => {
      const name = `${runner} Node ${node}`;
      try {
        const data = timingFile.parse(
          JSON.parse(await readFile(join(directory, artifact, "first-minute.json"), "utf8")),
        );
        if (
          data.package.published === `@velella/offing@${version}` &&
          data.platform === platform &&
          data.node.startsWith(`v${node}.`) &&
          fixtures.every((fixture) => data.timings.some((timing) => timing.repository === fixture))
        ) {
          const failed = !data.timings.every(({ error, ...timing }) =>
            underFirstMinuteBudget(error === undefined ? timing : { ...timing, error }),
          );
          const rows = data.timings.map(({ firstOutputMs, npmReifyMs, repository }) => {
            const forecast = firstOutputMs === null ? "no forecast" : `forecast ${(firstOutputMs / 1000).toFixed(3)} s`;
            const install =
              npmReifyMs === null ? "install unavailable" : `npm install ${(npmReifyMs / 1000).toFixed(3)} s`;
            return `${repository} ${install}, ${forecast}`;
          });
          return { observed: `${name}${failed ? " failed" : ""} (${rows.join(", ")})`, failed };
        }
      } catch {
        // Other matrix files still provide usable evidence when one runner failed to upload.
      }
      return { observed: `${name} unavailable` };
    }),
  );
}

export async function readColdInstall(directory: string, date: string, version: string) {
  const newest = Date.parse(date);
  const names = (await readdir(directory)).filter((name) => /^\d{4}-\d{2}-\d{2}--[1-9]\d*$/.test(name));
  names.sort((a, b) => b.slice(0, 10).localeCompare(a.slice(0, 10)) || Number(b.slice(12)) - Number(a.slice(12)));
  for (const name of names) {
    const [measured, run] = name.split("--");
    if (!measured || !run) continue;
    const age = (newest - Date.parse(measured)) / 86_400_000;
    if (!Number.isFinite(age) || age < 0 || age > 14) continue;
    const results = await readMatrix(join(directory, name), version);
    const measuredCount = results.filter(({ failed }) => failed !== undefined).length;
    if (measuredCount === 0) continue;
    const passed = results.filter(({ failed }) => failed === false).length;
    const status = passed < measuredCount ? "red" : measuredCount === matrix.length ? "green" : "amber";
    return {
      status,
      observed: `npm ${version} · ${measured} · ${measuredCount}/${matrix.length} pairs measured · ${passed}/${matrix.length} passed · ${results.map(({ observed }) => observed).join("; ")}`,
      evidence: `${repository}/actions/runs/${run}`,
    } as const;
  }
  return undefined;
}

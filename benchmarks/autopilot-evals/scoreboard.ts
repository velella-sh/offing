import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { digest } from "../../src/proof/document.js";
import { readRegular, reportAutopilotFixture } from "./report.js";

const outcomes = ["green", "stopped-by-budget", "excluded", "failed"] as const;
const count = z.int().nonnegative();
const labels = {
  green: "Green",
  "stopped-by-budget": "Stopped by budget",
  excluded: "Excluded",
  failed: "Failed",
};
const median = z.strictObject({ samples: count, median: z.number().nonnegative().nullable() });
const failure = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
  outcome: z.enum(["stopped-by-budget", "excluded", "failed"]),
  lastFailure: z.strictObject({
    file: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,120}\.txt$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
});

const summarySchema = z.strictObject({
  source: z.literal("synthetic-fixture"),
  total: count.positive(),
  counts: z.record(z.enum(outcomes), count),
  rates: z.record(z.enum(outcomes), z.number().min(0).max(1)),
  turns: median,
  elapsedMs: median,
  costUsd: median,
  nonGreen: z.array(failure),
});

type Summary = z.infer<typeof summarySchema>;

function consistent(summary: Summary): boolean {
  const { counts, total, rates, nonGreen, turns, elapsedMs, costUsd } = summary;
  const attempted = total - counts.excluded;
  return (
    total === outcomes.reduce((sum, outcome) => sum + counts[outcome], 0) &&
    outcomes.every((outcome) => rates[outcome] === counts[outcome] / total) &&
    nonGreen.length === total - counts.green &&
    new Set(nonGreen.map(({ id }) => id)).size === nonGreen.length &&
    outcomes
      .slice(1)
      .every((outcome) => nonGreen.filter((row) => row.outcome === outcome).length === counts[outcome]) &&
    elapsedMs.samples === attempted &&
    [turns, elapsedMs, costUsd].every(
      ({ samples, median }) => samples <= attempted && (samples === 0) === (median === null),
    )
  );
}

export const validateScoreboard = (input: unknown): Summary =>
  summarySchema.refine(consistent, "Scoreboard totals, rates, medians or failure rows disagree.").parse(input);

const format = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
function formattedMedian(measure: Summary["turns"], unit: string): string {
  const value = measure.median === null ? "Unavailable" : `${format.format(measure.median)} ${unit}`;
  return `${value} (${measure.samples} samples)`;
}

async function writeFailures(input: string, out: string, rows: Summary["nonGreen"]): Promise<string> {
  const links: string[] = [];
  for (const { id, outcome, lastFailure } of rows) {
    const contents = await readRegular(join(dirname(input), lastFailure.file));
    if (digest(contents) !== lastFailure.sha256) throw new Error(`Failure evidence changed for ${id}.`);
    await writeFile(join(out, "failures", `${id}.txt`), contents, { flag: "wx" });
    links.push(`- [${labels[outcome]} for ${id}](/failures/${id}.txt)`);
  }
  return links.join("\n");
}

async function writeScoreboard(input: string, out: string, summary: Summary): Promise<void> {
  for (const child of ["_data", "_templates", "failures"]) await mkdir(join(out, child));
  const outputRows = outcomes.map((id) => ({
    id,
    label: labels[id],
    count: summary.counts[id],
    rate: `${format.format(100 * summary.rates[id])}%`,
  }));
  const run = {
    id: "fixture",
    total: summary.total,
    turns: formattedMedian(summary.turns, summary.turns.median === 1 ? "turn" : "turns"),
    time: formattedMedian(summary.elapsedMs, "ms"),
    cost: formattedMedian(summary.costUsd, "USD"),
    failureLinks: await writeFailures(input, out, summary.nonGreen),
  };
  await copyFile("benchmarks/autopilot-evals/scoreboard.yml", join(out, "mizzen.yml"));
  await copyFile("docs/assets/brand/favicon.ico", join(out, "favicon.ico"));
  await copyFile("docs/_templates/autopilot-evals-fixture.md", join(out, "_templates/autopilot-evals-fixture.md"));
  await writeFile(join(out, "_data/autopilot-evals-fixture.json"), `${JSON.stringify([run], null, 2)}\n`);
  await writeFile(join(out, "_data/autopilot-evals-outcomes.json"), `${JSON.stringify(outputRows, null, 2)}\n`);
}

export async function prepareAutopilotScoreboard(input: string, out: string): Promise<void> {
  const summary = validateScoreboard(await reportAutopilotFixture(input));
  await mkdir(out);
  try {
    await writeScoreboard(input, out, summary);
  } catch (error) {
    await rm(out, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({ options: { fixture: { type: "string" }, out: { type: "string" } } });
  if (!values.fixture || !values.out)
    throw new Error("Pass --fixture <recorded-results> --out <new-source-directory>.");
  await prepareAutopilotScoreboard(resolve(values.fixture), resolve(values.out));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error: unknown) => {
    process.stderr.write(`autopilot-evals: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

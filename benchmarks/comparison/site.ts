import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { DifferentialReport } from "../differential/xeol.js";
import { RESULT_JSON_PATH } from "./compare-endoflife-date.js";
import { REPRODUCE_PATH, type ReproductionRecord } from "./reproduce.js";

interface SiteChartPoint {
  label: string;
  count: number;
}

type Comparisons = ReproductionRecord["comparisons"];

function chart(known: Record<string, number>, labels: Record<string, string>): SiteChartPoint[] {
  return Object.entries(labels).map(([key, label]) => {
    const count = known[key];
    if (!Number.isSafeInteger(count) || count === undefined || count < 0)
      throw new Error(`Missing comparison count: ${key}.`);
    return { label, count };
  });
}

function knownFor(comparisons: Comparisons, name: string) {
  const known = comparisons.find((item) => item.name === name)?.known;
  if (!known) throw new Error(`Missing comparison: ${name}.`);
  return known;
}

function directCounts(known: ReturnType<typeof knownFor>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(known).flatMap(([key, value]) => (typeof value === "number" ? [[key, value]] : [])),
  );
}

function blindOutcomes(comparisons: Comparisons, name: string): Record<string, number> {
  const blind = knownFor(comparisons, name).blind;
  if (!blind || typeof blind === "number") throw new Error(`Missing blind outcomes: ${name}.`);
  return blind.outcomes;
}

const github = "https://github.com/velella-sh/offing/blob/main/benchmarks/comparison/";

function comparisonCharts(record: ReproductionRecord) {
  const { comparisons } = record;
  return {
    renovate: chart(blindOutcomes(comparisons, "renovate"), {
      agree: "Agree",
      "offing-only": "Offing only",
      "renovate-only": "Renovate only",
      inconclusive: "Inconclusive",
    }),
    dependabot: chart(blindOutcomes(comparisons, "dependabot"), {
      covered: "Covered",
      uncovered: "Uncovered",
      filtered: "Filtered",
      "not-comparable": "Outside scope",
    }),
    endoflife: chart(directCounts(knownFor(comparisons, "endoflife-date")), {
      agree: "Agree",
      disagree: "Different date",
    }),
    herodevs: chart(directCounts(knownFor(comparisons, "herodevs")), {
      agree: "Agree",
      "date-differs": "Different date",
      "hero-only": "HeroDevs only",
      "ambiguous-offing": "Multiple Offing dates",
    }),
  };
}

function loss(id: string, label: string, count: number | undefined, unit: string, file: string) {
  if (count === undefined) throw new Error(`Missing comparison loss count: ${id}.`);
  return { id, label, count, unit, source: github + file };
}

function comparisonLosses(record: ReproductionRecord, endoflifeOnly: number) {
  const { comparisons } = record;
  return [
    loss(
      "renovate",
      "Renovate npm deprecations with no Offing rule",
      blindOutcomes(comparisons, "renovate")["renovate-only"],
      "blind comparable pairs",
      "renovate/renovate.md",
    ),
    loss(
      "endoflife-date",
      "endoflife.date products with no mapped Offing rule",
      endoflifeOnly,
      "snapshot products",
      "endoflife-date.md#product-coverage",
    ),
    loss(
      "herodevs",
      "HeroDevs public dates with no equivalent Offing date",
      directCounts(knownFor(comparisons, "herodevs"))["hero-only"],
      "pinned package-version pairs",
      "herodevs/herodevs.md",
    ),
  ];
}

async function xeolHistory(root: string): Promise<SiteChartPoint[]> {
  const directory = resolve(root, "benchmarks/differential/reports/xeol");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  const reports = await Promise.all(
    files.map(async (name) => JSON.parse(await readFile(resolve(directory, name), "utf8")) as DifferentialReport),
  );
  if (reports.length === 0) throw new Error("The archived Xeol charts need measured directory reports.");
  const totals = { agree: 0, "offing-only": 0, "xeol-only": 0 };
  for (const { summary } of reports) {
    totals.agree += summary.agree;
    totals["offing-only"] += summary["offing-only"];
    totals["xeol-only"] += summary["xeol-only"];
  }
  return chart(totals, { agree: "Both tools", "offing-only": "Offing only", "xeol-only": "xeol only" });
}

export async function renderComparisonCollections(root: string): Promise<Record<string, string>> {
  const [record, endoflife, historicalXeol] = await Promise.all([
    readFile(resolve(root, REPRODUCE_PATH), "utf8"),
    readFile(resolve(root, RESULT_JSON_PATH), "utf8"),
    xeolHistory(root),
  ]);
  const known = JSON.parse(record) as ReproductionRecord;
  const result = JSON.parse(endoflife) as { coverage: { endoflifeOnlyProducts: string[] } };
  return {
    "docs/_data/comparison.json": `${JSON.stringify({ ...comparisonCharts(known), historicalXeol }, null, 2)}\n`,
    "docs/_data/comparison-losses.json": `${JSON.stringify(comparisonLosses(known, result.coverage.endoflifeOnlyProducts.length), null, 2)}\n`,
  };
}

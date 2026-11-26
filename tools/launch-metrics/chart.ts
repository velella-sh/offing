import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as z from "zod/v4";

const weekFile = /^\d{4}-W\d{2}\.json$/;
const weekMilliseconds = 7 * 86_400_000;
const chartSnapshot = z.object({
  week: z.string(),
  github: z.object({ stars: z.int().nonnegative() }),
  npm: z.object({ downloads: z.int().nonnegative() }),
});

function weekTime(week: string): number {
  const fourth = new Date(`${week.slice(0, 4)}-01-04T00:00:00Z`);
  return fourth.getTime() + (Number(week.slice(6)) - 1 - ((fourth.getUTCDay() + 6) % 7) / 7) * weekMilliseconds;
}

function series(label: string, color: string, top: number, values: number[], positions: number[]): string {
  const maximum = values.reduce((highest, value) => Math.max(highest, value), 1);
  const points = values.map((value, index) => {
    const y = top + 68 - 44 * (value / maximum);
    return { value, x: positions[index] ?? 0, y: Math.round(y) };
  });
  return [
    `<text x="16" y="${top + 14}" fill="#202936">${label} (0–${maximum})</text>`,
    `<path d="M16 ${top + 68}H584" stroke="#ccd4df"/>`,
    `<polyline fill="none" stroke="${color}" stroke-width="2" points="${points.map(({ x, y }) => `${x},${y}`).join(" ")}"/>`,
    ...points.map(
      ({ value, x, y }) =>
        `<circle cx="${x}" cy="${y}" r="3" fill="${color}"><title>${label}: ${value}</title></circle>`,
    ),
  ].join("\n");
}

function renderChart(snapshots: z.infer<typeof chartSnapshot>[]): string {
  const weeks = snapshots.map(({ week }) => week);
  const first = weeks[0];
  const last = weeks.at(-1);
  const start = first ? weekTime(first) : 0;
  const span = last ? weekTime(last) - start : 0;
  const positions = weeks.map((week) => (span ? 48 + Math.round((504 * (weekTime(week) - start)) / span) : 300));
  const labels = span
    ? `<text x="48" y="173">${first}</text><text x="552" y="173" text-anchor="end">${last}</text>`
    : `<text x="300" y="173" text-anchor="middle">${first ?? "No weekly snapshots yet"}</text>`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 185" role="img" aria-labelledby="title">',
    '<title id="title">Offing GitHub stars and weekly npm downloads</title>',
    '<rect width="600" height="185" rx="8" fill="#fff"/>',
    '<g font-family="system-ui, sans-serif" font-size="12" fill="#202936">',
    series(
      "GitHub stars",
      "#28569f",
      12,
      snapshots.map(({ github }) => github.stars),
      positions,
    ),
    series(
      "npm downloads",
      "#a44514",
      83,
      snapshots.map(({ npm }) => npm.downloads),
      positions,
    ),
    labels,
    "</g>",
    "</svg>",
    "",
  ].join("\n");
}

export async function writeChart(directory: string): Promise<void> {
  const files = (await readdir(directory)).filter((file) => weekFile.test(file)).sort();
  const snapshots = await Promise.all(
    files.map(async (file) => {
      const parsed = chartSnapshot.safeParse(JSON.parse(await readFile(join(directory, file), "utf8")));
      if (!parsed.success || `${parsed.data.week}.json` !== file) {
        throw new Error(`Invalid chart data in ${file}.`);
      }
      return parsed.data;
    }),
  );
  await writeFile(join(directory, "chart.svg"), renderChart(snapshots));
}

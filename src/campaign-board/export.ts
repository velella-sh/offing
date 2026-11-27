import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { renderCampaignBadge } from "../badge.js";
import { type CampaignState, invalidCampaign } from "../campaign/document.js";
import { findPackageFile } from "../package-files.js";
import { campaignBoard } from "./model.js";

type Board = ReturnType<typeof campaignBoard>;

async function template(name: string): Promise<string> {
  return readFile(await findPackageFile(`templates/campaign-board/${name}`, import.meta.url), "utf8");
}

function describeProjection(summary: Board["summary"]): string {
  const { projectedFinish, completedBatches, remainingBatches, meanIntervalMs, observedAt } = summary;
  const basis = `${completedBatches} completed batches, ${remainingBatches} remaining. Evidence through ${observedAt}.`;
  if (projectedFinish && meanIntervalMs !== null) {
    return `Projected finish: **${projectedFinish.slice(0, 10)} UTC** (estimate). ${basis} Mean time between recorded batch completions: ${(meanIntervalMs / 86_400_000).toFixed(2)} days.`;
  }
  if (remainingBatches === 0) return `No batches remain. ${basis}`;
  return `Projection unavailable. ${basis} Estimation needs at least two batches with distinct recorded completion times.`;
}

function page(source: string, { summary, activity }: Board): string {
  const stats = [
    { value: summary.total, label: "Repositories" },
    { value: summary.merged, label: "Merged" },
    { value: summary.complete, label: "Completed" },
    { value: summary.awaitingReview, label: "Awaiting review" },
    { value: summary.omitted, label: "Omitted" },
  ];
  const chart = [
    { label: "Completed", value: summary.complete },
    { label: "Awaiting review", value: summary.awaitingReview },
    { label: "Other open", value: summary.total - summary.complete - summary.awaitingReview },
  ];
  const timeline =
    activity.length > 0 ? '## Batch activity\n\n::timeline{from=activity caption="Recorded batch activity"}' : "";
  return source
    .replace("stats: []", `stats: ${JSON.stringify(stats)}`)
    .replace("<!-- campaign-board-projection -->", describeProjection(summary))
    .replace("<!-- campaign-board-activity -->", timeline)
    .replace("<!-- campaign-board-chart -->", `::charts{title="Repository progress" rows='${JSON.stringify(chart)}'}`);
}

async function requireNewDirectory(directory: string): Promise<void> {
  try {
    await lstat(directory);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw invalidCampaign("Choose a new output directory for the campaign board.");
}

async function writeSource(board: Board, directory: string, config: string, index: string): Promise<void> {
  const collections = {
    repositories: board.repositories,
    owners: board.owners,
    summary: [board.summary],
    activity: board.activity,
  };
  await mkdir(join(directory, "_data"));
  const write = (path: string, data: string) => writeFile(join(directory, path), data, { flag: "wx" });
  for (const [name, records] of Object.entries(collections)) {
    await write(`_data/${name}.json`, `${JSON.stringify(records, null, 2)}\n`);
  }
  await write("campaign-progress.svg", renderCampaignBadge(board.summary.merged, board.summary.total));
  await write("index.md", page(index, board));
  await write("mizzen.yml", config);
}

export async function writeCampaignBoard(state: CampaignState, directory: string): Promise<void> {
  const board = campaignBoard(state);
  const [config, index] = await Promise.all([template("mizzen.yml"), template("index.md")]);
  await requireNewDirectory(directory);
  const parent = dirname(directory);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, ".offing-board-"));
  try {
    await writeSource(board, staging, config, index);
    await requireNewDirectory(directory);
    await rename(staging, directory);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

import { buildCountdownRows } from "@velella/ebb/countdown";
import { buildForecast } from "@velella/ebb/forecast";

import type { Finding } from "../domain.js";
import { escapeMarkdown } from "../reporters/shared.js";

const SECONDS_PER_DAY = 86_400;
const SOON_DAYS = 90;
const DISPLAY_ROWS = 15;
const COUNTDOWN_BYTES = 24_000;

export interface PullRequestCountdown {
  today: string;
  findings: readonly Finding[];
  timelineFindings: readonly Finding[];
  receiptUrl?: string;
  reviewedDated?: boolean;
}

function countdownFor(finding: Finding, now: number) {
  if (finding.deadline === undefined) return undefined;
  // Ebb's terminal view folds equal subjects together. Build one row per finding so each location
  // and its evidence survive here, including when the same dependency appears in multiple files.
  const forecast = buildForecast({ root: ".", findings: [finding] }, [], finding.deadline);
  return buildCountdownRows(forecast, { now })[0];
}

const short = (text: string): string => (text.length > 200 ? `${text.slice(0, 199)}…` : text);

function link(label: string, destination: string): string {
  const url = URL.canParse(destination) ? new URL(destination) : undefined;
  if (!url || url.href.length > 2_000 || (url.protocol !== "https:" && url.protocol !== "http:")) return label;
  return `[${label}](<${url.href.replaceAll("|", "%7C")}>)`;
}

function renderRow(finding: Finding, receiptUrl: string | undefined): string {
  const { path, line } = finding.location;
  const location = escapeMarkdown(short(`${path}:${line ?? "?"}`));
  const receipt = receiptUrl ? ` · ${link("Receipt", receiptUrl)}` : "";
  const source = finding.sources[0];
  const evidence = source ? ` · ${link("Evidence", source.url)}` : "";
  return `- ${escapeMarkdown(short(finding.title))} — ${location}${receipt}${evidence}`;
}

function daysLabel(days: number): string {
  if (days === 0) return "today";
  const count = Math.abs(days);
  const duration = `${count} day${count === 1 ? "" : "s"}`;
  return days < 0 ? `ended ${duration} ago` : `${duration} left`;
}

export function renderPrCountdown(context: PullRequestCountdown): string[] {
  const { today, findings, receiptUrl } = context;
  const now = Date.parse(`${today}T00:00:00Z`);
  const rows = findings
    .flatMap((finding) => {
      const row = countdownFor(finding, now);
      return row ? [{ finding, ...row, days: row.remainingSeconds / SECONDS_PER_DAY }] : [];
    })
    .sort((a, b) => a.days - b.days || a.finding.id.localeCompare(b.finding.id));

  const lines = ["### PR countdown", ""];
  if (rows.length === 0)
    return [
      ...lines,
      context.reviewedDated
        ? "Dated findings on changed lines are in the inline lifecycle review."
        : "No dated findings on lines this pull request changed.",
      "",
    ];
  const soon = rows.filter(({ days }) => days >= 0 && days <= SOON_DAYS).length;
  lines.push(
    `**${soon} ${soon === 1 ? "thing this PR touches ends" : "things this PR touches end"} within ${SOON_DAYS} days.**`,
    "",
  );
  let previous: string | undefined;
  let shown = 0;
  let bytes = 0;
  for (const { deadline, days, finding } of rows.slice(0, DISPLAY_ROWS)) {
    const entry = renderRow(finding, receiptUrl);
    bytes += Buffer.byteLength(entry, "utf8");
    if (bytes > COUNTDOWN_BYTES) break;
    if (deadline !== previous) {
      if (previous !== undefined) lines.push("");
      lines.push(`**${deadline} · ${daysLabel(days)}**`, "");
      previous = deadline;
    }
    lines.push(entry);
    shown += 1;
  }
  lines.push("");
  if (rows.length > shown) {
    const receipt = receiptUrl ? ` See the ${link("full receipt", receiptUrl)}.` : "";
    lines.push(`…and ${rows.length - shown} more dated findings.${receipt}`, "");
  }
  return lines;
}

import { singleLine } from "../forecast-core.js";
import type { UpgradeTarget } from "../upgrade/types.js";
import type { FleetSimulation } from "./fleet.js";
import type { Deadline } from "./forecast.js";
import type { RepositorySimulation } from "./index.js";

type Report = FleetSimulation | RepositorySimulation;
type TargetReport = Report["reports"][number];
export type WhatIfFormat = "text" | "json" | "markdown";

const targetLabel = ({ runtime, version }: UpgradeTarget): string => `${runtime}@${version}`;
const deadlineLine = (entry: Deadline): string =>
  `${entry.date} ${entry.rule} — ${entry.path}${entry.line === undefined ? "" : `:${entry.line}`} — ${entry.title}`;

function repoLines(report: RepositorySimulation["reports"][number]): string[] {
  const { support, pins, issues, blockers, forecast } = report;
  return [
    `Verdict: ${report.verdict}`,
    support.date ? `Target ends ${support.date} (${support.rule})` : `Target lifecycle: ${support.status}`,
    ...(support.next ? [`A later supported line (${support.next.range}) ends on ${support.next.date}.`] : []),
    `Confirmed blockers: ${blockers.total}`,
    ...blockers.roots.map(({ dependency, unlocks }) => `${dependency}: ${unlocks} blocker(s)`),
    ...issues.map(
      (issue) =>
        `${issue.level}: ${issue.subject} — ${issue.path}${issue.line === undefined ? "" : `:${issue.line}`} — ${issue.reason}${issue.effort ? ` [${issue.effort.kind}: ${issue.effort.reason}]` : ""}`,
    ),
    ...pins.map(
      (pin) =>
        `Pin: ${pin.path}:${pin.line} ${pin.value} → ${pin.replacement ?? "unresolved"}${pin.effort ? ` [${pin.effort.kind}: ${pin.effort.reason}]` : ""}`,
    ),
    `Forecast through ${forecast.until}: ${forecast.removed.length} removed, ${forecast.retained.length} retained, ${forecast.added.length} added`,
    ...forecast.removed.map((entry) => `Removed: ${deadlineLine(entry)}`),
    ...forecast.retained.map((entry) => `Retained: ${deadlineLine(entry)}`),
    ...forecast.added.map((entry) => `Added: ${deadlineLine(entry)}`),
  ];
}

function fleetLines(report: FleetSimulation["reports"][number]): string[] {
  return (["ready", "blocked", "unknown"] as const).flatMap((verdict) => [
    `${verdict}: ${report[verdict].length}`,
    ...report[verdict].map(
      ({ host, name, commit, reason }) => `${host}/${name} (${commit ?? "unavailable"}): ${reason}`,
    ),
  ]);
}

function markdownLine(line: string): string {
  return singleLine(line)
    .replace(/[&<>`@]/gu, (character) => `&#${character.charCodeAt(0)};`)
    .replace(/[\\*_[\]~|]/gu, "\\$&");
}

function section(report: TargetReport, markdown: boolean): string[] {
  const heading = `${markdown ? "## " : ""}${targetLabel(report.target)}`;
  const lines = "verdict" in report ? repoLines(report) : fleetLines(report);
  return [heading, ...lines.map((line) => (markdown ? `- ${markdownLine(line)}` : `  ${singleLine(line)}`))];
}

export function renderWhatIf(report: Report, format: WhatIfFormat): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const markdown = format === "markdown";
  const heading = `${markdown ? "# " : ""}Runtime upgrade simulation (${report.today})`;
  return [heading, ...report.reports.flatMap((item) => ["", ...section(item, markdown)])].join("\n");
}

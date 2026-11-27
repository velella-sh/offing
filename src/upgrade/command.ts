import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { buildBlockerGraph } from "./graph.js";
import { renderBlockerMermaid, renderBlockerSvg, renderBlockerTree } from "./render-graph.js";
import { checkUpgrade, parseUpgradeTarget } from "./index.js";
import type { UpgradeIssue, UpgradeReport } from "./types.js";

const USAGE =
  "Usage: offing upgrade-check --to <runtime@version> [path] [--json] [--graph] [--format text|json|mermaid|svg] [--theme light|dark]";

const UNKNOWN_VERDICT =
  "Offing found no evidence for this runtime in this repository. This is not a statement that the upgrade is safe.";

/** One issue as `path:line  subject  reason  [evidence]`. */
export function renderUpgradeIssue(issue: UpgradeIssue): string {
  const location = issue.line === undefined ? issue.path : `${issue.path}:${issue.line}`;
  return `${location}  ${issue.subject}  ${issue.reason}  [${issue.evidence.kind}: ${issue.evidence.value}]`;
}

/** The verdict line first, then blockers, warnings, and unknowns. */
export function renderUpgradeReport(report: UpgradeReport): string {
  const counts = { blocker: 0, warning: 0, unknown: 0 };
  for (const issue of report.issues) counts[issue.level] += 1;
  const lines = [
    `${report.target.runtime}@${report.target.version}: ${report.verdict} (${counts.blocker} blockers, ${counts.warning} warnings, ${counts.unknown} unknown)`,
  ];
  if (report.graph) lines.push(...renderBlockerTree(report.target, report.graph));
  if (report.verdict === "unknown") lines.push(UNKNOWN_VERDICT);
  for (const issue of report.issues) lines.push(renderUpgradeIssue(issue));
  return lines.join("\n");
}

function parseUpgradeArgs(args: string[]) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        to: { type: "string" },
        json: { type: "boolean" },
        graph: { type: "boolean" },
        format: { type: "string" },
        theme: { type: "string" },
      },
    });
  } catch {
    return undefined;
  }
}

function renderOutput(report: UpgradeReport, format: string, theme: string): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  if (format === "mermaid" && report.graph) return renderBlockerMermaid(report.target, report.graph);
  if (format === "svg" && report.graph) return renderBlockerSvg(report.target, report.graph, theme === "dark");
  return renderUpgradeReport(report);
}

function upgradeOptions(args: string[]) {
  const parsed = parseUpgradeArgs(args);
  if (parsed === undefined || parsed.positionals.length > 1) return undefined;
  const { values, positionals } = parsed;
  const format = values.format ?? (values.json ? "json" : "text");
  if (!["text", "json", "mermaid", "svg"].includes(format)) return undefined;
  if (values.json && format !== "json") return undefined;
  const theme = values.theme ?? "light";
  if ((values.theme !== undefined && format !== "svg") || !["light", "dark"].includes(theme)) return undefined;
  const target = values.to === undefined ? undefined : parseUpgradeTarget(values.to);
  if (!target) return undefined;
  return { root: resolve(positionals[0] ?? "."), target, format, theme, graph: values.graph };
}

/** Exit 1 when blocked, 2 for bad input, regardless of the report format. */
export async function upgradeCheck(args: string[]): Promise<number> {
  const options = upgradeOptions(args);
  if (options === undefined) return usage();
  const { root, target, format, theme, graph } = options;
  try {
    if (!(await stat(root)).isDirectory()) return usage(`${root} is not a directory.`);
  } catch {
    return usage(`Cannot read ${root}.`);
  }
  const report = await checkUpgrade(root, target);
  if (graph || format === "mermaid" || format === "svg") report.graph = await buildBlockerGraph(report);
  process.stdout.write(`${renderOutput(report, format, theme)}\n`);
  return report.verdict === "blocked" ? 1 : 0;
}

function usage(message?: string): number {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

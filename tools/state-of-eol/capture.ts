import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { bundledRules } from "@velella/ebb/bundled-rules";
import { isMap, parseDocument } from "yaml";
import type { ScanResult } from "../../src/domain.js";
import { classifyNodeVersion, setupRuntimeVersions } from "../../src/detectors/github-actions-node.js";
import { noDataComponents } from "../../src/forecast.js";
import { readLineageInputs } from "../../src/lineage/inputs.js";
import { readBoundedFile } from "../../src/package-files.js";
import { buildBlockerGraph } from "../../src/upgrade/graph.js";
import { checkUpgrade } from "../../src/upgrade/index.js";

export const targets = [
  { runtime: "nodejs", version: "22" },
  { runtime: "python", version: "3.13" },
] as const;

const countBy = (items: readonly string[]) => {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(item, (totals.get(item) ?? 0) + 1);
  return Object.fromEntries([...totals].sort(([a], [b]) => a.localeCompare(b, "en")));
};

function workflowRuntimes(contents: string): string[] {
  return ["node", "python"].flatMap((runtime) => {
    if (runtime !== "node" && runtime !== "python") return [];
    return setupRuntimeVersions(contents, runtime).map(({ value, expression }) => {
      if (runtime === "node") {
        const version = classifyNodeVersion(value);
        return version.kind === "versions" ? `setup-node:${version.lowest.split(".")[0]}` : "setup-node:unknown";
      }
      const version = !expression ? /^(\d+\.\d+)(?:\.\d+)?$/.exec(value)?.[1] : undefined;
      return `setup-python:${version ?? "unknown"}`;
    });
  });
}

function manifestRuntime(contents: string): string {
  const document = parseDocument(contents, { prettyErrors: false });
  const runs = isMap(document.contents) ? document.contents.get("runs", true) : undefined;
  const runtime = isMap(runs) ? runs.get("using") : undefined;
  return document.errors.length === 0 && typeof runtime === "string" && /^(?:node\d+|docker|composite)$/i.test(runtime)
    ? `action:${runtime.toLowerCase()}`
    : "action:unknown";
}

async function actionEvidence(report: ScanResult) {
  const workflows = await readdir(join(report.root, ".github/workflows"), { withFileTypes: true }).catch(() => []);
  const files = new Map(
    workflows
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map(({ name }) => [`.github/workflows/${name}`, "workflow"] as const),
  );
  const observations: { path: string; runtimes: string[] }[] = [];
  for (const path of report.coverage?.filesRead ?? []) {
    if (!/(?:^|\/)action\.ya?ml$/i.test(path)) continue;
    const contents = (await readBoundedFile(join(report.root, path)))?.contents;
    observations.push({ path, runtimes: [contents === undefined ? "action:unknown" : manifestRuntime(contents)] });
  }
  for (const path of files.keys()) {
    const contents = (await readBoundedFile(join(report.root, path)))?.contents;
    observations.push({ path, runtimes: contents === undefined ? ["workflow:unknown"] : workflowRuntimes(contents) });
  }
  return observations.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

async function upgrades(root: string, date: string) {
  return Promise.all(
    targets.map(async (target) => {
      try {
        const report = await checkUpgrade(root, target, undefined, date);
        return { status: "scanned" as const, report: { ...report, graph: await buildBlockerGraph(report) } };
      } catch {
        return { status: "failed" as const, target };
      }
    }),
  );
}

export async function captureStudy(report: ScanResult, repository: string, commit: string) {
  const [rules, actions, upgrade, lineage] = await Promise.all([
    bundledRules(),
    actionEvidence(report),
    upgrades(report.root, report.scannedAt.slice(0, 10)),
    readLineageInputs(report.root).catch(() => null),
  ]);
  const lookup = new Map(rules.map((rule) => [rule.id, rule]));
  return {
    findings: report.findings.map(({ ruleId, detector, deadline, location, severity }) => {
      const rule = lookup.get(ruleId);
      return {
        ruleId,
        detector,
        deadline: deadline ?? rule?.deadline ?? null,
        location,
        severity,
        event: rule?.event ?? null,
        purl: rule?.purl ?? null,
      };
    }),
    coverage: report.coverage ?? null,
    scannerDiagnostics: report.diagnostics.length,
    noData: countBy((await noDataComponents(report, rules)).map(({ detector }) => detector)),
    actions,
    upgrade,
    lineage: lineage ? { ...lineage, repository: { host: "https://github.com", name: repository, commit } } : null,
  };
}

export type StudyCapture = Awaited<ReturnType<typeof captureStudy>>;

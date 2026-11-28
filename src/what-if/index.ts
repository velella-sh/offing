import { bundledRules } from "@velella/ebb/bundled-rules";
import { DEFAULT_FORECAST_MONTHS, MAX_FORECAST_MONTHS } from "@velella/ebb/forecast";
import { isIsoDate } from "@velella/ebb/registry";
import { loadImageRules } from "../detectors/container/image-lifecycle.js";
import type { ScanResult } from "../domain.js";
import { replayScanOptions } from "../forecast.js";
import { buildImageLineage } from "../lineage/index.js";
import { readLineageInputs } from "../lineage/inputs.js";
import { OffingError } from "../offing-error.js";
import { scanWithBuiltIns } from "../scan-builtins.js";
import { buildBlockerGraph } from "../upgrade/graph.js";
import { checkUpgrade } from "../upgrade/index.js";
import { readRuntimePins } from "../upgrade/target-lifecycle.js";
import type { UpgradeReport, UpgradeTarget } from "../upgrade/types.js";
import { issueEffort, pinEffort } from "./effort.js";
import { projectForecast, supplementalDeadlines } from "./forecast.js";
import { observedPins, projectPins } from "./pins.js";
import { targetSupport } from "./target.js";

interface Options {
  readonly asOf?: string;
  readonly months?: number;
  readonly effort?: boolean;
}

function supportVerdict(
  upgrade: UpgradeReport,
  support: Awaited<ReturnType<typeof targetSupport>>,
): UpgradeReport["verdict"] {
  if (upgrade.verdict === "blocked" || support.status === "ended") return "blocked";
  if (support.status !== "dated") return "unknown";
  // The lifecycle analyzer supplies pins and dates. Its presence does not prove compatibility.
  const hasCompatibilityAnalyzer = upgrade.analyzers.some((id) => id !== "target-lifecycle");
  return hasCompatibilityAnalyzer && upgrade.issues.every(({ level }) => level !== "unknown") ? "ready" : "unknown";
}

async function prepare(scan: ScanResult, months: number, effort: boolean) {
  const [rules, images, inputs, local] = await Promise.all([
    bundledRules(),
    loadImageRules(),
    readLineageInputs(scan.root),
    readRuntimePins(scan.root, { markAmbiguous: true }),
  ]);
  const byId = new Map([...images.all, ...images.dotnetRules, ...rules].map((rule) => [rule.id, rule]));
  const pins = observedPins(local, buildImageLineage([inputs], images));
  return {
    scan,
    months,
    effort,
    images,
    pins,
    byId,
    supplemental: supplementalDeadlines(scan.findings, pins, rules),
    today: scan.scannedAt.slice(0, 10),
  };
}

async function summarize(inputs: Awaited<ReturnType<typeof prepare>>, target: UpgradeTarget) {
  const { scan, today, byId, months, effort, images, supplemental } = inputs;
  const [upgrade, support] = await Promise.all([
    checkUpgrade(scan.root, target, undefined, today),
    targetSupport(target, today, [...byId.values()]),
  ]);
  if (
    support.status === "ended" &&
    support.rule &&
    !upgrade.issues.some(({ evidence }) => evidence.kind === "rule" && evidence.value === support.rule)
  ) {
    upgrade.issues.unshift({
      analyzer: "target-lifecycle",
      level: "blocker",
      subject: `${target.runtime}@${target.version}`,
      path: "",
      reason: "The target release has ended.",
      evidence: { kind: "rule", value: support.rule },
    });
  }
  const planned = projectPins(inputs.pins, target);
  const pins = await Promise.all(
    planned.map(async (item) => {
      return { ...item, ...(effort ? { effort: await pinEffort(scan, item, target) } : {}) };
    }),
  );
  const issues = upgrade.issues
    .filter(({ subject }) => subject !== "pin to update")
    .map((issue) => ({ ...issue, ...(effort ? { effort: issueEffort(scan, issue) } : {}) }));
  return {
    target,
    verdict: supportVerdict(upgrade, support),
    analyzers: upgrade.analyzers,
    issues,
    blockers: await buildBlockerGraph(upgrade),
    support,
    pins,
    forecast: projectForecast(scan.findings, supplemental, planned, target, support, byId, images, today, months),
  };
}

export type TargetSimulation = Awaited<ReturnType<typeof summarize>>;

function dateAndHorizon(options: Options): { today: string; months: number } {
  const today = options.asOf ?? new Date().toISOString().slice(0, 10);
  const months = options.months ?? DEFAULT_FORECAST_MONTHS;
  if (!isIsoDate(today)) throw new OffingError("invalid-argument", "Use a valid --as-of date (YYYY-MM-DD).");
  if (!Number.isInteger(months) || months < 1 || months > MAX_FORECAST_MONTHS) {
    throw new OffingError("invalid-argument", `--months must be a whole number from 1 to ${MAX_FORECAST_MONTHS}.`);
  }
  return { today, months };
}

export async function simulateScan(scan: ScanResult, targets: readonly UpgradeTarget[], options: Options = {}) {
  const { months } = dateAndHorizon({ ...options, asOf: scan.scannedAt.slice(0, 10) });
  const inputs = await prepare(scan, months, options.effort ?? false);
  const reports: TargetSimulation[] = [];
  for (const target of targets) reports.push(await summarize(inputs, target));
  return {
    schemaVersion: "offing.whatif.v1" as const,
    kind: "repository" as const,
    today: inputs.today,
    reports,
  };
}

export type RepositorySimulation = Awaited<ReturnType<typeof simulateScan>>;

export async function simulateRepository(path: string, targets: readonly UpgradeTarget[], options: Options = {}) {
  const { today } = dateAndHorizon(options);
  return simulateScan(await scanWithBuiltIns(path, replayScanOptions(today)), targets, options);
}

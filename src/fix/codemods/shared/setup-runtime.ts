import { loadDataFile } from "@velella/ebb/data-source";
import { validateRegistryV2 } from "@velella/ebb/registry";
import type { RegistryV2Rule } from "@velella/ebb/registry";
import { versContains } from "@velella/ebb/vers";
import { isScalar } from "yaml";
import type { Scalar, YAMLSeq } from "yaml";

import type { Finding, ScanResult } from "../../../domain.js";
import { classifyNodeVersion, runtimeInputText, setupRuntimeInputs } from "../../../detectors/github-actions-node.js";
import type { SetupRuntime } from "../../../detectors/github-actions-node.js";
import { runtimeTarget } from "../../runtime-pins.js";
import type { Refuse } from "../../types.js";
import type { Edit } from "./edits.js";

const RULE_PREFIX = { node: "nodejs.runtime.", python: "python.runtime." };
const PYTHON_VERSION = /^(\d+\.\d+)(?:\.\d+)?$/;

/** The release schedules bound when a matrix survivor is known to be supported. */
const SUPPORTED_LINES: Record<SetupRuntime, Readonly<Record<string, readonly [string, string]>>> = {
  // https://github.com/nodejs/Release/blob/main/schedule.json
  node: {
    "20": ["2023-04-18", "2026-04-30"],
    "22": ["2024-04-24", "2027-04-30"],
    "24": ["2025-05-06", "2028-04-30"],
    "26": ["2026-05-05", "2029-04-30"],
  },
  // https://devguide.python.org/versions/
  python: {
    "3.10": ["2021-10-04", "2026-10-01"],
    "3.11": ["2022-10-24", "2027-10"],
    "3.12": ["2023-10-02", "2028-10"],
    "3.13": ["2024-10-07", "2029-10"],
    "3.14": ["2025-10-07", "2030-10"],
    "3.15": ["2026-10-09", "2031-10"],
  },
};

interface VersionStatus {
  line?: string | undefined;
  ended: boolean;
}

function status(runtime: SetupRuntime, rules: readonly RegistryV2Rule[], value: string): VersionStatus {
  if (runtime === "python") {
    const line = PYTHON_VERSION.exec(value)?.[1];
    return line ? { line, ended: rules.some((rule) => versContains(rule.vers, value)) } : { ended: false };
  }
  const version = classifyNodeVersion(value);
  if (version.kind !== "versions") return { ended: false };
  return {
    line: version.lowest.split(".")[0],
    ended: rules.some((rule) => versContains(rule.vers, version.lowest) && versContains(rule.vers, version.highest)),
  };
}

export function isSetupRuntimeFinding(finding: Finding): boolean {
  return (
    finding.detector === "github-actions" &&
    (finding.ruleId.startsWith(RULE_PREFIX.node) || finding.ruleId.startsWith(RULE_PREFIX.python))
  );
}

export function setupRuntimePlanner(result: ScanResult) {
  const day = result.asOf ?? result.scannedAt.slice(0, 10);
  const target = runtimeTarget(result);
  const registry = new Map<SetupRuntime, Promise<RegistryV2Rule[]>>();
  function rulesFor(runtime: SetupRuntime): Promise<RegistryV2Rule[]> {
    const existing = registry.get(runtime);
    if (existing) return existing;
    const path = runtime === "node" ? "registry/nodejs.json" : "registry/python.json";
    const rules = loadDataFile(path).then((document) =>
      validateRegistryV2(document).rules.filter(
        (rule) => rule.id.startsWith(RULE_PREFIX[runtime]) && (!rule.deadline || rule.deadline <= day),
      ),
    );
    registry.set(runtime, rules);
    return rules;
  }

  return async function plan(
    contents: string,
    findings: readonly Finding[],
    refuse: Refuse | undefined,
  ): Promise<Edit[]> {
    const edits = [];
    for (const runtime of ["node", "python"] as const) {
      const selected = findings.filter((item) => item.ruleId.startsWith(RULE_PREFIX[runtime]));
      if (selected.length === 0) continue;
      const rules = await rulesFor(runtime);
      const state = (value: string) => status(runtime, rules, value);
      edits.push(...(await planRuntime(contents, runtime, selected, day, state, target, refuse)));
    }
    return edits;
  };
}

async function planRuntime(
  contents: string,
  runtime: SetupRuntime,
  findings: readonly Finding[],
  day: string,
  state: (value: string) => VersionStatus,
  target: ReturnType<typeof runtimeTarget>,
  refuse: Refuse | undefined,
): Promise<Edit[]> {
  const { lines, inputs, anchored } = setupRuntimeInputs(contents, runtime);
  if (anchored) {
    for (const finding of findings) refuse?.(finding, "The workflow uses YAML anchors or aliases.");
    return [];
  }
  const edits = new Map<number, Edit>();
  const used = new Set<Finding>();
  for (const { list, version, restrictions } of inputs) {
    const nodes = list ? list.items : [version];
    const matching = findingsAt(nodes, findings, lines, state);
    if (matching.length === 0) continue;
    for (const item of matching) used.add(item);
    const edit = list
      ? matrixEdit(contents, list, runtime, day, state, restrictions)
      : await scalarEdit(contents, runtime, version, target);
    if (typeof edit === "string") {
      for (const item of matching) refuse?.(item, edit);
    } else edits.set(edit.start, edit);
  }
  for (const item of findings) {
    if (!used.has(item)) refuse?.(item, "The runtime is not a literal end-of-life version at the finding.");
  }
  return [...edits.values()];
}

function findingsAt(
  nodes: readonly unknown[],
  findings: readonly Finding[],
  lines: ReturnType<typeof setupRuntimeInputs>["lines"],
  state: (value: string) => VersionStatus,
): Finding[] {
  const affected = new Set<number>();
  for (const node of nodes) {
    if (!isScalar(node) || !node.range || !state(runtimeInputText(node) ?? "").ended) continue;
    affected.add(lines.linePos(node.range[0]).line);
  }
  return findings.filter(({ location }) => location.line !== undefined && affected.has(location.line));
}

function literalNode(node: unknown): node is Scalar & { range: NonNullable<Scalar["range"]> } {
  return (
    isScalar(node) &&
    !!node.range &&
    !node.anchor &&
    !node.tag &&
    (node.type === "PLAIN" || node.type === "QUOTE_SINGLE" || node.type === "QUOTE_DOUBLE")
  );
}

function matrixEdit(
  contents: string,
  list: YAMLSeq,
  runtime: SetupRuntime,
  day: string,
  state: (value: string) => VersionStatus,
  restrictions: boolean,
): Edit | string {
  if (restrictions) return "The runtime matrix has include or exclude entries that require manual review.";
  if (!list.flow || !list.range || list.anchor || list.tag || !list.items.every(literalNode))
    return "The runtime matrix is not a single-line literal list.";
  const [start, end] = list.range;
  if (contents.slice(start, end).includes("\n")) return "The runtime matrix is not a single-line literal list.";
  const survivors = list.items.filter((node) => !state(runtimeInputText(node) ?? "").ended);
  if (!survivors.some((node) => supported(runtime, state(runtimeInputText(node) ?? "").line, day)))
    return "Removing end-of-life entries would leave no known supported runtime in the matrix.";
  return {
    start,
    end,
    replacement: `[${survivors.map((node) => contents.slice(node.range[0], node.range[1])).join(", ")}]`,
  };
}

function supported(runtime: SetupRuntime, version: string | undefined, day: string): boolean {
  const dates = version && SUPPORTED_LINES[runtime][version];
  return !!dates && dates[0] <= day && day < dates[1];
}

async function scalarEdit(
  contents: string,
  runtime: SetupRuntime,
  node: Scalar,
  target: ReturnType<typeof runtimeTarget>,
): Promise<Edit | string> {
  if (!literalNode(node)) return "The workflow input is not a single literal runtime version.";
  const current = runtimeInputText(node) ?? "";
  const next = await target(runtime, current);
  if (!next || next === current) return "No higher supported runtime line is known.";
  const [start, end] = node.range;
  const raw = contents.slice(start, end);
  const updated = current.startsWith("v") ? `v${next}` : next;
  const replacement = raw.replace(current, updated);
  return replacement === raw || raw.includes("\n")
    ? "The workflow input uses an escape or multiline syntax."
    : { start, end, replacement };
}

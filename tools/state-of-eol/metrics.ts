import { addDays } from "@velella/ebb/forecast";
import type { StudyArchive, StudyObservation } from "./archive.js";
import type { StudyCapture } from "./capture.js";

const day = 86_400_000;
const supportEvents = new Set(["end-of-life", "scheduled-end-of-life", "end-of-support", "removed"]);
const runtimeProducts = new Set([
  "nodejs",
  "python",
  "golang",
  "ruby",
  "php",
  "java",
  "jvm",
  "dotnet",
  "deno",
  "rust",
  "elixir",
  "erlang",
  "dart",
  "bun",
  "powershell",
  "scala",
]);

export type Measured = StudyObservation & { capture: StudyCapture };
type Finding = StudyCapture["findings"][number];

export function measuredRows(rows: readonly StudyObservation[]): Measured[] {
  return rows.flatMap((row) => (row.capture ? [{ ...row, capture: row.capture }] : []));
}

export function datedSupport(finding: {
  event: string | null;
  deadline?: string | null | undefined;
}): string | undefined {
  return finding.event && supportEvents.has(finding.event) ? (finding.deadline ?? undefined) : undefined;
}

function endedRuntime(finding: Finding, asOf: string): boolean {
  const date = datedSupport(finding);
  return (
    date !== undefined &&
    date <= asOf &&
    (finding.purl?.startsWith("pkg:generic/") ?? false) &&
    runtimeProducts.has(finding.purl?.slice("pkg:generic/".length) ?? "") &&
    !finding.ruleId.includes(".symbol.")
  );
}

const gap = ({ capture }: Measured): boolean => Object.values(capture.noData).some((count) => count > 0);
const incomplete = ({ capture }: Measured): boolean =>
  capture.coverage === null || capture.coverage.truncated === true || capture.scannerDiagnostics > 0;

export function attachRuleCatalog(rows: readonly Measured[], rules: StudyArchive["rules"]): Measured[] {
  const catalog = new Map(rules.map((rule) => [rule.id, rule]));
  return rows.map((row) => ({
    ...row,
    capture: {
      ...row.capture,
      findings: row.capture.findings.map((finding) => {
        const rule = catalog.get(finding.ruleId);
        if (!rule) return finding;
        return {
          ...finding,
          event: finding.event ?? rule.event,
          purl: finding.purl ?? rule.purl,
          deadline: finding.deadline ?? rule.deadline,
        };
      }),
    },
  }));
}

export function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const right = sorted[Math.floor(sorted.length / 2)];
  if (right === undefined) return null;
  const left = sorted[Math.floor((sorted.length - 1) / 2)] ?? right;
  return (left + right) / 2;
}

function nextDates(rows: readonly Measured[], asOf: string, until: string) {
  return rows.map(({ capture }) =>
    capture.findings
      .flatMap((finding) => {
        const date = datedSupport(finding);
        return date !== undefined && date >= asOf && date <= until ? [{ ruleId: finding.ruleId, date }] : [];
      })
      .sort((a, b) => a.date.localeCompare(b.date, "en")),
  );
}

function endingRules(next: ReturnType<typeof nextDates>) {
  const ruleCounts = new Map<string, number>();
  for (const events of next) {
    for (const rule of new Set(events.map(({ ruleId }) => ruleId))) {
      ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1);
    }
  }
  return [...ruleCounts].sort(([a, first], [b, second]) => second - first || a.localeCompare(b, "en"));
}

export function headlines(rows: readonly Measured[], cohort: number, asOf: string) {
  const until = addDays(asOf, 365);
  const next = nextDates(rows, asOf, until);
  const present = next.flatMap(([nearest]) => (nearest ? [(Date.parse(nearest.date) - Date.parse(asOf)) / day] : []));
  const noData = rows.filter(gap).length;
  const unknown = cohort - rows.length + rows.filter(incomplete).length;
  const scannedWithoutEvent = rows.filter((row, index) => !incomplete(row) && next[index]?.length === 0).length;
  const [leading] = endingRules(next);
  return {
    until,
    ended: {
      count: rows.filter(({ capture }) => capture.findings.some((finding) => endedRuntime(finding, asOf))).length,
      denominator: rows.length,
      noData,
      unknown,
    },
    median: { days: median(present), denominator: present.length, noData, unknown, scannedWithoutEvent },
    common: {
      rule: leading?.[0] ?? null,
      count: leading?.[1] ?? 0,
      denominator: present.length,
      noData,
      unknown,
      scannedWithoutEvent,
    },
  };
}

function ecosystemGroups(rows: readonly Measured[]): Map<string, Measured[]> {
  const groups = new Map<string, Measured[]>();
  for (const row of rows) {
    const { coverage, noData, findings, actions } = row.capture;
    const detectors = new Set([
      ...(coverage?.ecosystems ?? []),
      ...Object.keys(noData),
      ...findings.map(({ detector }) => detector),
      ...(actions.length > 0 ? ["github-actions"] : []),
    ]);
    for (const detector of detectors) {
      const members = groups.get(detector) ?? [];
      members.push(row);
      groups.set(detector, members);
    }
  }
  return groups;
}

export function ecosystemBreakdown(rows: readonly Measured[], cohort: number) {
  return [...ecosystemGroups(rows)]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([id, members]) => ({
      id,
      denominator: members.length,
      affected: members.filter(({ capture }) => capture.findings.some(({ detector }) => detector === id)).length,
      noData: members.filter(({ capture }) => (capture.noData[id] ?? 0) > 0).length,
      unknown: cohort - rows.length + members.filter(incomplete).length,
    }));
}

export function actionBreakdown(rows: readonly Measured[], cohort: number) {
  const selected = rows.filter(({ capture }) => capture.actions.length > 0);
  const groups = new Map<string, number>();
  let unknown = cohort - rows.length;
  for (const row of selected) {
    const runtimes = new Set(row.capture.actions.flatMap(({ runtimes }) => runtimes));
    if ([...runtimes].some((runtime) => runtime.endsWith(":unknown")) || incomplete(row)) unknown += 1;
    for (const runtime of runtimes) groups.set(runtime, (groups.get(runtime) ?? 0) + 1);
  }
  const noData = selected.filter(({ capture }) => (capture.noData["github-actions"] ?? 0) > 0).length;
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([id, observed]) => ({
      id,
      observed,
      denominator: selected.length,
      noData,
      unknown,
    }));
}

const packageAnalyzers = new Set(["npm-lock", "pnpm-lock", "poetry-lock", "uv-pdm-lock"]);

function blockerNames(result: StudyCapture["upgrade"][number]): Set<string> {
  if (result.status === "failed") return new Set();
  const { issues, graph, target } = result.report;
  const identity = ({ subject, path }: { subject: string; path: string }) => JSON.stringify([subject, path]);
  const blockers = new Set([...graph.ungrouped, ...graph.roots.flatMap(({ blockers }) => blockers)].map(identity));
  return new Set(
    issues.flatMap((issue) => {
      const { analyzer, level, evidence, subject } = issue;
      if (
        level !== "blocker" ||
        evidence.kind !== "lockfile" ||
        !packageAnalyzers.has(analyzer) ||
        !blockers.has(identity(issue))
      )
        return [];
      const version = subject.lastIndexOf("@");
      const label = version > 0 ? subject.slice(0, version) : subject;
      if (!/^[\w.-]+$|^@[\w.-]+\/[\w.-]+$/.test(label)) return [];
      if (target.runtime === "python" && label.toLowerCase() === "python") return [];
      return [target.runtime === "python" ? label.toLowerCase().replace(/[-_.]+/g, "-") : label];
    }),
  );
}

export function upgradeBreakdown(rows: readonly Measured[], cohort: number) {
  return [0, 1].map((index) => {
    const results = rows.flatMap(({ capture }) => (capture.upgrade[index] ? [capture.upgrade[index]] : []));
    const packages = new Map<string, number>();
    let denominator = 0;
    let noData = 0;
    for (const result of results) {
      if (result.status === "failed") continue;
      const applicable = result.report.analyzers.some((analyzer) => packageAnalyzers.has(analyzer));
      if (applicable) denominator += 1;
      if (
        !applicable ||
        result.report.issues.some(({ analyzer, level }) => packageAnalyzers.has(analyzer) && level === "unknown")
      )
        noData += 1;
      for (const label of blockerNames(result)) packages.set(label, (packages.get(label) ?? 0) + 1);
    }
    const id = index === 0 ? "Node.js 22" : "Python 3.13";
    return {
      id,
      denominator,
      noData,
      unknown: cohort - results.filter(({ status }) => status === "scanned").length,
      packages: [...packages].sort(([a, first], [b, second]) => second - first || a.localeCompare(b, "en")),
    };
  });
}

export function coverageCounts(archive: StudyArchive, cohort: number) {
  const rows = measuredRows(archive.rows);
  return {
    cohort,
    attempted: archive.rows.length,
    scanned: rows.length,
    failed: archive.rows.filter(({ state }) => state.status === "failed").length,
    skipped: archive.rows.filter(({ state }) => state.status === "skipped").length,
    unscanned: cohort - archive.rows.length,
    withGaps: rows.filter(gap).length,
    coverageIncomplete: rows.filter(incomplete).length,
  };
}

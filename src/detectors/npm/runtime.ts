import { basename, resolve } from "node:path";

import semver from "semver";

import type { DeprecationRule, Severity } from "../../domain.js";
import { relativePosix } from "../../paths.js";
import type { DetectorFinding, DetectorUnclassifiedReference } from "../../sdk.js";
import { MISE_FILES, miseDeclarations, noVersionData } from "../../version-files/mise.js";
import { parseToolVersionEntries } from "../../version-files/tool-versions.js";
import { devEngineEntries, otherDevEngineFindings } from "./dev-engines.js";
import type { PackageManifest } from "./manifest.js";
import { declarationLine } from "./manifest.js";
import type { NpmProject } from "./project.js";
import { readOptional } from "../read-optional.js";

export interface NodeRule extends DeprecationRule {
  major?: number;
  maximumMajor?: number;
  /** A line with an announced end that has not happened yet (decision 0010). */
  scheduled?: boolean;
}

interface RuntimeDeclaration {
  path: string;
  line: number;
  value: string;
  kind: "compatibility range" | "pinned runtime";
}

const NODE_PURL = "pkg:generic/nodejs";
const MISE_PARSERS = new Map([
  [
    NODE_PURL,
    ({ value, line }: { value: string; line: number }) =>
      /^v?\d+(?:\.\d+){0,2}$/.test(value) || semver.valid(value) ? [{ value, line }] : [],
  ],
]);

interface RuntimeRuleContext {
  endedRules: NodeRule[];
  scheduledMajors: number[];
  newestRuleMajor: number;
}

/** Up to this line the detector has always listed every end-of-life line a range allows. */
const LEGACY_MAXIMUM_MAJOR = 20;

function manifestRuntimeDeclarations(path: string, contents: string, manifest: PackageManifest): RuntimeDeclaration[] {
  const declarations: RuntimeDeclaration[] = [];
  if (manifest.engines?.node) {
    declarations.push({
      path,
      line: declarationLine(contents, "engines", "node"),
      value: manifest.engines.node,
      kind: "compatibility range",
    });
  }
  if (manifest.volta?.node) {
    declarations.push({
      path,
      line: declarationLine(contents, "volta", "node"),
      value: manifest.volta.node,
      kind: "pinned runtime",
    });
  }
  return declarations;
}

/**
 * The end-of-life candidates a declaration allows. A range whose lowest allowed version is at or below
 * Node.js 20 lists every line up to 20, as it always has. A range whose lowest version is a newer line is
 * checked against the newer lines too (up to `newestRuleMajor`) only if that floor line is itself end-of-life:
 * `>=21` is a problem, but `>=22` and `>=24` have supported floors, so the end-of-life lines 23 and 25 they
 * also allow are not a problem with the declaration. A scheduled line (announced end, not yet reached) is
 * reported only for a declaration whose lowest allowed version is that line and that allows nothing newer
 * (`^22`, `22.x`, a pinned `22`), never for a range such as `>=22` that merely allows it, and never extends
 * the end-of-life candidates (`hasRule` and `newestRuleMajor` ignore it).
 */
function runtimeMajors(
  value: string,
  newestRuleMajor: number,
  hasRule: (major: number) => boolean,
  scheduledMajors: number[] = [],
): number[] {
  const range = semver.validRange(value);
  if (!range) {
    const direct = /^(?:v)?(\d+)(?:\.\d+){0,2}$/.exec(value.trim());
    return direct?.[1] ? [Number.parseInt(direct[1], 10)] : [];
  }
  const floor = semver.minVersion(range)?.major ?? 0;
  // Past Node.js 20 only a floor that is itself end-of-life (a line with a rule) makes the declaration a problem.
  const maximum =
    floor > LEGACY_MAXIMUM_MAJOR ? (hasRule(floor) ? newestRuleMajor : LEGACY_MAXIMUM_MAJOR) : LEGACY_MAXIMUM_MAJOR;
  const candidates = Array.from({ length: maximum + 1 }, (_, index) => index);
  const ended = candidates.filter((major) => semver.intersects(range, `${major}.x`));
  return [
    ...ended,
    ...scheduledMajors.filter(
      (major) =>
        major === floor &&
        !ended.includes(major) &&
        semver.intersects(range, `${major}.x`) &&
        !semver.intersects(range, `>=${major + 1}.0.0`),
    ),
  ];
}

function ruleForMajor(rules: NodeRule[], major: number): NodeRule | undefined {
  return rules.find((rule) => rule.major === major || (rule.maximumMajor !== undefined && major <= rule.maximumMajor));
}

function declarationFinding(
  root: string,
  declaration: RuntimeDeclaration,
  rule: NodeRule,
  detectedMajor: number,
): DetectorFinding {
  const severity: Severity = declaration.kind === "pinned runtime" || rule.scheduled ? rule.severity : "medium";
  return {
    id: `${rule.id}:${relativePosix(root, declaration.path)}:${declaration.line}`,
    ruleId: rule.id,
    title: rule.title,
    summary: `${declaration.kind} ${declaration.value} includes Node.js ${detectedMajor}. ${rule.summary}`,
    severity,
    confidence: declaration.kind === "compatibility range" ? "range" : "exact",
    location: { path: relativePosix(root, declaration.path), line: declaration.line },
    ...(rule.replacement ? { replacement: rule.replacement } : {}),
    ...(rule.deadline ? { deadline: rule.deadline } : {}),
    ...(rule.migration ? { migration: rule.migration } : {}),
    sources: rule.sources,
  };
}

export function runtimeRuleContext(nodeRules: readonly NodeRule[]): RuntimeRuleContext {
  const endedRules = nodeRules.filter((rule) => !rule.scheduled);
  const scheduledMajors = nodeRules.flatMap((rule) => (rule.scheduled && rule.major !== undefined ? [rule.major] : []));
  const newestRuleMajor = Math.max(0, ...endedRules.map((rule) => rule.major ?? 0));
  return { endedRules, scheduledMajors, newestRuleMajor };
}

async function runtimeDeclarations(
  root: string,
  project: NpmProject | undefined,
  unclassified: DetectorUnclassifiedReference[],
): Promise<RuntimeDeclaration[]> {
  const declarations = project
    ? manifestRuntimeDeclarations(project.manifestPath, project.contents, project.manifest)
    : [];
  if (project) {
    for (const filename of [".nvmrc", ".node-version"] as const) {
      const path = resolve(root, project.directory, filename);
      const value = (await readOptional(path))?.trim();
      if (value) declarations.push({ path, line: 1, value, kind: "pinned runtime" });
    }
    for (const { name, version, line } of devEngineEntries(project.contents, "runtime")) {
      if (name !== "node" && name !== "nodejs") continue;
      if (!version.trim() || !semver.validRange(version)) {
        unclassified.push(noVersionData(relativePosix(root, project.manifestPath), line, NODE_PURL, version || name));
      } else {
        declarations.push({ path: project.manifestPath, line, value: version, kind: "compatibility range" });
      }
    }
  }
  declarations.push(...(await toolRuntimeDeclarations(root, project?.directory ?? "", unclassified)));
  return declarations;
}

export async function toolRuntimeDeclarations(
  root: string,
  directory: string,
  unclassified: DetectorUnclassifiedReference[],
): Promise<RuntimeDeclaration[]> {
  const declarations: RuntimeDeclaration[] = [];
  const asdf = resolve(root, directory, ".tool-versions");
  for (const { tool, versions, line } of parseToolVersionEntries((await readOptional(asdf)) ?? "")) {
    if (tool !== "nodejs") continue;
    for (const value of versions) {
      if (/^v?\d+(?:\.\d+){0,2}$/.test(value)) declarations.push({ path: asdf, line, value, kind: "pinned runtime" });
    }
  }
  for (const filename of MISE_FILES) {
    const path = resolve(root, directory, filename);
    const contents = await readOptional(path);
    if (contents === undefined) continue;
    for (const pin of miseDeclarations(relativePosix(root, path), contents, MISE_PARSERS, unclassified))
      declarations.push({ ...pin, path, kind: "pinned runtime" });
  }
  return declarations;
}

export async function runtimeFindings(
  root: string,
  project: NpmProject | undefined,
  nodeRules: readonly NodeRule[],
  { endedRules, scheduledMajors, newestRuleMajor }: RuntimeRuleContext,
  seen: Set<string>,
  unclassified: DetectorUnclassifiedReference[],
): Promise<DetectorFinding[]> {
  const declarations = await runtimeDeclarations(root, project, unclassified);
  const findings = project
    ? await otherDevEngineFindings(relativePosix(root, project.manifestPath), project.contents, unclassified)
    : [];
  return [
    ...findings,
    ...judgeRuntimeDeclarations(root, declarations, nodeRules, { endedRules, scheduledMajors, newestRuleMajor }, seen),
  ];
}

export function judgeRuntimeDeclarations(
  root: string,
  declarations: readonly RuntimeDeclaration[],
  nodeRules: readonly NodeRule[],
  { endedRules, scheduledMajors, newestRuleMajor }: RuntimeRuleContext,
  seen: Set<string>,
): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  for (const declaration of declarations) {
    const majors = runtimeMajors(
      declaration.value,
      newestRuleMajor,
      (major) => ruleForMajor(endedRules, major) !== undefined,
      basename(declaration.path) === ".tool-versions" ? [] : scheduledMajors,
    );
    for (const major of majors) {
      const rule = ruleForMajor([...nodeRules], major);
      const key = rule ? `${rule.id}:${declaration.path}:${declaration.line}` : "";
      if (!rule || seen.has(key)) continue;
      findings.push(declarationFinding(root, declaration, rule, major));
      seen.add(key);
    }
  }
  return findings;
}

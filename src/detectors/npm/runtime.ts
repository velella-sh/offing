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
import { type NodeRuntimeRule, type RuntimeRuleContext, matchingRuntimeRules } from "./runtime-rules.js";

export { runtimeRuleContext } from "./runtime-rules.js";

export type NodeRule = DeprecationRule & NodeRuntimeRule;

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
  context: RuntimeRuleContext<NodeRule>,
  seen: Set<string>,
  unclassified: DetectorUnclassifiedReference[],
): Promise<DetectorFinding[]> {
  const declarations = await runtimeDeclarations(root, project, unclassified);
  const findings = project
    ? await otherDevEngineFindings(relativePosix(root, project.manifestPath), project.contents, unclassified)
    : [];
  return [...findings, ...judgeRuntimeDeclarations(root, declarations, nodeRules, context, seen)];
}

export function judgeRuntimeDeclarations(
  root: string,
  declarations: readonly RuntimeDeclaration[],
  nodeRules: readonly NodeRule[],
  context: RuntimeRuleContext<NodeRule>,
  seen: Set<string>,
): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  for (const declaration of declarations) {
    const matches = matchingRuntimeRules(
      declaration.value,
      nodeRules,
      context,
      basename(declaration.path) !== ".tool-versions",
    );
    for (const { rule, major } of matches) {
      const key = `${rule.id}:${declaration.path}:${declaration.line}`;
      if (seen.has(key)) continue;
      findings.push(declarationFinding(root, declaration, rule, major));
      seen.add(key);
    }
  }
  return findings;
}

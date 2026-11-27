import { MISE_FILES } from "../../version-files/mise.js";
import { resolve } from "node:path";

import { DETECTOR_API_VERSION } from "../../sdk.js";
import type {
  Detector,
  DetectorAnalysis,
  DetectorContext,
  DetectorFinding,
  DetectorInputs,
  DetectorUnclassifiedReference,
} from "../../sdk.js";
import type { NpmProject } from "./project.js";
import { readOptional } from "../read-optional.js";
import type { loadNodeRules, MatchedPackageRule } from "./rules.js";

/** Turns usage-analysis skip lines (`path: reason`) into unclassified references for the report. */
function unclassifiedFromUsageSkips(skips: readonly string[]): DetectorUnclassifiedReference[] {
  return skips.map((detail) => {
    const separator = detail.indexOf(": ");
    const path = separator === -1 ? detail : detail.slice(0, separator);
    return {
      component: "source-usage",
      reference: path || detail,
      reason: separator === -1 ? detail : detail.slice(separator + 2),
      location: { path: path || ".", line: 1 },
    };
  });
}

async function scanToolVersionsOnly(root: string): Promise<DetectorAnalysis> {
  const unclassified: DetectorUnclassifiedReference[] = [];
  const { judgeRuntimeDeclarations, toolRuntimeDeclarations, runtimeRuleContext } = await import("./runtime.js");
  const declarations = await toolRuntimeDeclarations(root, "", unclassified);
  if (declarations.length === 0) return { findings: [], unclassified };
  const { loadNodeRules } = await import("./rules.js");
  const rules = await loadNodeRules();
  const findings = judgeRuntimeDeclarations(root, declarations, rules, runtimeRuleContext(rules), new Set());
  return { findings, unclassified };
}

async function npmRuntimeFindings(
  root: string,
  hasRoot: boolean,
  projects: readonly NpmProject[],
  rules: Awaited<ReturnType<typeof loadNodeRules>>,
  unclassified: DetectorUnclassifiedReference[],
): Promise<DetectorFinding[]> {
  const findings: DetectorFinding[] = [];
  const seen = new Set<string>();
  const { runtimeFindings, runtimeRuleContext } = await import("./runtime.js");
  const runtime = runtimeRuleContext(rules);
  for (const project of hasRoot ? projects : [undefined, ...projects]) {
    findings.push(...(await runtimeFindings(root, project, rules, runtime, seen, unclassified)));
  }
  return findings;
}

export class NpmDetector implements Detector {
  readonly apiVersion = DETECTOR_API_VERSION;
  readonly id = "npm";
  /** The files `scan` may read; conformance fails a scan that reads another. */
  readonly inputs: DetectorInputs = {
    fileNames: [
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
      ".nvmrc",
      ".node-version",
      ".tool-versions",
      ...MISE_FILES,
      "pnpm-workspace.yaml",
      "lerna.json",
    ],
    sourceExtensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".json", ".yaml", ".yml"],
  };

  async scan(context: DetectorContext): Promise<DetectorFinding[]> {
    return [...(await this.analyze(context)).findings];
  }

  async analyze(context: DetectorContext): Promise<DetectorAnalysis> {
    // The scan engine checks detector inputs and its cache before it needs npm's parsers.
    const { discoverNpmWorkspaces } = await import("../../workspaces.js");
    const rootManifest = await readOptional(resolve(context.root, "package.json"));
    const workspaceDirectories = await discoverNpmWorkspaces(context.root);
    const unclassified: DetectorUnclassifiedReference[] = [];
    if (!rootManifest && workspaceDirectories.length === 0) return scanToolVersionsOnly(context.root);
    const [usage, lockfiles, projectFiles, rules] = await Promise.all([
      import("../../source-usage.js"),
      import("./lockfiles/index.js"),
      import("./project.js"),
      import("./rules.js"),
    ]);
    if ((await readOptional(resolve(context.root, "bun.lockb"))) !== undefined) {
      unclassified.push(projectFiles.binaryBunLockReference("bun.lockb"));
    }

    const [packageRules, nodeRules, rootLock] = await Promise.all([
      rules.loadPackageRules(),
      rules.loadNodeRules(),
      lockfiles.collectLockData(context.root),
    ]);

    const projects: NpmProject[] = [];
    for (const directory of ["", ...workspaceDirectories]) {
      const project = await projectFiles.loadNpmProject(context.root, directory, rootManifest, rootLock, unclassified);
      if (project) projects.push(project);
    }

    const findings = await npmRuntimeFindings(context.root, Boolean(rootManifest), projects, nodeRules, unclassified);
    const matched: MatchedPackageRule[] = projects.flatMap((project) => rules.matchPackageRules(project, packageRules));

    const matchedRules = [...new Map(matched.map((item) => [item.rule.id, item.rule])).values()];
    const usageSkips: string[] = [];
    const usageAnalyses = await usage.analyzeSourceUsage(
      context.root,
      matchedRules.map((rule) => ({ id: rule.id, matchers: rule.usage ?? [] })),
      { skips: usageSkips },
    );
    unclassified.push(...unclassifiedFromUsageSkips(usageSkips));
    const usagesByRule = new Map(usageAnalyses.map((analysis) => [analysis.contractId, analysis.usages]));
    const projectDirectories = projects.map((project) => project.directory);

    for (const item of matched) {
      findings.push(rules.matchedRuleFinding(context.root, item, usagesByRule, projectDirectories));
    }
    return { findings, unclassified };
  }
}

export const npmDetector = new NpmDetector();

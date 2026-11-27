import { LineCounter, isMap, isScalar, parseDocument } from "yaml";
import type { Scalar } from "yaml";
import { versContains } from "@velella/ebb/vers";
import type { RegistryV2Rule } from "@velella/ebb/registry";

import { setupRuntimeVersions } from "./github-actions-node.js";
import { ruleFinding } from "../rule-finding.js";
import type { DetectorFinding, DetectorUnclassifiedReference } from "../sdk.js";

export const ACTION_RUNTIME_TARGET = "node24";

const NODE24_NOTICE = {
  title: "Node 20 is no longer available in GitHub Actions",
  url: "https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/",
};
const NODE16_NOTICE = {
  title: "End of life for Actions Node16",
  url: "https://github.blog/changelog/2024-09-25-end-of-life-for-actions-node16/",
};
const NODE12_NOTICE = {
  title: "GitHub Actions: All Actions will run on Node16 instead of Node12",
  url: "https://github.blog/changelog/2023-05-04-github-actions-all-actions-will-run-on-node16-instead-of-node12/",
};

export function actionRuntime(contents: string): { node: Scalar<string>; line: number } | undefined {
  const lines = new LineCounter();
  const document = parseDocument(contents, { lineCounter: lines, prettyErrors: false });
  if (document.errors.length > 0 || !isMap(document.contents)) return undefined;
  const runs = document.contents.get("runs", true);
  if (!isMap(runs) || typeof runs.get("main") !== "string") return undefined;
  const node = runs.get("using", true);
  if (!isRuntimeNode(node) || !node.range) return undefined;
  return { node, line: lines.linePos(node.range[0]).line };
}

function isRuntimeNode(node: unknown): node is Scalar<string> {
  return isScalar(node) && (node.value === "node12" || node.value === "node16");
}

/** Keep the Node.js rule identity while citing GitHub's separate runner deadlines and replacement. */
export function actionRuntimeFinding(
  contents: string,
  path: string,
  nodeLegacy: RegistryV2Rule | undefined,
): DetectorFinding | undefined {
  if (!nodeLegacy) return undefined;
  const runtime = actionRuntime(contents);
  if (!runtime) return undefined;
  const { node, line } = runtime;
  const old = node.value;
  return {
    ...ruleFinding(nodeLegacy, path, line, `${path} declares the retired GitHub Actions JavaScript runtime ${old}.`),
    title: `GitHub Actions JavaScript runtime ${old} is retired`,
    deadline: old === "node12" ? "2023-06-14" : "2024-11-12",
    replacement: ACTION_RUNTIME_TARGET,
    sources: [old === "node12" ? NODE12_NOTICE : NODE16_NOTICE, NODE24_NOTICE],
    migration: {
      constraints: ["Node.js 24 needs a supported GitHub Actions runner."],
      steps: [
        {
          id: "runtime",
          title: "Update the JavaScript action",
          instructions: "Set runs.using to node24 and test the action on a supported runner.",
          targets: "declaration",
        },
      ],
      verification: [],
    },
  };
}

const PYTHON_VERSION = /^\d+\.\d+(?:\.\d+)?$/;

export function judgeSetupPython(
  contents: string,
  path: string,
  rules: readonly RegistryV2Rule[],
  findings: DetectorFinding[],
  unclassified: DetectorUnclassifiedReference[],
): void {
  const seen = new Set<string>();
  for (const entry of setupRuntimeVersions(contents, "python")) {
    if (!PYTHON_VERSION.test(entry.value)) {
      if (entry.expression)
        unclassified.push({
          component: "actions/setup-python",
          reference: `python-version: ${entry.value}`,
          reason: "the version is an expression, which Offing does not evaluate",
          location: { path, line: entry.line },
        });
      continue;
    }
    const rule = rules.find((item) => versContains(item.vers, entry.value));
    if (!rule) continue;
    const finding = ruleFinding(
      rule,
      path,
      entry.line,
      `${path} installs Python ${entry.value} with actions/setup-python. ${rule.summary}`,
    );
    if (!seen.has(finding.id)) findings.push(finding);
    seen.add(finding.id);
  }
}

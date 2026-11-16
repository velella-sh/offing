import { LineCounter, isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { YAMLMap } from "yaml";

import { classifyDotnetVersion, setupDotnetVersions } from "../../src/detectors/github-actions-dotnet.js";
import { classifyNodeVersion, matrixList, setupNodeVersions } from "../../src/detectors/github-actions-node.js";
import { resolveReference } from "../../src/detectors/github-actions-reference.js";
import { reference } from "./references.js";
import type { Reference } from "./references.js";

export type ActionVersions = ReadonlyMap<string, ReadonlyMap<string, string>>;

function actionRef(step: YAMLMap, path: string, lines: LineCounter, versions: ActionVersions): Reference | undefined {
  const uses = step.get("uses", true);
  if (!isScalar(uses) || typeof uses.value !== "string") return undefined;
  const match = /^([\w.-]+\/[\w.-]+)(?:\/[\w./-]+)?@([^\s]+)$/.exec(uses.value);
  if (!match?.[1] || !match[2] || uses.value.startsWith("./") || uses.value.startsWith("../")) return undefined;
  const action = match[1].toLowerCase();
  const comment = uses.comment?.trim();
  const version = resolveReference(match[2], comment ? `# ${comment}` : undefined, versions.get(action))?.version;
  return reference(
    `pkg:github/${action}`,
    version?.replace(/^v/, "").split(".").concat("0", "0").slice(0, 3).join("."),
    path,
    lines.linePos(uses.range?.[0] ?? 0).line,
  );
}

function pythonRefs(step: YAMLMap, job: YAMLMap, path: string, lines: LineCounter): Reference[] {
  if (!/^actions\/setup-python@/i.test(String(step.get("uses") ?? ""))) return [];
  const inputs = step.get("with", true);
  const input = isMap(inputs) ? inputs.get("python-version", true) : undefined;
  if (!isScalar(input)) return [];
  return (matrixList(job, input)?.items ?? [input]).flatMap((item) => {
    if (!isScalar(item)) return [];
    const value = (item.source ?? String(item.value)).trim();
    const version = /^(\d+\.\d+)(?:\.x)?$/i.exec(value)?.[1] ?? (/^\d+\.\d+\.\d+$/.test(value) ? value : undefined);
    return [reference("pkg:generic/python", version, path, lines.linePos(item.range?.[0] ?? 0).line)];
  });
}

export function parseWorkflow(
  contents: string,
  path = "workflow.yml",
  versions: ActionVersions = new Map(),
): Reference[] {
  const lines = new LineCounter();
  const doc = parseDocument(contents, { lineCounter: lines, prettyErrors: false });
  const jobs = isMap(doc.contents) ? doc.contents.get("jobs", true) : undefined;
  if (doc.errors.length || !isMap(jobs)) throw new Error("Choose a valid GitHub Actions workflow with a jobs section.");
  const references: Reference[] = [];
  for (const { value: job } of jobs.items) {
    if (!isMap(job)) continue;
    const reusable = actionRef(job, path, lines, versions);
    if (reusable) references.push(reusable);
    const steps = job.get("steps", true);
    if (!isSeq(steps)) continue;
    for (const step of steps.items) {
      if (!isMap(step)) continue;
      const action = actionRef(step, path, lines, versions);
      if (action) references.push(action);
      references.push(...pythonRefs(step, job, path, lines));
    }
  }
  for (const { value, line } of setupNodeVersions(contents)) {
    const version = classifyNodeVersion(value);
    references.push(
      reference("pkg:generic/nodejs", version.kind === "versions" ? version.lowest : undefined, path, line),
    );
  }
  for (const { value, line } of setupDotnetVersions(contents)) {
    const version = classifyDotnetVersion(value);
    references.push(
      reference("pkg:generic/dotnet", version.kind === "versions" ? version.lowest : undefined, path, line),
    );
  }
  return references;
}

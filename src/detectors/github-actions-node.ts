import { LineCounter, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
import type { Node, Scalar, YAMLMap, YAMLSeq } from "yaml";

/**
 * Reads the `node-version` input of `actions/setup-node` steps from one workflow file. The workflow is parsed, never
 * evaluated. A `${{ matrix.<key> }}` input is followed to the literal list under `strategy.matrix.<key>` of the same
 * job; any other expression is reported as one and left to the caller to leave unclassified. Each entry carries the
 * line of the version itself, so a list points at the row that holds the version.
 */

export interface SetupNodeVersion {
  /** One version as written (`16`, `20.x`, `18.17.0`), or an expression. */
  value: string;
  line: number;
  expression: boolean;
}

export type SetupRuntime = "node" | "python";
const SETUP_INPUT = {
  node: { action: /^actions\/setup-node@/i, key: "node-version" },
  python: { action: /^actions\/setup-python@/i, key: "python-version" },
};
const MATRIX_REFERENCE = /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/;

/** The text a scalar was written as: YAML reads `16.10` as the number 16.1, so numbers use their source. */
export function runtimeInputText(node: Node): string | undefined {
  if (!isScalar(node)) return undefined;
  if (typeof node.value === "string") return node.value.trim();
  if (typeof node.value === "number") return (node.source ?? String(node.value)).trim();
  return undefined;
}

/** The `node-version` node of a `actions/setup-node` step, or undefined for any other step. */
function setupRuntimeInput(step: unknown, runtime: SetupRuntime): Scalar | undefined {
  if (!isMap(step)) return undefined;
  const uses = step.get("uses");
  if (typeof uses !== "string" || !SETUP_INPUT[runtime].action.test(uses)) return undefined;
  const inputs = step.get("with", true);
  if (!isMap(inputs)) return undefined;
  const version = inputs.get(SETUP_INPUT[runtime].key, true);
  return version && isScalar(version) ? version : undefined;
}

/** The list under `strategy.matrix.<key>` a `${{ matrix.<key> }}` input points at, if the job has one. */
export function matrixList(job: YAMLMap, version: Scalar): YAMLSeq | undefined {
  const key = typeof version.value === "string" ? MATRIX_REFERENCE.exec(version.value.trim())?.[1] : undefined;
  if (key === undefined) return undefined;
  const matrix = jobMatrix(job);
  const list = isMap(matrix) ? matrix.get(key, true) : undefined;
  return isSeq(list) ? list : undefined;
}

function jobMatrix(job: YAMLMap): YAMLMap | undefined {
  const strategy = job.get("strategy", true);
  const matrix = isMap(strategy) ? strategy.get("matrix", true) : undefined;
  return isMap(matrix) ? matrix : undefined;
}

interface WorkflowInput {
  version: Scalar;
  list?: YAMLSeq;
  restrictions: boolean;
}

export function setupRuntimeInputs(
  contents: string,
  runtime: SetupRuntime,
): { lines: LineCounter; inputs: WorkflowInput[]; anchored: boolean } {
  const lines = new LineCounter();
  const document = parseDocument(contents, { lineCounter: lines, prettyErrors: false, keepSourceTokens: true });
  const inputs: WorkflowInput[] = [];
  if (document.errors.length > 0 || !isMap(document.contents)) return { lines, inputs, anchored: false };
  const jobs = document.contents.get("jobs", true);
  if (!isMap(jobs)) return { lines, inputs, anchored: false };
  for (const job of jobs.items) {
    if (!isMap(job.value)) continue;
    const steps = job.value.get("steps", true);
    if (!isSeq(steps)) continue;
    const matrix = jobMatrix(job.value);
    for (const step of steps.items) {
      const version = setupRuntimeInput(step, runtime);
      if (!version) continue;
      const list = matrixList(job.value, version);
      const restrictions = matrix?.has("include") === true || matrix?.has("exclude") === true;
      inputs.push({ version, ...(list ? { list } : {}), restrictions });
    }
  }
  let anchored = false;
  visit(document, {
    Alias() {
      anchored = true;
      return visit.BREAK;
    },
    Node(_key, node) {
      if (node.anchor !== undefined) {
        anchored = true;
        return visit.BREAK;
      }
    },
  });
  return { lines, inputs, anchored };
}

export function setupRuntimeVersions(contents: string, runtime: SetupRuntime): SetupNodeVersion[] {
  const { lines, inputs } = setupRuntimeInputs(contents, runtime);
  const versions: SetupNodeVersion[] = [];
  for (const { version, list } of inputs) {
    for (const node of list ? list.items : [version]) {
      if (!isScalar(node)) continue;
      const value = runtimeInputText(node);
      if (!value) continue;
      versions.push({ value, line: lines.linePos(node.range?.[0] ?? 0).line, expression: value.includes("${{") });
    }
  }
  return versions;
}

export function setupNodeVersions(contents: string): SetupNodeVersion[] {
  return setupRuntimeVersions(contents, "node");
}

/** The release line a `node-version` entry names, as the lowest and highest version it can stand for. */
export type NodeVersionClass =
  | { kind: "versions"; lowest: string; highest: string }
  | { kind: "unclassified"; reason: string };

const UNBOUNDED = 999_999;
const LITERAL = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i;

export function classifyNodeVersion(value: string): NodeVersionClass {
  const match = LITERAL.exec(value);
  if (!match) return { kind: "unclassified", reason: `"${value}" is not a plain version, so Offing does not read it` };
  const [, major, minor, patch] = match;
  const open = (part: string | undefined): boolean => part === undefined || /^[x*]$/i.test(part);
  if (open(minor)) return { kind: "versions", lowest: `${major}.0.0`, highest: `${major}.${UNBOUNDED}.${UNBOUNDED}` };
  if (open(patch))
    return { kind: "versions", lowest: `${major}.${minor}.0`, highest: `${major}.${minor}.${UNBOUNDED}` };
  return { kind: "versions", lowest: `${major}.${minor}.${patch}`, highest: `${major}.${minor}.${patch}` };
}

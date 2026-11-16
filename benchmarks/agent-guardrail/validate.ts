import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { checkSnippet, snippetInputProblem } from "../../src/check-snippet.js";

const KINDS = ["package", "runtime", "action", "api"] as const;
type TaskKind = (typeof KINDS)[number];
const TASKS_FILE = new URL("../../../benchmarks/agent-guardrail/tasks.json", import.meta.url);

export interface GuardrailTask {
  id: string;
  kind: TaskKind;
  path: string;
  prompt: string;
  requested: string;
  accepted: string;
  /** Null marks a clean control. */
  ruleId: string | null;
}

function isKind(value: unknown): value is TaskKind {
  return KINDS.some((kind) => kind === value);
}

function isTask(value: unknown): value is GuardrailTask {
  if (typeof value !== "object" || value === null) return false;
  const task = value as Partial<GuardrailTask>;
  return (
    typeof task.id === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task.id) &&
    isKind(task.kind) &&
    typeof task.path === "string" &&
    /^(?:[.a-z0-9_-]+\/)*[a-z0-9_-][.a-z0-9_-]*$/i.test(task.path) &&
    typeof task.prompt === "string" &&
    task.prompt.trim() !== "" &&
    typeof task.requested === "string" &&
    task.requested.trim() !== "" &&
    typeof task.accepted === "string" &&
    task.accepted.trim() !== "" &&
    (task.ruleId === null || (typeof task.ruleId === "string" && task.ruleId.length > 0)) &&
    !snippetInputProblem(task.path, task.requested) &&
    !snippetInputProblem(task.path, task.accepted)
  );
}

export async function loadGuardrailTasks(): Promise<GuardrailTask[]> {
  const file = JSON.parse(await readFile(TASKS_FILE, "utf8")) as { schemaVersion?: unknown; tasks?: unknown };
  if (file?.schemaVersion !== "offing.agent-guardrail.v2" || !Array.isArray(file.tasks)) {
    throw new Error("Expected an offing.agent-guardrail.v2 task file.");
  }
  if (!file.tasks.every(isTask)) throw new Error("The task file contains a malformed task.");
  const tasks = file.tasks;
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("Duplicate task ID.");
  return tasks;
}

export async function validateGuardrailTasks(tasks: readonly GuardrailTask[]) {
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, tasks.filter((task) => task.kind === kind).length]));
  const issues: string[] = [];
  if (tasks.length < 100) issues.push("Expected at least 100 tasks.");
  for (const [kind, count] of Object.entries(counts)) {
    if (count < 15 || count / tasks.length > 0.4) issues.push(`Unbalanced category ${kind}: ${count}.`);
    if (!tasks.some((task) => task.kind === kind && task.ruleId === null))
      issues.push(`Missing clean ${kind} control.`);
  }
  for (const task of tasks) {
    const requested = await checkSnippet({ path: task.path, content: task.requested });
    const accepted = await checkSnippet({ path: task.path, content: task.accepted });
    const expected = task.ruleId;
    if (
      expected === null ? requested.findings.length : !requested.findings.some((finding) => finding.ruleId === expected)
    ) {
      issues.push(
        `${task.id}: expected ${expected ?? "no findings"}; got ${requested.findings.map((f) => f.ruleId).join(", ")}.`,
      );
    }
    if (accepted.findings.length) issues.push(`${task.id}: accepted edit still has lifecycle findings.`);
    if (expected === null && task.requested !== task.accepted)
      issues.push(`${task.id}: control has a different accepted edit.`);
  }
  return { counts, issues };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validateGuardrailTasks(await loadGuardrailTasks());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.issues.length ? 1 : 0;
}

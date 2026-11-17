import { isDeepStrictEqual } from "node:util";

import { subset } from "semver";
import { parse as parseYaml } from "yaml";

import type { GuardrailTask } from "./validate.js";

export const GUARDRAIL_ARMS = ["baseline", "guardrail"] as const;
export type GuardrailArm = (typeof GUARDRAIL_ARMS)[number];

const EMPTY_COUNTS = {
  refused: 0,
  "correct-replacement": 0,
  "false-block": 0,
  "obsolete-edit": 0,
  "clean-edit": 0,
  "blocked-edit": 0,
  "unscored-edit": 0,
  "no-edit": 0,
  failed: 0,
};

type Outcome = keyof typeof EMPTY_COUNTS;

export interface Observation {
  content: string | null;
  deniedRequestedEdit: boolean;
  refused: boolean;
  failed: boolean;
}

function normalize(content: string | null): string | null {
  return content?.replaceAll("\r\n", "\n").trim() ?? null;
}

function sameManifest(content: string, expected: string): boolean {
  const actual = JSON.parse(content) as { dependencies?: Record<string, unknown> } | null;
  const reference = JSON.parse(expected) as { dependencies?: Record<string, unknown> } | null;
  if (!actual?.dependencies || !reference?.dependencies) return false;
  const [dependency] = Object.keys(reference.dependencies);
  if (!dependency) return false;
  const actualRange = actual.dependencies[dependency];
  const referenceRange = reference.dependencies[dependency];
  if (typeof actualRange !== "string" || typeof referenceRange !== "string") return false;
  const dependencies = { ...actual.dependencies, [dependency]: referenceRange };
  return isDeepStrictEqual({ ...actual, dependencies }, reference) && subset(actualRange, referenceRange);
}

function matchesEdit(path: string, content: string, expected: string): boolean {
  if (content === normalize(expected)) return true;
  try {
    if (path === "package.json") return sameManifest(content, expected);
    if (path.endsWith(".yml")) return isDeepStrictEqual(parseYaml(content), parseYaml(expected));
  } catch {
    return false;
  }
  return false;
}

export function scoreAttempt(task: GuardrailTask, observation: Observation): Outcome {
  if (observation.failed) return "failed";
  const content = normalize(observation.content);
  if (task.ruleId === null && observation.deniedRequestedEdit) return "false-block";
  if (content === null) {
    if (observation.refused) return "refused";
    return observation.deniedRequestedEdit ? "blocked-edit" : "no-edit";
  }
  if (matchesEdit(task.path, content, task.requested)) return task.ruleId === null ? "clean-edit" : "obsolete-edit";
  if (matchesEdit(task.path, content, task.accepted)) return "correct-replacement";
  return "unscored-edit";
}

export function summarizeAttempts(
  attempts: readonly { task: GuardrailTask; arm: GuardrailArm; observation: Observation }[],
) {
  return GUARDRAIL_ARMS.map((arm) => {
    const rows = attempts.filter((attempt) => attempt.arm === arm);
    const outcomes = rows.map(({ task, observation }) => scoreAttempt(task, observation));
    const controls = rows.filter(({ task }) => task.ruleId === null).length;
    const counts = { ...EMPTY_COUNTS };
    for (const outcome of outcomes) counts[outcome] += 1;
    const riskyTasks = rows.length - controls;
    const riskyEditDenials = rows.filter(
      ({ task, observation }) => task.ruleId !== null && observation.deniedRequestedEdit,
    ).length;
    return {
      arm,
      attempts: rows.length,
      controls,
      riskyTasks,
      riskyEditDenials,
      counts,
      rates: {
        refused: rows.length ? counts.refused / rows.length : null,
        correctReplacement: riskyTasks ? counts["correct-replacement"] / riskyTasks : null,
        obsoleteEdit: riskyTasks ? counts["obsolete-edit"] / riskyTasks : null,
        falseBlock: controls ? counts["false-block"] / controls : null,
      },
    };
  });
}

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

export function scoreAttempt(task: GuardrailTask, observation: Observation): Outcome {
  if (observation.failed) return "failed";
  const content = normalize(observation.content);
  if (task.ruleId === null && observation.deniedRequestedEdit) return "false-block";
  if (content === null) {
    if (observation.refused) return "refused";
    return observation.deniedRequestedEdit ? "blocked-edit" : "no-edit";
  }
  if (content === normalize(task.requested)) return task.ruleId === null ? "clean-edit" : "obsolete-edit";
  if (content === normalize(task.accepted)) return "correct-replacement";
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
    return {
      arm,
      attempts: rows.length,
      controls,
      riskyTasks,
      counts,
      rates: {
        refused: rows.length ? counts.refused / rows.length : null,
        correctReplacement: riskyTasks ? counts["correct-replacement"] / riskyTasks : null,
        falseBlock: controls ? counts["false-block"] / controls : null,
      },
    };
  });
}

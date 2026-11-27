import { performance } from "node:perf_hooks";

import type { AutopilotConfig, Limits } from "./config.js";

const counters = ["turns", "tokens", "costCents"] as const;
type Usage = Pick<Limits, (typeof counters)[number]>;
type Stop = "invalid-usage" | "turn-active" | `${"run" | "turn"}.${keyof Limits}`;
type Admission = { stop: Stop } | { limits: Limits; finish(usage: Usage): Stop | null };

export function createBudget(budget: AutopilotConfig["budget"], now = () => performance.now()) {
  const started = now();
  const spent: Usage = { turns: 0, tokens: 0, costCents: 0 };
  let active = false;
  let stop: Stop | null = null;

  const timeLeft = () => Math.floor(budget.run.wallTimeMs - (now() - started));

  function begin(): Admission {
    if (stop) return { stop };
    if (active) return { stop: "turn-active" };
    const remaining = { ...budget.run, wallTimeMs: timeLeft() };
    for (const key of counters) remaining[key] -= spent[key];
    for (const key of ["wallTimeMs", "turns", "tokens"] as const) {
      if (remaining[key] <= 0) return { stop: (stop = `run.${key}`) };
    }
    const limits = {
      wallTimeMs: Math.min(remaining.wallTimeMs, budget.turn.wallTimeMs),
      turns: Math.min(remaining.turns, budget.turn.turns),
      tokens: Math.min(remaining.tokens, budget.turn.tokens),
      costCents: Math.min(remaining.costCents, budget.turn.costCents),
    };
    const turnStarted = now();
    active = true;
    let closed = false;
    return {
      limits,
      finish(usage) {
        if (!active || closed) return "invalid-usage";
        closed = true;
        active = false;
        stop = checkTurn(usage, timeLeft(), now() - turnStarted, remaining, budget.turn);
        if (!stop) for (const key of counters) spent[key] += usage[key];
        return stop;
      },
    };
  }

  return { begin };
}

function checkTurn(
  usage: Usage,
  runTimeLeft: number,
  turnElapsed: number,
  remaining: Limits,
  turn: Limits,
): Stop | null {
  if (runTimeLeft < 0) return "run.wallTimeMs";
  if (turnElapsed > turn.wallTimeMs) return "turn.wallTimeMs";
  if (counters.some((key) => !Number.isSafeInteger(usage[key]) || usage[key] < 0) || usage.turns === 0) {
    return "invalid-usage";
  }
  for (const key of counters) {
    if (usage[key] > remaining[key] && remaining[key] <= turn[key]) return `run.${key}`;
    if (usage[key] > turn[key]) return `turn.${key}`;
  }
  return null;
}

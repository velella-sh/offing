import type { UpgradeTarget } from "../upgrade/index.js";

const transitions = {
  scan: ["plan", "stopped"],
  plan: ["baseline-tests", "agent-turn", "stopped"],
  "baseline-tests": ["codemods", "stopped"],
  codemods: ["agent-turn", "tests", "stopped"],
  "agent-turn": ["tests", "stopped"],
  tests: ["verify", "agent-turn", "stopped"],
  verify: ["agent-turn", "done", "stopped"],
  done: [],
  stopped: [],
} as const;

type State = keyof typeof transitions;

export interface Selection {
  wave: number | null;
  findingIds: string[];
  target?: UpgradeTarget;
}

export interface AutopilotRun {
  schemaVersion: "offing.autopilot-run.v1";
  mode: "dry-run" | "prepare";
  state: State;
  transitions: State[];
  selection?: Selection;
  checkout?: { id: string; branch: string; baseCommit: string };
  stopReason?: string;
}

export function startRun(mode: AutopilotRun["mode"]): AutopilotRun {
  return { schemaVersion: "offing.autopilot-run.v1", mode, state: "scan", transitions: ["scan"] };
}

export function advanceRun(run: AutopilotRun, state: Exclude<State, "stopped"> | { stop: string }): void {
  const next = typeof state === "string" ? state : "stopped";
  const allowed: readonly State[] = transitions[run.state];
  if (!allowed.includes(next)) throw new Error(`Invalid Autopilot transition: ${run.state} to ${next}.`);
  run.state = next;
  run.transitions.push(next);
  if (typeof state !== "string") run.stopReason = state.stop;
}

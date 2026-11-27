import { resumeReplayLoop, runReplayLoop } from "./replay.js";
import type { PlanOptions } from "./plan.js";
import { startRun, type AutopilotRun } from "./state.js";
import { resumeAutopilotWorktree, runIdPattern, withAutopilotWorktree } from "./worktree.js";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { OffingError } from "../offing-error.js";
import { runContainerTests } from "../test-runners/consumer.js";
import type { CommandContext } from "../commands/types.js";

const usage = "offing autopilot [path] --test-only [--container]";

/** Execute an expressly requested test-only operation with no migration phases. */
export async function runTestOnly(args: string[], ctx: CommandContext): Promise<number> {
  let options: ReturnType<typeof parseArgs>;
  try {
    options = parseArgs({
      args,
      allowPositionals: true,
      options: { "test-only": { type: "boolean" }, container: { type: "boolean" } },
    });
  } catch {
    return ctx.fail("usage", "Usage: " + usage);
  }
  const { positionals, values } = options;
  if (values["test-only"] !== true || positionals.length > 1) return ctx.fail("usage", "Usage: " + usage);
  try {
    const result = await runContainerTests(resolve(positionals[0] ?? "."));
    process.stdout.write("Pinned Docker tests\n" + result.output);
    return result.passed ? 0 : 1;
  } catch (error) {
    if (error instanceof OffingError) return ctx.failError(error);
    return ctx.fail(
      "data",
      "Pinned Docker test execution is unavailable. Check that Docker and the pinned image are accessible.",
    );
  }
}

const replayLoopUsage = [
  "  offing autopilot [path] --run-replay <recording> [--agent replay] [--allow-red-baseline <test>] [--wave <n> | --finding <id>]",
  "  offing autopilot [path] --resume <run> --run-replay <remaining-recording>",
].join("\n");

type SelectPlan = (wave?: string, finding?: string, target?: string) => PlanOptions;

function parseLoop(args: string[], select: SelectPlan) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "run-replay": { type: "string" },
      resume: { type: "string" },
      agent: { type: "string" },
      "allow-red-baseline": { type: "string", multiple: true },
      wave: { type: "string" },
      finding: { type: "string" },
    },
  });
  const file = values["run-replay"];
  const allowed = values["allow-red-baseline"] ?? [];
  if (
    !file?.trim() ||
    positionals.length > 1 ||
    allowed.length > 64 ||
    allowed.some((name) => !name.trim() || name.length > 1024)
  ) {
    throw new Error("A replay recording and at most one project path are required.");
  }
  if (values.agent !== undefined && values.agent !== "replay") throw new Error("--run-replay uses the replay driver.");
  const resume = values.resume;
  if (resume !== undefined && !runIdPattern.test(resume)) throw new Error("Invalid run ID.");
  if (resume !== undefined && (allowed.length || values.wave !== undefined || values.finding !== undefined)) {
    throw new Error("Resume keeps the recorded selection and baseline policy.");
  }
  return {
    root: resolve(positionals[0] ?? "."),
    file: resolve(file),
    resume,
    selection: select(values.wave, values.finding),
    allowedBaseline: new Set(allowed),
  };
}

export function replayProgressLine(run: AutopilotRun): string {
  const { replay } = run;
  const used = replay?.usage ?? { turns: 0, tokens: 0, costCents: 0 };
  return `${run.state}: turn ${replay?.turn ?? 0}; budget used ${used.turns} turns, ${used.tokens} tokens, ${used.costCents} cents, ${replay?.elapsedMs ?? 0} ms; tests ${replay?.tests ?? "pending"}.`;
}

function replayResult(run: AutopilotRun, location: { tree: string; branch: string; record: string }): number {
  const outcome = run.state === "done" ? "Replay verified" : `Replay stopped (${run.stopReason})`;
  const lines = [`${outcome} in ${location.tree}.`, `Branch: ${location.branch}`, `Run record: ${location.record}`];
  if (run.replay?.remaining !== undefined) {
    const verification = run.replay.resume === 0 ? "final" : `resume-${run.replay.resume}`;
    lines.push(`Wave findings: ${run.replay.remaining} remaining, ${run.replay.introduced} introduced.`);
    const recordDirectory = dirname(location.record);
    const verificationPath = join(recordDirectory, verification + "-verify-result.json");
    lines.push(`Verification: ${verificationPath}`);
  }
  lines.push(`After review, remove the worktree, then use git branch -D ${location.branch} to discard the branch.`);
  process.stdout.write(lines.join("\n") + "\n");
  return run.state === "done" ? 0 : 1;
}

export async function runReplayLoopCommand(args: string[], ctx: CommandContext, select: SelectPlan): Promise<number> {
  let options: ReturnType<typeof parseLoop>;
  try {
    options = parseLoop(args, select);
  } catch (error) {
    return ctx.fail("usage", error instanceof Error ? error.message : String(error), replayLoopUsage);
  }
  const loop = {
    ...options,
    started: performance.now(),
    report: (run: AutopilotRun) => process.stdout.write(replayProgressLine(run) + "\n"),
  };
  if (options.resume) {
    const { location, run } = await resumeAutopilotWorktree(
      options.root,
      options.resume,
      async (tree, checkout, run, before) => {
        await resumeReplayLoop(tree, checkout, run, loop, before);
      },
    );
    return replayResult(run, location);
  }
  const run = startRun("prepare");
  const location = await withAutopilotWorktree(options.root, run, async (tree, checkout) => {
    await runReplayLoop(tree, checkout, run, loop);
  });
  return replayResult(run, location);
}

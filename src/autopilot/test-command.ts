import { runReplayLoop } from "./replay.js";
import type { PlanOptions } from "./plan.js";
import { startRun } from "./state.js";
import { withAutopilotWorktree } from "./worktree.js";
import { resolve } from "node:path";
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
    const result = await runContainerTests(resolve(positionals[0] ?? "."), values.container === true);
    process.stdout.write(result.output);
    return result.passed ? 0 : 1;
  } catch (error) {
    if (error instanceof OffingError) return ctx.failError(error);
    return ctx.fail(
      "data",
      "Pinned Docker test execution is unavailable. Check that Docker and the pinned image are accessible.",
    );
  }
}

const replayLoopUsage =
  "  offing autopilot [path] --run-replay <recording> [--allow-red-baseline <test>] [--wave <n> | --finding <id>]";

type SelectPlan = (wave?: string, finding?: string, target?: string) => PlanOptions;

function parseLoop(args: string[], select: SelectPlan) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "run-replay": { type: "string" },
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
  return {
    root: resolve(positionals[0] ?? "."),
    file: resolve(file),
    selection: select(values.wave, values.finding),
    allowedBaseline: new Set(allowed),
  };
}

export async function runReplayLoopCommand(args: string[], ctx: CommandContext, select: SelectPlan): Promise<number> {
  let options: ReturnType<typeof parseLoop>;
  try {
    options = parseLoop(args, select);
  } catch (error) {
    return ctx.fail("usage", error instanceof Error ? error.message : String(error), replayLoopUsage);
  }
  const run = startRun("prepare");
  const started = performance.now();
  const location = await withAutopilotWorktree(options.root, run, async (tree, checkout) => {
    await runReplayLoop(tree, checkout, run, { ...options, started });
  });
  const outcome = run.state === "done" ? "Replay verified" : `Replay stopped (${run.stopReason})`;
  process.stdout.write(`${outcome} in ${location.tree}.\nRun record: ${location.record}\n`);
  return run.state === "done" ? 0 : 1;
}

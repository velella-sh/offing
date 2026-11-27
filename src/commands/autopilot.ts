import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { parseAutopilotConfig } from "../autopilot/limits/config.js";
import { planAutopilot, renderAutopilotPreview } from "../autopilot/plan.js";
import { prepareReplay } from "../autopilot/replay.js";
import { advanceRun, startRun } from "../autopilot/state.js";
import { runIdPattern, undoAutopilotWorktree, withAutopilotWorktree } from "../autopilot/worktree.js";
import { parseUpgradeTarget } from "../upgrade/index.js";
import type { CliCommand } from "./types.js";

const usage = [
  "  offing autopilot [path] --dry-run [--wave <n> | --finding <id>] [--to <runtime@version>] [--agent <driver>]",
  "  offing autopilot [path] --prepare [--replay <recording>] [--wave <n> | --finding <id>] [--to <runtime@version>]",
  "  offing autopilot [path] --test-only [--container]",
  "  offing autopilot [path] --undo [run]",
];

function planArguments(waveArg: string | undefined, finding: string | undefined, to: string | undefined) {
  if (waveArg !== undefined && finding !== undefined) throw new Error("Use --wave or --finding.");
  const wave = Number(waveArg);
  if (waveArg !== undefined && (!/^\d+$/.test(waveArg) || !Number.isSafeInteger(wave))) {
    throw new Error("--wave needs a non-negative integer.");
  }
  if (finding?.trim() === "") throw new Error("--finding needs a finding ID.");
  const target = to === undefined ? undefined : parseUpgradeTarget(to);
  if (to !== undefined && target === undefined) throw new Error("--to needs a runtime and version (e.g. nodejs@22).");
  return {
    ...(waveArg === undefined ? {} : { wave }),
    ...(finding === undefined ? {} : { finding }),
    ...(target === undefined ? {} : { target }),
  };
}

function undoArguments(positionals: string[]) {
  const [first, second] = positionals;
  const singleId = positionals.length === 1 && first !== undefined && runIdPattern.test(first);
  const id = singleId ? first : second;
  if (positionals.length > 2 || (id !== undefined && !runIdPattern.test(id))) throw new Error("Invalid run ID.");
  return { mode: "undo" as const, root: resolve(singleId ? "." : (first ?? ".")), id };
}

function replayPath(recording: string | undefined, prepare: boolean | undefined): string | undefined {
  if (recording === undefined) return undefined;
  if (!prepare || !recording.trim()) throw new Error("--replay needs a recording path and --prepare.");
  return resolve(recording);
}

function parseAutopilotArgs(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean" },
      prepare: { type: "boolean" },
      replay: { type: "string" },
      undo: { type: "boolean" },
      wave: { type: "string" },
      finding: { type: "string" },
      to: { type: "string" },
      agent: { type: "string" },
    },
  });
  const modes = [values["dry-run"], values.prepare, values.undo].filter(Boolean);
  if (modes.length !== 1) throw new Error("Choose --dry-run, --prepare, or --undo.");
  const replay = replayPath(values.replay, values.prepare);
  if (values.undo) {
    if (
      values.wave !== undefined ||
      values.finding !== undefined ||
      values.to !== undefined ||
      values.agent !== undefined
    ) {
      throw new Error("--undo accepts only a path and optional run ID.");
    }
    return undoArguments(positionals);
  }
  if (positionals.length > 1) throw new Error("Provide at most one project path.");
  if (values.agent !== undefined && !values["dry-run"]) throw new Error("--agent is available for --dry-run.");
  return {
    mode: values.prepare ? ("prepare" as const) : ("dry-run" as const),
    root: resolve(positionals[0] ?? "."),
    selection: planArguments(values.wave, values.finding, values.to),
    driver: values.agent === undefined ? undefined : parseAutopilotConfig({ driver: values.agent }).driver,
    replay,
  };
}

export const command: CliCommand = {
  name: "autopilot",
  flags: [
    "--dry-run",
    "--prepare",
    "--replay",
    "--test-only",
    "--container",
    "--undo",
    "--wave",
    "--finding",
    "--to",
    "--agent",
  ],
  example: "offing autopilot . --dry-run --to nodejs@22",
  usage,
  async run(args, ctx) {
    if (args.includes("--test-only") || args.includes("--container")) {
      const { runTestOnly } = await import("../autopilot/test-command.js");
      return runTestOnly(args, ctx);
    }
    let options: ReturnType<typeof parseAutopilotArgs>;
    try {
      options = parseAutopilotArgs(args);
    } catch (error) {
      return ctx.fail("usage", error instanceof Error ? error.message : String(error), usage.join("\n"));
    }
    const { root, mode } = options;
    if (!(await stat(root).catch(() => undefined))?.isDirectory())
      return ctx.fail("usage", "Choose a readable directory.");
    if (mode === "undo") {
      const branch = await undoAutopilotWorktree(root, options.id);
      process.stdout.write(`Removed prepared worktree and branch ${branch}.\n`);
      return 0;
    }
    const run = startRun(mode);
    if (mode === "dry-run") {
      const plan = await planAutopilot(root, run, options.selection);
      const preview = await renderAutopilotPreview(root, plan, options.driver);
      advanceRun(run, { stop: "dry-run" });
      process.stdout.write(`${preview}\nTransitions: ${run.transitions.join(" → ")}.\n`);
      return 0;
    }
    let prepared = true;
    const started = performance.now();
    const location = await withAutopilotWorktree(root, run, async (tree) => {
      const plan = await planAutopilot(tree, run, options.selection);
      if (options.replay) {
        prepared = await prepareReplay(tree, options.replay, run, started, plan);
        return;
      }
      advanceRun(run, "baseline-tests");
      advanceRun(run, { stop: "isolated-test-runner-unavailable" });
    });
    if (options.replay) {
      process.stdout.write(
        `Replay ${prepared ? "prepared" : "stopped"} (${run.stopReason}) in ${location.tree}.\nRun record: ${location.record}\n`,
      );
      return prepared ? 0 : 1;
    }
    process.stdout.write(
      `Prepared ${location.branch} in ${location.tree}. Test execution is unavailable.\nRun record: ${location.record}\n`,
    );
    return 0;
  },
};

import { createReplayDriver } from "../agent-drivers/replay.js";
import { loadConfig } from "../config.js";
import { buildFindingPacket } from "../migrate/prompt.js";
import { parseAutopilotConfig } from "./limits/config.js";
import { childEnvironments } from "./limits/secrets.js";
import type { planAutopilot } from "./plan.js";
import { advanceRun, type AutopilotRun } from "./state.js";
import { trackedAutopilotTestFiles } from "./worktree.js";

/** Apply recorded edit data to the private worktree. Replay has no model, shell commands, or test execution. */
export async function prepareReplay(
  tree: string,
  file: string,
  run: AutopilotRun,
  started: number,
  { scan, selection }: Awaited<ReturnType<typeof planAutopilot>>,
) {
  const config = (await loadConfig(tree))?.autopilot ?? parseAutopilotConfig(undefined);
  const packets = await Promise.all(selection.findingIds.map((id) => buildFindingPacket(scan, id, tree)));
  const { redact } = childEnvironments(process.env, "replay", config.secretEnv);
  const { target } = selection;
  run.selection = {
    wave: selection.wave,
    findingIds: [...new Set(selection.findingIds.map(redact))],
    ...(target ? { target: { runtime: redact(target.runtime), version: redact(target.version) } } : {}),
  };
  const testFiles = await trackedAutopilotTestFiles(tree);
  advanceRun(run, "agent-turn");
  const output = await createReplayDriver(file, { config, packets, testFiles, started }).run({
    worktreePath: tree,
    prompt: "",
    timeoutMs: config.budget.run.wallTimeMs,
  });
  advanceRun(run, { stop: "stopReason" in output ? output.stopReason : "replay-prepared" });
  return output.exitCode === 0;
}

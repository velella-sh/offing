import { readFile } from "node:fs/promises";
import { createReplayDriver } from "../../src/agent-drivers/replay.js";
const target = process.argv[2];
if (!target) throw new Error("Missing benchmark target.");
const prompt = await readFile("prompt.md", "utf8");
const { result } = await createReplayDriver("recording.json").run({
  prompt,
  worktreePath: "checkout",
  allowedPaths: [target],
  timeoutMs: 10_000,
});
const output = result.filesTouched.includes(target)
  ? await readFile("checkout/" + target, "utf8")
  : null;
process.stdout.write(JSON.stringify({ result, output }));

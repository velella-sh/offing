import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageReplayWorker } from "../../src/agent-drivers/replay.js";
import { checkedResult, record, validPaths } from "../../src/agent-drivers/result.js";
import { connectDocker, pinnedDockerRunner, type ContainerExecutor } from "../../src/test-runners/docker.js";

export type TaskSandbox = (root: string, command: Parameters<ContainerExecutor>[0]) => Promise<Buffer>;
const receiptLimit = 9 * 1024 * 1024; // An 8 MiB recording plus bounded result metadata.

/** The Docker client uses a fresh configuration, and the shared runner mounts only the staged input archive. */
export async function withTaskSandbox<T>(run: (sandbox: TaskSandbox) => Promise<T>): Promise<T> {
  const config = await mkdtemp(join(tmpdir(), "offing-agent-docker-"));
  try {
    const runner = pinnedDockerRunner(await connectDocker(config, receiptLimit));
    return await run(async (root, command) => {
      const execute = await runner.prepare("npm", root);
      const stdout: Uint8Array[] = [];
      const { exitCode } = await execute(
        command,
        { signal: AbortSignal.timeout(120_000), stdout: (chunk) => stdout.push(chunk), stderr: () => {} },
        false,
      );
      if (exitCode !== 0) throw new Error("The isolated agent benchmark task did not finish.");
      return Buffer.concat(stdout);
    });
  } finally {
    await rm(config, { recursive: true, force: true });
  }
}

const worker = `
  import { readFile } from "node:fs/promises";
  import { createReplayDriver } from "./agent-drivers/replay.js";
  const target = process.argv[1];
  const prompt = await readFile("prompt.md", "utf8");
  const { result } = await createReplayDriver("recording.json").run({
    prompt, worktreePath: "checkout", allowedPaths: [target], timeoutMs: 10_000,
  });
  const output = result.filesTouched.includes(target) ? await readFile("checkout/" + target, "utf8") : null;
  process.stdout.write(JSON.stringify({ result, output }));
`;

export async function replaySandboxTask(
  sandbox: TaskSandbox,
  staging: string,
  input: { project: string; target: string; prompt: string; recording: Buffer },
) {
  if (!validPaths([input.target])) throw new Error("Invalid agent benchmark target.");
  await cp(input.project, join(staging, "checkout"), { recursive: true });
  await stageReplayWorker(staging);
  await writeFile(join(staging, "recording.json"), input.recording);
  await writeFile(join(staging, "prompt.md"), input.prompt);
  const response = await sandbox(staging, ["node", "--input-type=module", "--eval", worker, "--", input.target]);
  const receipt = record(JSON.parse(response.toString("utf8")));
  const result = checkedResult(receipt?.result);
  const output = receipt?.output;
  const expectedFiles = typeof output === "string" ? [input.target] : [];
  if (
    (output !== null && typeof output !== "string") ||
    JSON.stringify(result.filesTouched) !== JSON.stringify(expectedFiles)
  ) {
    throw new Error("The sandbox returned an unexpected agent benchmark target.");
  }
  return { result, output: typeof output === "string" ? Buffer.from(output) : undefined };
}

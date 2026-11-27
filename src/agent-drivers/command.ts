import { type AgentDriver, makeResult, withRunFiles } from "./contract.js";
import { runShell, truncate } from "./process.js";
import { checkedResult, readJsonFile } from "./result.js";

export interface CommandAgentOptions {
  name?: string;
  command: string;
  env?: Record<string, string>;
  requireResult?: boolean;
}

export function createCommandAgent(options: CommandAgentOptions): AgentDriver {
  const name = options.name ?? "command";
  return {
    name,
    detect: () => Promise.resolve(Boolean(options.command.trim())),
    version: () => Promise.resolve(null),
    async run(input) {
      return withRunFiles(input, async ({ resultFile, env }) => {
        const result = await runShell(options.command, {
          cwd: input.worktreePath,
          timeoutMs: input.timeoutMs,
          env: { ...options.env, ...env },
        });
        const output = { ...result, stdout: truncate(result.stdout), stderr: truncate(result.stderr) };
        return {
          ...output,
          result:
            options.requireResult && !output.timedOut
              ? checkedResult(await readJsonFile(resultFile, 64 * 1024))
              : makeResult({ name, version: null }, output),
        };
      });
    },
  };
}

import { initAgents, initClaudeHooks, initCodexHooks } from "../../src/init-agents.js";
import { readStackContext } from "../../src/stack-context-local.js";
import type { StalenessTask } from "../agent-staleness/score.js";
import type { Arm } from "./contract.js";

export function taskPrompt(task: StalenessTask): string {
  return [
    task.prompt,
    "",
    "Write the complete file to " +
      task.target +
      ". Do not create other files. Do not mention specific version numbers unless the file format requires a version field.",
  ].join("\n");
}

export async function applyHooksArm(root: string, host?: string): Promise<void> {
  await initAgents({ root });
  if (host === "claude-code") await initClaudeHooks({ root });
  else if (host === "codex") await initCodexHooks({ root });
}

export async function sessionPrompt(
  task: StalenessTask,
  arm: Arm,
  root: string,
  host: string,
  asOf: string,
): Promise<string> {
  const prompt = taskPrompt(task);
  if (arm === "hooks") await applyHooksArm(root, host);
  if (arm === "context") {
    const context = await readStackContext(root, "scan", asOf + "T00:00:00.000Z");
    return prompt + "\n\nStack context (lifecycle evidence):\n" + JSON.stringify(context, null, 2);
  }
  return prompt;
}

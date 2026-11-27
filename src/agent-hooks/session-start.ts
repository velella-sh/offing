import process from "node:process";

import { serialized } from "../mcp/limit.js";
import { readStackContext } from "../stack-context-local.js";

function envelope(host: string | undefined, context: string): object | undefined {
  switch (host) {
    case "claude-code":
    case "codex":
    case "devin":
      return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } };
    case "cursor":
      return { additional_context: context };
    case "copilot":
      return { additionalContext: context };
    case "gemini":
      return { hookSpecificOutput: { additionalContext: context } };
    case "cline":
      return { cancel: false, contextModification: context };
    default:
      return undefined;
  }
}

/** Host commands run in the project directory supplied by the launcher. */
export async function runSessionStart(args: readonly string[], read: () => Promise<string>): Promise<number> {
  const host = args[0];
  if (args.length !== 1 || envelope(host, "") === undefined) {
    process.stderr.write("Offing stack context skipped: use a supported session-start host.\n");
    return 0;
  }
  try {
    // Drain the standard hook payload. The working directory is the only scan target.
    await read();
    const context = await readStackContext(".", "cached");
    if (context === undefined) {
      process.stderr.write(
        "Offing stack context unavailable: run offing scan in this project to refresh the local scan cache.\n",
      );
    } else {
      const message = `Offing lifecycle evidence (reviewed data)\n${serialized(context)}`;
      process.stdout.write(`${JSON.stringify(envelope(host, message))}\n`);
    }
  } catch {
    process.stderr.write("Offing stack context unavailable: the local scan could not be read.\n");
  }
  return 0;
}

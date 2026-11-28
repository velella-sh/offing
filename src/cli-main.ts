import process from "node:process";

import { cliOptionArgs } from "./cli-args.js";
import { commands } from "./commands/index.generated.js";
import { bindContext, createCommandContext, fail } from "./commands/runtime.js";
import { isCompletionShell, renderCompletions, renderHelp } from "./completions.js";
import { unexpectedFailure } from "./errors.js";
import { classifyError } from "./offing-error.js";
import { runOnboarding } from "./onboarding/first-run.js";
import { VERSION } from "./version.js";

const HELP = renderHelp(commands);

/** Dispatches one CLI invocation and returns its exit code. Exported so tests can drive the shipping commands in process. */
export async function main(rawArgs: readonly string[]): Promise<number> {
  const optionArgs = cliOptionArgs(rawArgs);
  const ctx = createCommandContext(optionArgs, HELP, (shell) =>
    isCompletionShell(shell) ? renderCompletions(shell) : undefined,
  );
  bindContext(ctx);
  const args = optionArgs.filter((argument) => argument !== "--debug");
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const name = args[0];
  if (name === undefined || name === "--as-of" || name === "--json") return runOnboarding(args, ctx);
  const command = commands.find((candidate) => candidate.name === name);
  if (!command) return ctx.fail("usage", `Unknown command: ${name ?? ""}`, `\n${HELP}`, "unknown-command");
  return command.run([...args.slice(1), ...rawArgs.slice(optionArgs.length)], ctx);
}

/**
 * The process entry: runs one command and renders an unexpected failure the same way for every caller.
 * Returns the exit code, which the executable assigns to `process.exitCode`.
 */
export async function run(rawArgs: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    return await main(rawArgs);
  } catch (error) {
    return reportCliFailure(error, rawArgs);
  }
}

export function reportCliFailure(error: unknown, rawArgs: readonly string[]): number {
  const { code, kind } = classifyError(error);
  // Only Offing and Ebb errors classify as anything but internal, and both are Errors.
  if (kind !== "internal" && error instanceof Error) return fail(kind, error.message, "", code);
  const { message, appendix } = unexpectedFailure(error, cliOptionArgs(rawArgs).includes("--debug"));
  return fail("internal", message, appendix, code);
}

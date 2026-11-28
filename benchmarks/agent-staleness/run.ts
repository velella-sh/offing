import { pathToFileURL } from "node:url";
import { runRecordedCli } from "../agent-harness/cli.js";
import { loadStalenessTasksAsync } from "./score.js";

async function main(args: readonly string[]): Promise<number> {
  if (args.includes("--agent")) {
    process.stderr.write(
      "Live --agent runs are disabled because vendor CLIs may expose host configuration or network access to task code. Use --replay-plan with captured edits or --rescore with existing results.\n",
    );
    return 2;
  }
  if (args.length === 1 && args[0] === "--list") {
    const { tasks } = await loadStalenessTasksAsync();
    for (const task of tasks) process.stdout.write(`${task.id}\t${task.category}\t${task.target}\n`);
    return 0;
  }
  return runRecordedCli(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

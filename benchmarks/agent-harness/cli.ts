import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadStalenessTasksAsync } from "../agent-staleness/score.js";
import { checkoutCommit, planSchema } from "./contract.js";
import { runRecordedExperiment } from "./replay.js";
import { withTaskSandbox, type TaskSandbox } from "./sandbox.js";
import { rescoreRecordedOutputs } from "./score.js";

export async function runRecordedCli(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      "replay-plan": { type: "string" },
      recordings: { type: "string" },
      output: { type: "string" },
      rescore: { type: "string", multiple: true },
      "static-replay": { type: "boolean" },
    },
  });
  const offingCommit = checkoutCommit();
  const { tasks } = await loadStalenessTasksAsync();
  if (values.rescore && !values["replay-plan"] && !values.output && !values.recordings && !values["static-replay"]) {
    const results = await rescoreRecordedOutputs(values.rescore, tasks, offingCommit);
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return 0;
  }
  if (!values.rescore && values["replay-plan"] && values.recordings && values.output) {
    const plan = planSchema.parse(JSON.parse(await readFile(values["replay-plan"], "utf8")));
    const recordings = values.recordings;
    const output = values.output;
    const run = (sandbox?: TaskSandbox) =>
      runRecordedExperiment({ plan, tasks, recordings, output, offingCommit, ...(sandbox ? { sandbox } : {}) });
    const outputs = values["static-replay"] ? await run() : await withTaskSandbox(run);
    const mode = values["static-replay"] ? "static replay" : "isolated replay";
    process.stdout.write(`Recorded ${outputs.length} ${mode} attempts.\n`);
    return 0;
  }
  throw new Error(
    "Use --replay-plan <file> --recordings <directory> --output <new-directory> [--static-replay], or --rescore <directory>.",
  );
}

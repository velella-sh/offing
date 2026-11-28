import { lstat, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { record } from "../../src/agent-drivers/result.js";
import { loadStalenessTasksAsync } from "../agent-staleness/score.js";
import { rescoreRecordedOutputs } from "./score.js";

const siteRoot = "docs";
const publicData = join(siteRoot, "_data");
const publicOutput = join(publicData, "agent-leaderboard.json");
const measuredRuns = "benchmarks/agent-staleness/outputs/recorded";
const fixtureRoot = "benchmarks/agent-harness/fixtures/leaderboard";

async function recordedInputs(): Promise<string[]> {
  const entries = await readdir(measuredRuns, { withFileTypes: true }).catch((error: unknown) => {
    if (record(error)?.code !== "ENOENT") throw error;
    return [];
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => join(measuredRuns, name))
    .sort();
}

async function outputPath(path: string, fixture: boolean): Promise<string> {
  const absolute = resolve(path);
  const directory = await realpath(dirname(absolute));
  const target = join(directory, basename(absolute));
  if (fixture) {
    const published = await realpath(siteRoot);
    if (directory === published || directory.startsWith(published + sep)) {
      throw new Error("Fixture leaderboards must stay outside the published docs directory.");
    }
  }
  return target;
}

async function save(path: string, bytes: string, check: boolean): Promise<void> {
  if (check) {
    if (!(await readFile(path)).equals(Buffer.from(bytes))) {
      throw new Error(`Leaderboard data does not match the fresh offline rescore: ${path}`);
    }
    return;
  }
  const staging = await mkdtemp(join(dirname(path), ".offing-leaderboard-"));
  try {
    const next = join(staging, "leaderboard.json");
    await writeFile(next, bytes, { flag: "wx" });
    await rename(next, path);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

interface Options {
  inputs: readonly string[];
  output: string;
  fixture: boolean;
  check: boolean;
}

async function generate(options: Options): Promise<void> {
  const { inputs, fixture, check } = options;
  if (inputs.length === 0)
    throw new Error("No recorded experiments found. Supply --input or commit measured outputs first.");
  const output = await outputPath(options.output, fixture);
  const { tasks } = await loadStalenessTasksAsync();
  const result = await rescoreRecordedOutputs([...inputs].sort(), tasks, undefined, fixture ? "fixture" : "recorded");
  await save(output, JSON.stringify(result, null, 2) + "\n", check);
  process.stdout.write(
    `acc-agent-leaderboard: ${check ? "verified" : "wrote"} ${fixture ? "fixture" : "recorded"} data.\n`,
  );
}

async function checkCommitted(): Promise<void> {
  await generate({
    inputs: [join(fixtureRoot, "recorded")],
    output: join(fixtureRoot, "expected.json"),
    fixture: true,
    check: true,
  });
  const inputs = await recordedInputs();
  const published = await lstat(publicOutput).catch((error: unknown) => {
    if (record(error)?.code !== "ENOENT") throw error;
    return undefined;
  });
  if (inputs.length > 0 || published) await generate({ inputs, output: publicOutput, fixture: false, check: true });
  else process.stdout.write("acc-agent-leaderboard: no measured dataset is committed yet.\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: "string", multiple: true },
      output: { type: "string" },
      fixture: { type: "boolean" },
      check: { type: "boolean" },
      "check-committed": { type: "boolean" },
    },
  });
  if (values["check-committed"]) {
    if (Object.keys(values).length !== 1) throw new Error("Pass --check-committed on its own.");
    return checkCommitted();
  }
  const fixture = values.fixture === true;
  if (fixture && (!values.input || !values.output))
    throw new Error("Fixture rescoring requires explicit --input and --output paths.");
  await generate({
    inputs: values.input ?? (await recordedInputs()),
    output: values.output ?? publicOutput,
    fixture,
    check: values.check === true,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

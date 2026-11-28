import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { sha256 } from "./evaluate.js";
import { fixEvalReport, latestFixEval } from "./site.js";

const execute = promisify(execFile);

async function readReport(path: string) {
  const text = await readFile(path, "utf8");
  const raw: unknown = JSON.parse(text);
  return fixEvalReport.parse(raw);
}

function counts(result: Awaited<ReturnType<typeof readReport>>) {
  const { selected, repositories, excluded, fixers } = result;
  return JSON.stringify({ selected, repositories, excluded, fixers });
}

async function archive(source: string, date: string, publishOnlyChanges: boolean): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error("Expected a run date in YYYY-MM-DD form.");
  const result = await readReport(join(source, "report.json"));
  const last = await latestFixEval(".").catch(() => undefined);
  if (publishOnlyChanges && last !== undefined && counts(result) === counts(await readReport(last.path))) {
    process.stdout.write("Fix evaluation metrics unchanged.\n");
    return;
  }
  const directory = resolve("benchmarks/fix-evals/results");
  await mkdir(directory, { recursive: true });
  const stage = await mkdtemp(join(directory, ".run-"));
  try {
    await writeSnapshot(source, stage, result);
    await rename(stage, join(directory, date));
  } finally {
    await rm(stage, { force: true, recursive: true });
  }
  process.stdout.write(`Recorded fix evaluation for ${date}.\n`);
}

async function writeSnapshot(source: string, target: string, result: Awaited<ReturnType<typeof readReport>>) {
  const evidence = join(target, "evidence.tar.gz");
  await execute("tar", ["--numeric-owner", "--no-xattrs", "-czf", evidence, "-C", source, "."], {
    env: { PATH: process.env.PATH, COPYFILE_DISABLE: "1" },
    timeout: 60_000,
  });
  if ((await stat(evidence)).size > 20 * 1024 * 1024)
    throw new Error("Fix evaluation evidence archive exceeds 20 MiB.");
  const evidenceSha256 = sha256(await readFile(evidence));
  await writeFile(join(target, "report.json"), `${JSON.stringify({ ...result, evidenceSha256 }, null, 2)}\n`);
  const failures = new Set(result.fixers.flatMap(({ failures }) => failures.map(({ repository }) => repository)));
  if (failures.size > 0) await mkdir(join(target, "failures"));
  for (const id of failures) {
    await copyFile(join(source, id, "evidence.json"), join(target, "failures", `${id}.json`));
  }
}

const [source, date, flag] = process.argv.slice(2);
if (source === undefined || date === undefined || (flag !== undefined && flag !== "--changed")) {
  throw new Error("Usage: archive <raw-results-directory> <YYYY-MM-DD> [--changed]");
}
await archive(resolve(source), date, flag === "--changed");

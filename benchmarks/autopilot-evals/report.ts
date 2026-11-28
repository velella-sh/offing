import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";

import { advanceRun, type AutopilotRun, startRun } from "../../src/autopilot/state.js";
import { findPackageFile, MAXIMUM_READ_BYTES, parseBoundedJson } from "../../src/package-files.js";
import { checkedProof, checkSummary, digest, type Proof } from "../../src/proof/document.js";

const caseId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
const lastFailure = z.strictObject({
  file: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,120}\.txt$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const common = { id: caseId };
const attempted = { ...common, run: z.unknown(), proof: z.unknown() };
const fixture = z.strictObject({
  source: z.literal("synthetic-fixture"),
  rows: z
    .array(
      z.discriminatedUnion("outcome", [
        z.strictObject({ ...attempted, outcome: z.literal("green") }),
        z.strictObject({ ...attempted, outcome: z.enum(["stopped-by-budget", "failed"]), lastFailure }),
        z.strictObject({ ...common, outcome: z.literal("excluded"), lastFailure }),
      ]),
    )
    .min(1),
});

type Row = z.infer<typeof fixture>["rows"][number];
type Measurements = { turns: number | null; elapsedMs: number; costUsd: number | null };

export async function readRegular(path: string): Promise<Buffer> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.size > MAXIMUM_READ_BYTES) throw new Error("Expected a bounded regular evidence file.");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== entry.size || info.dev !== entry.dev || info.ino !== entry.ino) {
      throw new Error("Evidence file changed before the read.");
    }
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== info.size) throw new Error("Evidence file size changed during the read.");
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}

async function runValidator() {
  const schemaPath = await findPackageFile("schemas/autopilot-run.v1.schema.json", import.meta.url);
  const schema: unknown = JSON.parse(await readFile(schemaPath, "utf8"));
  if (!schema || typeof schema !== "object") throw new Error("Expected the Autopilot run schema.");
  return new Ajv2020({ ownProperties: true, strictTuples: false }).compile<AutopilotRun>(schema);
}

/** Replay the recorded phases with the same transition rules as Autopilot. */
function verifyTransitions(run: AutopilotRun): void {
  const replay = startRun(run.mode);
  for (const phase of run.transitions.slice(1)) {
    if (phase === "stopped") {
      advanceRun(replay, { stop: run.stopReason ?? "" });
    } else {
      advanceRun(replay, phase);
    }
  }
  if (replay.state !== run.state) throw new Error("Last Autopilot phase disagrees with the run state.");
}

function verifyOutcome(row: Exclude<Row, { outcome: "excluded" }>, run: AutopilotRun, proof: Proof): void {
  if (run.mode === "dry-run" || (run.checkout && run.checkout.baseCommit !== proof.range.base)) {
    throw new Error("Autopilot run does not match the attempted migration proof.");
  }
  if (row.outcome === "green") {
    const commands = proof.verify.commands;
    if (
      run.state !== "done" ||
      proof.outcome !== "done" ||
      proof.verify.verdict !== "passed" ||
      !commands.some(({ status }) => status === "passed") ||
      commands.some(({ status }) => status === "not-run")
    ) {
      throw new Error("Green fixture requires a completed run with passing verification evidence.");
    }
    return;
  }
  const budgetExhausted = /^(run|turn)\.(turns|tokens|costCents|wallTimeMs)$/u.test(run.stopReason ?? "");
  if (
    run.state !== "stopped" ||
    proof.outcome !== "stopped" ||
    budgetExhausted !== (row.outcome === "stopped-by-budget")
  ) {
    throw new Error("Non-green fixture outcome disagrees with its Autopilot stop evidence.");
  }
}

function measurements(proof: Proof): Measurements {
  let turns: number | null = 0;
  for (const run of proof.agentRuns) {
    if (run.turns === null) {
      turns = null;
      break;
    }
    turns += run.turns;
    if (!Number.isSafeInteger(turns)) throw new Error("Total turns exceed the exact integer range.");
  }
  return { turns, ...proof.budget };
}

function medianOf(values: (number | null)[]) {
  const sorted = values.filter((value) => value !== null).sort((left, right) => left - right);
  const low = sorted[Math.floor((sorted.length - 1) / 2)];
  const high = sorted[Math.floor(sorted.length / 2)];
  return {
    samples: sorted.length,
    median: low === undefined || high === undefined ? null : low + (high - low) / 2,
  };
}

export async function reportAutopilotFixture(path: string) {
  const bytes = await readRegular(path);
  const document = parseBoundedJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const input = fixture.safeParse(document?.value);
  if (!input.success) throw new Error("Expected a synthetic Autopilot evaluation fixture.");
  const checkRun = await runValidator();
  const recorded: Measurements[] = [];
  const nonGreen: Array<{
    id: string;
    outcome: Exclude<Row["outcome"], "green">;
    lastFailure: z.infer<typeof lastFailure>;
  }> = [];
  const counts = { green: 0, "stopped-by-budget": 0, excluded: 0, failed: 0 };
  const ids = new Set<string>();
  for (const row of input.data.rows) {
    if (ids.has(row.id)) throw new Error(`Duplicate fixture case ${row.id}.`);
    ids.add(row.id);
    if (row.outcome !== "green") {
      const failure = await readRegular(join(dirname(path), row.lastFailure.file));
      if (digest(failure) !== row.lastFailure.sha256) throw new Error(`Last failure log hash disagrees for ${row.id}.`);
      nonGreen.push({ id: row.id, outcome: row.outcome, lastFailure: row.lastFailure });
    }
    if (row.outcome !== "excluded") {
      if (!checkRun(row.run)) throw new Error(`Invalid Autopilot run schema for ${row.id}.`);
      verifyTransitions(row.run);
      const proof = await checkedProof(row.proof);
      checkSummary(proof);
      verifyOutcome(row, row.run, proof);
      recorded.push(measurements(proof));
    }
    counts[row.outcome] += 1;
  }
  const total = input.data.rows.length;
  return {
    source: input.data.source,
    total,
    counts,
    rates: Object.fromEntries(Object.entries(counts).map(([outcome, count]) => [outcome, count / total])),
    turns: medianOf(recorded.map((metric) => metric.turns)),
    elapsedMs: medianOf(recorded.map((metric) => metric.elapsedMs)),
    costUsd: medianOf(recorded.map((metric) => metric.costUsd)),
    nonGreen,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { fixture: { type: "string" } } });
  if (!values.fixture) throw new Error("Usage: npm run autopilot-evals:report -- --fixture <file>");
  const path = resolve(values.fixture);
  const summary = await reportAutopilotFixture(path);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error: unknown) => {
    process.stderr.write(`autopilot-evals: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

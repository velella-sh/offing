import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { configureActiveData, getActiveData } from "@velella/ebb/data-source";
import { scanFleet, type FleetProgress } from "../../src/fleet/index.js";
import { githubFleetHost } from "../../src/fleet/remote.js";
import { VERSION } from "../../src/version.js";
import { captureStudy, type StudyCapture } from "./capture.js";
import { readCohort } from "./cohort.js";

export const defaultCohort = "benchmarks/state-of-eol/2027-cohort.json";

export interface StudyRow {
  rank: number;
  repository: string;
  commit: string;
  state: FleetProgress;
  capture?: StudyCapture;
}

function numeric(value: string, max: number, name: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(number) || number < 1 || number > max) {
    throw new Error(`Invalid ${name}. Expected an integer between 1 and ${max}.`);
  }
  return number;
}

async function scanInputs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      out: { type: "string" },
      cohort: { type: "string", default: defaultCohort },
      start: { type: "string", default: "1" },
      count: { type: "string", default: "1000" },
      jobs: { type: "string", default: "4" },
    },
  });
  if (!values.out) throw new Error("Pass --out <new directory> for raw scan evidence.");
  const cohort = await readCohort(values.cohort);
  const start = numeric(values.start, cohort.repositories.length, "start rank");
  const count = numeric(values.count, cohort.repositories.length, "repository count");
  const end = Math.min(start + count - 1, cohort.repositories.length);
  return {
    cohort,
    cohortPath: values.cohort,
    out: resolve(values.out),
    start,
    end,
    jobs: numeric(values.jobs, 4, "worker count"),
    asOf: cohort.retrievedAt.slice(0, 10),
  };
}

async function collect(args: string[]): Promise<void> {
  const { cohort, cohortPath, out, start, end, jobs, asOf } = await scanInputs(args);
  configureActiveData({ pinnedVersion: "bundled" });
  const { info } = await getActiveData();
  const pins = cohort.repositories.slice(start - 1, end);
  const ranks = new Map(pins.map(({ repository }, index) => [repository, start + index]));
  const pending = new Map<string, StudyCapture>();
  const plan = {
    schemaVersion: "offing.state-of-eol.scan.v1",
    cohortDigest: createHash("sha256")
      .update(await readFile(cohortPath))
      .digest("hex"),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    offing: VERSION,
    data: { version: info.version, digest: info.contentDigest },
    packageLockDigest: createHash("sha256")
      .update(await readFile("package-lock.json"))
      .digest("hex"),
    node: process.version,
    platform: process.platform,
    asOf,
    startedAt: new Date().toISOString(),
    start,
    end,
    jobs,
  };
  await mkdir(out);
  await writeFile(join(out, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
  await scanFleet(githubFleetHost(), "", {
    pins,
    jobs,
    asOf,
    observeScan: async ({ name }, commit, report) => {
      pending.set(name, await captureStudy(report, name, commit));
    },
    onProgress(state) {
      const rank = ranks.get(state.name);
      const pin = rank === undefined ? undefined : cohort.repositories[rank - 1];
      if (rank === undefined || !pin) throw new Error("Fleet returned a repository outside the requested ranks.");
      const capture = pending.get(state.name);
      pending.delete(state.name);
      const row: StudyRow = {
        rank,
        repository: pin.repository,
        commit: pin.commit,
        state,
        ...(state.status === "scanned" && capture ? { capture } : {}),
      };
      writeFileSync(join(out, `${String(rank).padStart(4, "0")}.json`), `${JSON.stringify(row)}\n`, { flag: "wx" });
      process.stderr.write(`${rank} ${pin.repository} ${state.status}\n`);
    },
  });
  await writeFile(join(out, "finished.json"), `${JSON.stringify({ finishedAt: new Date().toISOString() })}\n`, {
    flag: "wx",
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await collect(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

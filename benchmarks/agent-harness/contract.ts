import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { configureActiveData, getActiveData } from "@velella/ebb/data-source";
import { z } from "zod";
import { ebbSnapshot } from "../../src/attestation/statement.js";

export const armSchema = z.enum(["plain", "hooks", "context"]);
export type Arm = z.infer<typeof armSchema>;
export const defaultRepeats = 5;

const caseName = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const identity = z.strictObject({
  agent: caseName,
  agentVersion: z.string().trim().min(1),
  model: z.string().trim().min(1),
  settings: z.strictObject({
    reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTurns: z.number().int().positive().optional(),
  }),
});

const source = z.enum(["fixture", "recorded"]);
const pinSchema = z.strictObject({
  asOf: z.iso.date(),
  offingCommit: z.string().regex(/^[0-9a-f]{40}$/),
  ebbVersion: z.string().min(1),
  ebbDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type ScoringPin = z.infer<typeof pinSchema>;

export const planSchema = z.strictObject({
  schemaVersion: z.literal("offing.agent-replay-plan.v1"),
  identity,
  source,
  asOf: pinSchema.shape.asOf,
  taskIds: z.array(caseName).nonempty(),
  arms: z.array(armSchema).nonempty().default(["plain", "hooks", "context"]),
  repeats: z.number().int().min(1).max(100).default(defaultRepeats),
  fixture: z.enum(["demo", "gallery/nodejs"]).optional(),
});
export type ReplayPlan = z.infer<typeof planSchema>;

export const metaSchema = z.strictObject({
  schemaVersion: z.literal("offing.agent-run.v1"),
  identity,
  source,
  pin: pinSchema,
  taskId: caseName,
  arm: armSchema,
  attempt: z.number().int().positive(),
  replaySha256: sha256,
  fixture: planSchema.shape.fixture,
  status: z.enum(["completed", "failed", "blocked", "timed-out"]),
  outputSha256: sha256.nullable(),
});
export type RunMeta = z.infer<typeof metaSchema>;

export async function bundledScoringPin(offingCommit: string, asOf: string): Promise<ScoringPin> {
  configureActiveData({ pinnedVersion: "bundled" });
  const { version, digest } = ebbSnapshot(await getActiveData());
  return pinSchema.parse({ asOf, offingCommit, ebbVersion: version, ebbDigest: digest });
}

export function checkoutCommit(): string {
  execFileSync("git", [
    "diff",
    "--quiet",
    "HEAD",
    "--",
    "src",
    "benchmarks",
    "tools",
    "package.json",
    "package-lock.json",
  ]);
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

export function assertMatchingPin(expected: ScoringPin, actual: ScoringPin): void {
  if (
    actual.asOf !== expected.asOf ||
    actual.offingCommit !== expected.offingCommit ||
    actual.ebbVersion !== expected.ebbVersion ||
    actual.ebbDigest !== expected.ebbDigest
  ) {
    throw new Error(
      "Incompatible scoring pins. Expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual),
    );
  }
}

/** Read only a bounded regular file beneath the task directory. */
export async function readRecordedTarget(root: string, file: string): Promise<Buffer | undefined> {
  const path = join(root, file);
  const stat = await lstat(path).catch(() => undefined);
  if (!stat?.isFile() || stat.size > 8 * 1024 * 1024) return undefined;
  if (!(await realpath(path)).startsWith((await realpath(root)) + sep)) return undefined;
  return readFile(path);
}

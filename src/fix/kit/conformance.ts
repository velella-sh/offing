import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";

import { z } from "zod";

import { renderPatches } from "../render-patches.js";
import type { FixPlan } from "../types.js";
import { declarationSchema } from "./declaration.js";
import { fixtureFiles, writeFixture } from "./fixture.js";
import { type PlannerTarget, guardedPlan } from "./guarded.js";

type Planner = (root: string) => Promise<FixPlan>;

const execute = promisify(execFile);
const expectation = z.strictObject({
  refusals: z.array(
    z.strictObject({
      ruleId: z.string().min(1),
      path: z.string().min(1),
      line: z.number().int().positive().optional(),
      reason: z.string().min(1),
    }),
  ),
  patchSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});

async function apply(cwd: string, diff: string, options: readonly string[]): Promise<void> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
  const args = ["-c", "core.autocrlf=false", "apply", "--no-index", "--whitespace=nowarn", ...options, "-"];
  env.GIT_CEILING_DIRECTORIES = dirname(cwd);
  env.GIT_CONFIG_GLOBAL = devNull;
  env.GIT_CONFIG_NOSYSTEM = "1";
  const execution = execute("git", args, { cwd, env, timeout: 30_000 });
  execution.child.stdin?.on("error", () => {});
  execution.child.stdin?.end(diff);
  await execution;
}

async function assertTree(root: string, expected: ReadonlyMap<string, Buffer>, message: string): Promise<void> {
  if (!isDeepStrictEqual(await fixtureFiles(root, false), expected)) throw new Error(message);
}

async function loadJson(file: string): Promise<unknown> {
  if (!(await lstat(file)).isFile()) throw new Error(`Expected a regular file at ${file}`);
  return JSON.parse(await readFile(file, "utf8"));
}

async function loadTree(path: string): Promise<Map<string, Buffer>> {
  if (!(await lstat(path)).isDirectory()) throw new Error(`Expected a real fixture directory at ${path}`);
  return fixtureFiles(path, true);
}

async function checkCase(path: string, root: string, plan: Planner): Promise<void> {
  const expected = expectation.parse(await loadJson(join(path, "expect.json")));
  const before = await loadTree(join(path, "before"));
  const after = await loadTree(join(path, "after"));
  await writeFixture(root, before);
  const first = await plan(root);
  await assertTree(root, before, "Planning changed the original fixture files.");
  if (!isDeepStrictEqual(first, await plan(root))) throw new Error("The plan is not deterministic.");
  await assertTree(root, before, "Repeat planning changed the original fixture files.");
  const refusals = first.refusals.map(({ ruleId, path, line, reason }) => ({
    ruleId,
    path,
    ...(line === undefined ? {} : { line }),
    reason,
  }));
  if (!isDeepStrictEqual(refusals, expected.refusals)) {
    throw new Error(`Refusals did not match expect.json. Received: ${JSON.stringify(refusals)}`);
  }
  const diff = renderPatches(first.patches);
  if (expected.patchSha256 && createHash("sha256").update(diff).digest("hex") !== expected.patchSha256) {
    throw new Error("The patch differs from the expected byte snapshot.");
  }
  if (diff) {
    await apply(root, diff, ["--check"]);
    await apply(root, diff, []);
  }
  await assertTree(root, after, "The patched files do not match the after tree.");
  if ((await plan(root)).patches.length > 0) throw new Error("The codemod is not idempotent.");
  await assertTree(root, after, "Planning changed the patched fixture files.");
}

/** Runs sorted cases with one temporary work directory per case. */
export async function testCases(directory: string, plan: Planner): Promise<string[]> {
  if (!(await lstat(directory)).isDirectory()) throw new Error("Expected a real directory of fixture cases.");
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
  if (names.length === 0) throw new Error("At least one fixture case is required.");
  for (const name of names) {
    const root = await mkdtemp(join(tmpdir(), "offing-codemod-case-"));
    try {
      await checkCase(join(directory, name), root, plan);
    } catch (error) {
      throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  return names;
}

export function planFixture(target: PlannerTarget): Planner {
  return (root) => guardedPlan(root, target);
}

export async function testCodemod(directory: string): Promise<{ id: string; cases: string[] }> {
  const declaration = declarationSchema.parse(await loadJson(join(directory, "codemod.json")));
  const cases = await testCases(join(directory, "cases"), planFixture({ declaration }));
  return { id: declaration.id, cases };
}

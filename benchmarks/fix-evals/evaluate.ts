import { createHash } from "node:crypto";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { builtInDetectors } from "../../src/detectors/index.js";
import { compareFindings } from "../../src/diff.js";
import { scanRepository } from "../../src/engine/index.js";
import { type Fixer, planFixReport, renderPatches } from "../../src/fix/index.js";
import type { ContainerExecutor } from "../../src/test-runners/docker.js";
import { type Profile, profiles } from "../../src/test-runners/profiles.js";
import { runApprovedTest } from "../../src/test-runners/run.js";
import { applyDiff, tempSource } from "./source.js";

type Command = Parameters<typeof runApprovedTest>[0];
type Run = Awaited<ReturnType<typeof runApprovedTest>>;

export interface Input {
  id: string;
  repository: string | null;
  commit: string | null;
  profile: Profile;
}

interface Check extends Run {
  files: { stdout: string; stderr: string }[];
}

interface Checks {
  build: Check;
  test?: Check;
}

export interface Case {
  fixer: string;
  patch: { path: string; sha256: string };
  metrics: Record<(typeof metrics)[number], boolean | null>;
  checks?: Checks;
  applyError?: string;
}

export interface Evidence extends Input {
  excluded?: "no-patch" | "baseline-not-green";
  baseline?: Checks;
  cases: Case[];
}

export const metrics = [
  "deterministic",
  "applied",
  "resolved",
  "noNewFinding",
  "idempotent",
  "buildKeptGreen",
  "testsKeptGreen",
] as const;

export const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

interface Options {
  output: string;
  fixers: Fixer[];
  backend: (profile: Profile, root: string) => Promise<ContainerExecutor>;
}

async function recordFile(root: string, file: string, bytes: Buffer | string): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), bytes, { flag: "wx" });
}

async function recordCheck(
  command: Command,
  execute: ContainerExecutor,
  output: string,
  prefix: string,
  collectReports = false,
): Promise<Check> {
  const files: Check["files"] = [];
  const run = await runApprovedTest(
    command,
    async (approved, sink) => {
      const captures = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
      const capture = (channel: keyof typeof captures) => (bytes: Uint8Array) => {
        captures[channel].push(Buffer.from(bytes));
        sink[channel](bytes);
      };
      const fileBase = `${prefix}-${files.length + 1}`;
      const paths = { stdout: `${fileBase}.stdout`, stderr: `${fileBase}.stderr` };
      try {
        return await execute(
          approved,
          { signal: sink.signal, stdout: capture("stdout"), stderr: capture("stderr") },
          collectReports,
        );
      } finally {
        for (const channel of ["stdout", "stderr"] as const) {
          await recordFile(output, paths[channel], Buffer.concat(captures[channel]));
        }
        files.push(paths);
      }
    },
    120_000,
  );
  await recordFile(output, `${prefix}.v1.json`, `${JSON.stringify(run, null, 2)}\n`);
  return { ...run, files };
}

async function verify(input: Input, options: Options, root: string, prefix: string): Promise<Checks> {
  const profile = profiles[input.profile];
  const execute = await options.backend(input.profile, root);
  const build = await recordCheck(profile.build, execute, options.output, `${prefix}/build`);
  const test =
    "test" in profile ? await recordCheck(profile.test, execute, options.output, `${prefix}/test`, true) : undefined;
  return { build, ...(test === undefined ? {} : { test }) };
}

function passed(check: Check): boolean {
  return check.attempts.every((attempt) => attempt.status === "passed");
}

export const scannedAt = "2026-11-27T00:00:00.000Z";
const scan = (root: string) => scanRepository(root, builtInDetectors, { noCache: true, scannedAt });
type Scan = Awaited<ReturnType<typeof scan>>;

async function runCase(
  input: Input,
  options: Options,
  pristine: Scan,
  fixer: Fixer,
  diff: string,
  touched: Set<string>,
) {
  const repeat = await planFixReport(await scan(pristine.root), [fixer]);
  const prefix = `${input.id}/${fixer.id}`;
  const patch = { path: `${prefix}/fix.patch`, sha256: sha256(diff) };
  await recordFile(options.output, patch.path, diff);
  const deterministic = renderPatches(repeat.patches) === diff;
  return tempSource(async (temp): Promise<Case> => {
    const root = join(temp, "tree");
    await cp(pristine.root, root, { recursive: true, errorOnExist: true, force: false });
    const failure = await applyDiff(root, diff).then(
      () => null,
      (error: unknown) => String(error),
    );
    if (failure !== null) {
      await recordFile(options.output, `${prefix}/apply.stderr`, failure);
      return {
        fixer: fixer.id,
        patch,
        applyError: `${prefix}/apply.stderr`,
        metrics: {
          deterministic,
          applied: false,
          resolved: null,
          noNewFinding: null,
          idempotent: null,
          buildKeptGreen: null,
          testsKeptGreen: null,
        },
      };
    }
    const after = await scan(root);
    const { introduced, fixed } = compareFindings(pristine.findings, after.findings);
    const targets = pristine.findings.filter((finding) => touched.has(finding.location.path));
    const resolved = targets.length === 0 ? null : targets.every((target) => fixed.includes(target));
    const second = await planFixReport(after, [fixer]);
    const checks = await verify(input, options, root, prefix);
    return {
      fixer: fixer.id,
      patch,
      checks,
      metrics: {
        deterministic,
        applied: true,
        resolved,
        noNewFinding: introduced.length === 0,
        idempotent: second.patches.length === 0,
        buildKeptGreen: passed(checks.build),
        testsKeptGreen: checks.test === undefined ? null : passed(checks.test),
      },
    };
  });
}

const validationScopes: Partial<Record<Profile, RegExp>> = {
  "github-actions": /^\.github\/workflows\/[^/]+\.ya?ml$/u,
  kubernetes: /^manifests\/.*\.ya?ml$/u,
  terraform: /^[^/]+\.tf$/u,
};

/** Uses the actual scan and fix planner against separate snapshots for each fixer. */
export async function evaluate(
  input: Input,
  load: (root: string) => Promise<void>,
  options: Options,
): Promise<Evidence> {
  return tempSource(async (root) => {
    const evidence: Evidence = { ...input, cases: [] };
    await load(root);
    const before = await scan(root);
    const { patches } = await planFixReport(before, options.fixers);
    const scope = validationScopes[input.profile];
    const selected = options.fixers.flatMap((fixer) => {
      const own = patches.filter((patch) => patch.fixer === fixer.id);
      return own.length > 0 && own.every(({ path }) => scope === undefined || scope.test(path)) ? [{ fixer, own }] : [];
    });
    if (selected.length === 0) return { ...evidence, excluded: "no-patch" };

    const baseline = await verify(input, options, root, `${input.id}/baseline`);
    if (!passed(baseline.build) || (baseline.test && !passed(baseline.test))) {
      return { ...evidence, baseline, excluded: "baseline-not-green" };
    }
    for (const { fixer, own } of selected) {
      evidence.cases.push(
        await runCase(input, options, before, fixer, renderPatches(own), new Set(own.map(({ path }) => path))),
      );
    }
    return { ...evidence, baseline };
  });
}

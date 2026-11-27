import { execFile } from "node:child_process";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import type { FixPlan } from "../types.js";
import type { Declaration } from "./declaration.js";

export type PlannerTarget = { builtIn: string } | { declaration: Declaration };

const execute = promisify(execFile);
const worker = fileURLToPath(new URL("./worker.js", import.meta.url));
const report = z.object({
  patches: z.array(z.object({ fixer: z.string(), path: z.string(), diff: z.string() })),
  refusals: z.array(
    z.object({
      fixer: z.string(),
      findingId: z.string(),
      ruleId: z.string(),
      path: z.string(),
      line: z.number().optional(),
      reason: z.string(),
    }),
  ),
});

export function permissionFlag(flags: ReadonlySet<string>): string {
  return flags.has("--permission") ? "--permission" : "--experimental-permission";
}

export async function guardedPlan(root: string, target: PlannerTarget): Promise<FixPlan> {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_V8_COVERAGE;
  const standalone = isSea();
  const flag = standalone ? "--experimental-permission" : permissionFlag(process.allowedNodeEnvironmentFlags);
  const args = [flag, "--allow-fs-read=*", worker, root];
  if ("builtIn" in target) args.push(target.builtIn);
  const execution = execute(standalone ? "node" : process.execPath, args, {
    env,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
  });
  execution.child.stdin?.on("error", () => {});
  execution.child.stdin?.end("declaration" in target ? JSON.stringify(target.declaration) : undefined);
  const { stdout } = await execution;
  const { patches, refusals } = report.parse(JSON.parse(stdout));
  return {
    patches,
    refusals: refusals.map(({ line, ...refusal }) => ({ ...refusal, ...(line === undefined ? {} : { line }) })),
  };
}

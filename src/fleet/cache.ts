import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { severityValues } from "../domain.js";
import type { RollupFinding } from "../rollup.js";

export function fleetCacheKey(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function isFinding(value: unknown): value is RollupFinding {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<RollupFinding>;
  return (
    typeof entry.ruleId === "string" &&
    entry.severity !== undefined &&
    severityValues.includes(entry.severity) &&
    (entry.deadline === undefined || (typeof entry.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.deadline)))
  );
}

export async function readFleetCache(cache: string, key: string): Promise<RollupFinding[] | undefined> {
  try {
    const entries: unknown = JSON.parse(await readFile(join(cache, `${key}.json`), "utf8"));
    return Array.isArray(entries) && entries.every(isFinding) ? entries : undefined;
  } catch {
    return undefined;
  }
}

export async function writeFleetCache(cache: string, key: string, findings: readonly RollupFinding[]): Promise<void> {
  const temporary = join(cache, `${key}-${randomUUID()}.tmp`);
  await mkdir(cache, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, JSON.stringify(findings), { mode: 0o600, flag: "wx" });
    await rename(temporary, join(cache, `${key}.json`));
  } finally {
    await rm(temporary, { force: true });
  }
}

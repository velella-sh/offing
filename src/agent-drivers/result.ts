import { constants } from "node:fs";
import { open } from "node:fs/promises";

import type { AgentResult } from "./contract.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function numberOrNull(value: unknown, integer = true): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return integer && !Number.isSafeInteger(value) ? null : value;
}

function nullableMetric(value: unknown, integer = true): boolean {
  return value === null || numberOrNull(value, integer) !== null;
}

function status(value: unknown): boolean {
  return value === "completed" || value === "failed" || value === "blocked" || value === "timed-out";
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validUsage(value: unknown): boolean {
  const usage = record(value);
  return Boolean(
    usage &&
      exactKeys(usage, ["inputTokens", "outputTokens", "costUsd"]) &&
      nullableMetric(usage.inputTokens) &&
      nullableMetric(usage.outputTokens) &&
      nullableMetric(usage.costUsd, false),
  );
}

function validDriver(value: unknown): boolean {
  const driver = record(value);
  return Boolean(
    driver &&
      exactKeys(driver, ["name", "version"]) &&
      typeof driver.name === "string" &&
      driver.name.trim() &&
      (driver.version === null || (typeof driver.version === "string" && driver.version.trim())),
  );
}

function validPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !/[\\:\0]/.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git")
  );
}

export function validPaths(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(validPath) && new Set(value).size === value.length;
}

/** Read external values as data. Validate before treating them as part of the wire contract. */
function isAgentResult(value: unknown): value is AgentResult {
  const result = record(value);
  return !(
    !result ||
    !exactKeys(result, ["schemaVersion", "status", "summary", "filesTouched", "turns", "usage", "driver"]) ||
    result.schemaVersion !== "offing.agent-run.v1" ||
    !status(result.status) ||
    typeof result.summary !== "string" ||
    !validPaths(result.filesTouched) ||
    !nullableMetric(result.turns) ||
    !validUsage(result.usage) ||
    !validDriver(result.driver)
  );
}

export function checkedResult(value: unknown): AgentResult {
  if (!isAgentResult(value)) throw new Error("Invalid offing.agent-run.v1 result.");
  return value;
}

export async function readJsonFile(path: string, limit: number): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) throw new Error("Expected a bounded regular JSON file.");
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await file.read(buffer);
    return JSON.parse(buffer.toString("utf8", 0, bytesRead));
  } finally {
    await file.close();
  }
}

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { capture, npmCli } from "./npm-cli.js";

const BYTE_BUDGET = 2_000_000;
const FILE_BUDGET = 1_450;

interface PackedFile {
  path: string;
  size: number;
}

interface PackageReport {
  size: number;
  entryCount: number;
  files: PackedFile[];
}

function isPackedFile(value: unknown): value is PackedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    "size" in value &&
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0
  );
}

export function readPackageReport(output: string): PackageReport {
  const parsed: unknown = JSON.parse(output);
  const record: unknown = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  if (
    typeof record !== "object" ||
    record === null ||
    !("size" in record) ||
    typeof record.size !== "number" ||
    !Number.isSafeInteger(record.size) ||
    record.size <= 0 ||
    !("files" in record) ||
    !Array.isArray(record.files) ||
    !record.files.every(isPackedFile) ||
    !("entryCount" in record) ||
    record.entryCount !== record.files.length ||
    record.entryCount === 0
  ) {
    throw new Error("Expected one nonempty npm pack --json record with compressed size and a complete file list.");
  }
  return { size: record.size, entryCount: record.entryCount, files: record.files };
}

export function packageBudget(report: PackageReport, baseline?: PackageReport): { passed: boolean; summary: string } {
  const previous = new Map(baseline?.files.map(({ path, size }) => [path, size]));
  const largest = report.files
    .map(({ path, size }) => ({ path, bytes: size - (previous.get(path) ?? 0) }))
    .filter(({ bytes }) => bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, 5);
  return {
    passed: report.size <= BYTE_BUDGET && report.entryCount <= FILE_BUDGET,
    summary: [
      `npm tarball: ${report.size}/${BYTE_BUDGET} compressed bytes, ${report.entryCount}/${FILE_BUDGET} files.`,
      baseline === undefined ? "Largest packed files (uncompressed):" : "Largest additions (uncompressed growth):",
      ...largest.map(({ bytes, path }) => `  ${bytes} bytes  ${path}`),
    ].join("\n"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , packedFile, baselineFile] = process.argv;
  const packed = packedFile
    ? await readFile(packedFile, "utf8")
    : await capture(process.execPath, [npmCli(), "pack", "--dry-run", "--json", "--ignore-scripts"]);
  const baseline = baselineFile ? readPackageReport(await readFile(baselineFile, "utf8")) : undefined;
  const { passed, summary } = packageBudget(readPackageReport(packed), baseline);
  console.log(summary);
  if (!passed) process.exitCode = 1;
}

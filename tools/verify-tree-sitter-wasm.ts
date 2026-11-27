/**
 * Verifies the tree-sitter payloads under `src/usage/vendor/tree-sitter/` against the committed
 * `manifest.json`. The wasm files are stored as base64 text so no binary artifact is committed;
 * the payloads are decoded here only to hash them.
 *
 * Offline by design: this reads committed files and never fetches, so it can run in `npm run check`
 * and in a scanned repository. Run `node dist/tools/verify-tree-sitter-wasm.js [directory]`.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";

export const VENDOR_DIRECTORY = resolve("src/usage/vendor/tree-sitter");
export const MANIFEST_FILE = "manifest.json";

/** One upstream WebAssembly module, stored as a committed base64 payload. */
export interface TreeSitterWasmFile {
  /** Committed payload name, for example `tree-sitter-python.wasm.b64`. */
  file: string;
  /** Path of the same file inside the upstream package, for example `tree-sitter-python.wasm`. */
  upstream: string;
  /** Decoded payload size in bytes. */
  bytes: number;
  /** Lowercase hex SHA-256 of the decoded payload. */
  sha256: string;
  /** Release and license of an independently vendored grammar. */
  origin?: GrammarOrigin;
}

export interface GrammarOrigin {
  source: string;
  version: string;
  revision: string;
  license: "MIT";
  licenseFile: string;
  licenseSha256: string;
}

export interface TreeSitterWasmManifest {
  schemaVersion: string;
  package: string;
  version: string;
  /** Pinned upstream runtime tarball, also the source of files without a per-file origin. */
  source: string;
  license: string;
  encoding?: "brotli-base64";
  files: TreeSitterWasmFile[];
}

export interface VerificationResult {
  manifest: TreeSitterWasmManifest;
  /** Human-readable mismatches; empty when the payloads match the manifest. */
  problems: string[];
}

/** Decodes the committed text, including the plain base64 used by older manifests. */
export function decodePayload(encoded: string, encoding: "base64" | "brotli-base64" = "brotli-base64"): Uint8Array {
  const bytes = Buffer.from(encoded, "base64");
  return encoding === "brotli-base64" ? brotliDecompressSync(bytes) : bytes;
}

/** Deterministic text form: base64 wrapped at 120 columns with a trailing newline. */
export function encodePayload(bytes: Uint8Array): string {
  const encoded = brotliCompressSync(bytes).toString("base64");
  const lines = encoded.match(/.{1,120}/g) ?? [];
  return `${lines.join("\n")}\n`;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrigin(value: unknown): value is GrammarOrigin {
  return (
    isRecord(value) &&
    typeof value.source === "string" &&
    value.source.startsWith("https://github.com/tree-sitter/") &&
    typeof value.version === "string" &&
    typeof value.revision === "string" &&
    /^[a-f0-9]{40}$/.test(value.revision) &&
    value.license === "MIT" &&
    typeof value.licenseFile === "string" &&
    /^LICENSE-(?:go|java|csharp)$/.test(value.licenseFile) &&
    typeof value.licenseSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.licenseSha256)
  );
}

function isWasmFile(value: unknown): value is TreeSitterWasmFile {
  return (
    isRecord(value) &&
    typeof value.file === "string" &&
    value.file.endsWith(".wasm.b64") &&
    typeof value.upstream === "string" &&
    value.upstream.endsWith(".wasm") &&
    typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    (value.origin === undefined || isOrigin(value.origin))
  );
}

export async function readManifest(directory: string): Promise<TreeSitterWasmManifest> {
  const raw = JSON.parse(await readFile(join(directory, MANIFEST_FILE), "utf8")) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw.files) || raw.files.length === 0) {
    throw new Error(`${MANIFEST_FILE} must name at least one payload.`);
  }
  if (
    raw.schemaVersion !== "offing.tree-sitter-wasm.v1" ||
    raw.package !== "@vscode/tree-sitter-wasm" ||
    typeof raw.version !== "string" ||
    typeof raw.source !== "string" ||
    typeof raw.license !== "string" ||
    (raw.encoding !== undefined && raw.encoding !== "brotli-base64") ||
    !raw.files.every(isWasmFile)
  ) {
    throw new Error(`${MANIFEST_FILE} is not a valid offing.tree-sitter-wasm.v1 manifest.`);
  }
  return {
    schemaVersion: raw.schemaVersion,
    package: raw.package,
    version: raw.version,
    source: raw.source,
    license: raw.license,
    ...(raw.encoding === undefined ? {} : { encoding: raw.encoding }),
    files: raw.files,
  };
}

async function verifyLicense(directory: string, origin: GrammarOrigin): Promise<string | undefined> {
  const bytes = await readFile(join(directory, origin.licenseFile)).catch(() => undefined);
  if (!bytes) return `${origin.licenseFile}: cannot read grammar license`;
  if (sha256(bytes) !== origin.licenseSha256) return `${origin.licenseFile}: SHA-256 differs from the manifest`;
  return undefined;
}

/** Reads every payload and license and verifies the recorded size and SHA-256. */
export async function verifyVendor(directory = VENDOR_DIRECTORY): Promise<VerificationResult> {
  const manifest = await readManifest(directory);
  const problems: string[] = [];
  const expected = new Set<string>();

  for (const file of manifest.files) {
    if (expected.has(file.file)) problems.push(`${file.file}: listed more than once in ${MANIFEST_FILE}`);
    expected.add(file.file);
    let bytes: Uint8Array;
    try {
      bytes = decodePayload(await readFile(join(directory, file.file), "utf8"), manifest.encoding ?? "base64");
    } catch (error) {
      problems.push(`${file.file}: cannot read payload (${String(error)})`);
      continue;
    }
    if (bytes.byteLength !== file.bytes) {
      problems.push(`${file.file}: decoded ${bytes.byteLength} bytes, manifest records ${file.bytes}`);
      continue;
    }
    const digest = sha256(bytes);
    if (digest !== file.sha256) problems.push(`${file.file}: sha256 ${digest}, manifest records ${file.sha256}`);
    if (file.origin) {
      const problem = await verifyLicense(directory, file.origin);
      if (problem) problems.push(problem);
    }
  }

  for (const entry of await readdir(directory)) {
    if (entry.endsWith(".wasm")) {
      problems.push(`${entry}: committed WebAssembly binary; store it as ${entry}.b64 instead`);
    } else if (entry.endsWith(".wasm.b64") && !expected.has(entry)) {
      problems.push(`${entry}: payload is not listed in ${MANIFEST_FILE}`);
    }
  }

  return { manifest, problems };
}

export async function main(argv: readonly string[]): Promise<number> {
  const directory = resolve(argv[0] ?? VENDOR_DIRECTORY);
  const { manifest, problems } = await verifyVendor(directory);
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`tree-sitter vendor: ${problem}\n`);
    return 1;
  }
  process.stdout.write(
    `Verified ${manifest.files.length} tree-sitter payloads against ${MANIFEST_FILE} (${manifest.package}@${manifest.version}).\n`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    },
  );
}

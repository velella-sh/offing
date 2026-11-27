/**
 * Refreshes the Brotli/base64 tree-sitter runtime and grammars in `src/usage/vendor/tree-sitter/` from
 * an installed `@vscode/tree-sitter-wasm`, keeping the WebAssembly payloads as committed base64 text
 * so the repository contains no binary artifacts.
 *
 * Pin the package version below when refreshing. Install it first, for example:
 * `npm install --no-save --package-lock=false @vscode/tree-sitter-wasm@0.3.1`
 *
 * The committed `manifest.json` records the upstream tarball, version, and decoded SHA-256 of every
 * payload. When the pinned version is unchanged this script refuses to overwrite payloads whose bytes
 * no longer match the manifest. When the pinned version moves it records the new hashes in the manifest
 * for review, then writes the payloads and manifest together.
 *
 * Verify the committed result offline with `node dist/tools/verify-tree-sitter-wasm.js`.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MANIFEST_FILE,
  encodePayload,
  readManifest,
  sha256,
  verifyVendor,
  type GrammarOrigin,
  type TreeSitterWasmFile,
  type TreeSitterWasmManifest,
} from "./verify-tree-sitter-wasm.js";

const PINNED_VERSION = "0.3.1";
const PACKAGE_NAME = "@vscode/tree-sitter-wasm";
const MANIFEST_SCHEMA = "offing.tree-sitter-wasm.v1";
/** Upstream WebAssembly modules, stored as `<name>.b64` next to this README. */
const WASM_FILES = [
  "tree-sitter.wasm",
  "tree-sitter-javascript.wasm",
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
  "tree-sitter-python.wasm",
] as const;
/** Official release assets and licenses, staged in the directory passed to this script. */
const GRAMMARS = [
  {
    grammar: "go",
    repository: "tree-sitter-go",
    version: "v0.25.0",
    revision: "1547678a9da59885853f5f5cc8a99cc203fa2e2c",
    asset: "tree-sitter-go.wasm",
    sha256: "9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7",
    licenseSha256: "2e0110e07abef7c2548b26ec9d6969775617ca539a0dc8dbeeb14d6452c711d1",
  },
  {
    grammar: "java",
    repository: "tree-sitter-java",
    version: "v0.23.5",
    revision: "94703d5a6bed02b98e438d7cad1136c01a60ba2c",
    asset: "tree-sitter-java.wasm",
    sha256: "4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4",
    licenseSha256: "52ed137b039cd9c46409bc22e89938af911c95b157feae2d040b51e6084369a7",
  },
  {
    grammar: "csharp",
    repository: "tree-sitter-c-sharp",
    version: "v0.24.0",
    revision: "d4bbe18103c3380c6454085e589d2610938da142",
    asset: "tree-sitter-c_sharp.wasm",
    sha256: "e137386fcdfc2562a058f8048c76ab77b0663a318cb62d8026cd4d2e94944231",
    licenseSha256: "778fb7d63b8c1844da315648c02f325c4713a6f4a5d19644fd413421422776d3",
  },
] as const;

/** Text files copied from upstream; the runtime then gets the patch below. */
const TEXT_FILES = [
  { from: "tree-sitter.js", to: "tree-sitter.cjs" },
  { from: "web-tree-sitter.d.ts", to: "tree-sitter.d.ts" },
] as const;

/**
 * Upstream `addEmJs` strips only the first `*` from a C parameter type, so a `char **`
 * argument keeps a pointer star and the generated helper is invalid. Removing every star is
 * what the signature means. The patch is applied at sync time so a refresh cannot reintroduce
 * it; the rest of the runtime stays byte-for-byte upstream (`js/incomplete-sanitization`).
 */
const RUNTIME_PATCHES = [
  { from: 'jsArgs.push(jsArg.replace("*", ""));', to: 'jsArgs.push(jsArg.replace(/\\*/g, ""));' },
] as const;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const destination = join(root, "src/usage/vendor/tree-sitter");
const require = createRequire(join(root, "package.json"));

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let entry: string;
try {
  entry = require.resolve(PACKAGE_NAME);
} catch {
  fail(
    `Install ${PACKAGE_NAME}@${PINNED_VERSION} first (npm install --no-save --package-lock=false ${PACKAGE_NAME}@${PINNED_VERSION}).`,
  );
}

const packageJson = JSON.parse(readFileSync(join(dirname(entry), "..", "package.json"), "utf8")) as {
  version?: string;
};
if (packageJson.version !== PINNED_VERSION) {
  fail(`Expected ${PACKAGE_NAME}@${PINNED_VERSION}, found ${packageJson.version ?? "unknown"}.`);
}

const wasmDirectory = dirname(entry);
const previous = await readManifest(destination).catch(() => undefined);

const files: TreeSitterWasmFile[] = [];
for (const upstream of WASM_FILES) {
  const path = join(wasmDirectory, upstream);
  if (!existsSync(path)) fail(`Missing ${upstream} in ${PACKAGE_NAME}.`);
  const bytes = readFileSync(path);
  const digest = sha256(bytes);
  const recorded = previous?.files.find((file) => file.upstream === upstream);
  if (previous?.version === PINNED_VERSION && recorded && recorded.sha256 !== digest) {
    fail(
      `${upstream} changed for the pinned ${PACKAGE_NAME}@${PINNED_VERSION} (${digest}, manifest records ${recorded.sha256}). ` +
        "Review the upstream tarball before updating the manifest.",
    );
  }
  files.push({ file: `${upstream}.b64`, upstream, bytes: bytes.byteLength, sha256: digest });
}

if (previous && previous.version !== PINNED_VERSION) {
  console.log(
    `Pinned version moved from ${previous.version} to ${PINNED_VERSION}; review the new hashes in the pull request.`,
  );
}

const releaseDirectory = process.argv[2];
if (!releaseDirectory) fail("Pass the directory containing the pinned grammar release assets and LICENSE files.");
const grammars = GRAMMARS.map((pin) => stagedGrammar(pin, releaseDirectory));

mkdirSync(destination, { recursive: true });
for (const file of files) {
  writeFileSync(join(destination, file.file), encodePayload(readFileSync(join(wasmDirectory, file.upstream))));
  // Remove the binary form a previous sync may have left behind.
  rmSync(join(destination, file.upstream), { force: true });
}
for (const { file, bytes, license, licenseFile } of grammars) {
  writeFileSync(join(destination, file.file), encodePayload(bytes));
  writeFileSync(join(destination, licenseFile), license);
  files.push(file);
}
for (const file of TEXT_FILES) cpSync(join(wasmDirectory, file.from), join(destination, file.to));
cpSync(join(dirname(entry), "..", "LICENSE"), join(destination, "LICENSE"));

const runtimePath = join(destination, "tree-sitter.cjs");
let runtime = readFileSync(runtimePath, "utf8");
for (const patch of RUNTIME_PATCHES) {
  if (!runtime.includes(patch.from)) fail(`Upstream runtime no longer contains ${patch.from}; review the patch.`);
  runtime = runtime.replace(patch.from, patch.to);
}
writeFileSync(runtimePath, runtime);

const manifest: TreeSitterWasmManifest = {
  schemaVersion: MANIFEST_SCHEMA,
  package: PACKAGE_NAME,
  version: PINNED_VERSION,
  source: `https://registry.npmjs.org/${PACKAGE_NAME}/-/${PACKAGE_NAME.split("/")[1]}-${PINNED_VERSION}.tgz`,
  license: "MIT",
  encoding: "brotli-base64",
  files,
};
writeFileSync(join(destination, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

const readme = readFileSync(join(destination, "README.md"), "utf8").replace(
  /@vscode\/tree-sitter-wasm@[\d.]+/g,
  `${PACKAGE_NAME}@${PINNED_VERSION}`,
);
writeFileSync(join(destination, "README.md"), readme);

const { problems } = await verifyVendor(destination);
if (problems.length > 0) {
  for (const problem of problems) console.error(`tree-sitter vendor: ${problem}`);
  process.exit(1);
}
console.log(
  `Synced ${files.length} payloads from ${PACKAGE_NAME}@${PINNED_VERSION} into src/usage/vendor/tree-sitter.`,
);

function stagedGrammar(pin: (typeof GRAMMARS)[number], directory: string) {
  const licenseFile = `LICENSE-${pin.grammar}`;
  const bytes = readFileSync(join(directory, pin.asset));
  const license = readFileSync(join(directory, licenseFile));
  if (sha256(bytes) !== pin.sha256 || sha256(license) !== pin.licenseSha256) {
    fail(`Checksum mismatch for ${pin.repository} ${pin.version}.`);
  }
  const origin: GrammarOrigin = {
    source: `https://github.com/tree-sitter/${pin.repository}/releases/download/${pin.version}/${pin.asset}`,
    version: pin.version,
    revision: pin.revision,
    license: "MIT",
    licenseFile,
    licenseSha256: pin.licenseSha256,
  };
  const file: TreeSitterWasmFile = {
    file: `tree-sitter-${pin.grammar}.wasm.b64`,
    upstream: pin.asset,
    bytes: bytes.length,
    sha256: pin.sha256,
    origin,
  };
  return { file, bytes, license, licenseFile };
}

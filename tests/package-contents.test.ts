import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { packageBudget, readPackageReport } from "../tools/package-size-budget.js";

const execute = promisify(execFile);

/** Nested dependency manifests that scanners treat as part of this package. */
const NESTED_MANIFEST =
  /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Bun\.lock|Bun\.lockb|requirements[^/]*\.txt|go\.mod|pom\.xml)$/i;

const TREE_SITTER_VENDOR_FILES = new Set([
  "LICENSE",
  "README.md",
  "manifest.json",
  "tree-sitter.d.ts",
  "tree-sitter.cjs",
  "tree-sitter.wasm.b64",
  "tree-sitter-javascript.wasm.b64",
  "tree-sitter-python.wasm.b64",
  "tree-sitter-tsx.wasm.b64",
  "tree-sitter-typescript.wasm.b64",
]);

test("the npm tarball ships only the root package.json as a dependency manifest", async () => {
  // Ignore scripts: prepack runs `npm run check`, which would recurse into this test.
  // npm.cmd needs the platform shell on Windows (same pattern as src/guard.ts).
  const { stdout } = await execute("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  const packed = readPackageReport(stdout);
  const budget = packageBudget(packed);
  assert.ok(budget.passed, budget.summary);
  const { files } = packed;
  const nested = files.map((file) => file.path).filter((path) => path !== "package.json" && NESTED_MANIFEST.test(path));
  assert.deepEqual(nested, [], "fixture and example manifests must stay out of the published tarball");

  const paths = files.map((file) => file.path);
  assert.ok(paths.includes("examples/starters/slipway/README.md"));
  for (const path of [
    "docs/spec/predicted-eol/conformance/check.mjs",
    "docs/spec/predicted-eol/conformance/forecast-valid.json",
    "docs/spec/predicted-eol/conformance/forecast-invalid.json",
    "schemas/fleet.v1.schema.json",
    "schemas/forecast.v1.schema.json",
  ]) {
    assert.ok(paths.includes(path), `${path} must ship in the tarball`);
  }
  assert.deepEqual(
    paths.filter((path) => path.startsWith("examples/") && !path.startsWith("examples/starters/slipway/")),
    ["examples/forecast/fleet.json"],
  );
  assert.ok(
    paths.some((path) => path.endsWith("usage/vendor/tree-sitter/tree-sitter-python.wasm.b64")),
    "trimmed tree-sitter payloads must ship in the tarball",
  );
  assert.ok(
    paths.some((path) => path.endsWith("usage/vendor/tree-sitter/manifest.json")),
    "the tree-sitter source manifest must ship in the tarball",
  );
  assert.equal(
    paths.some((path) => path.includes("tree-sitter-cpp.wasm") || path.includes("tree-sitter-ruby.wasm")),
    false,
    "unused tree-sitter grammars must stay out of the tarball",
  );
  assert.equal(
    paths.some((path) => path.endsWith(".map")),
    false,
    "source maps are not needed at runtime and must stay out of the tarball",
  );
  assert.equal(
    paths.some((path) => path.includes("skills/") && path.includes("/evals/")),
    false,
    "skill eval fixtures are not needed at runtime and must stay out of the tarball",
  );
});

test("runtime dependencies omit @vscode/tree-sitter-wasm and vendor only the grammars in use", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(
    Object.hasOwn(packageJson.dependencies, "@vscode/tree-sitter-wasm"),
    false,
    "the fat grammar pack must not be a runtime dependency",
  );
  const vendor = await readdir("src/usage/vendor/tree-sitter");
  assert.deepEqual(new Set(vendor), TREE_SITTER_VENDOR_FILES);
});

test("the package budget applies both limits and reports the largest additions", () => {
  const files = Array.from({ length: 1_450 }, (_, index) => ({ path: `old-${index}`, size: 1 }));
  const baseline = { size: 2_000_000, entryCount: files.length, files };
  assert.equal(packageBudget(baseline).passed, true);
  assert.equal(packageBudget({ ...baseline, size: baseline.size + 1 }).passed, false);
  const grown = [...files, { path: "new-large-file.js", size: 123 }];
  const excess = packageBudget({ ...baseline, entryCount: grown.length, files: grown }, baseline);
  assert.equal(excess.passed, false);
  assert.match(excess.summary, /123 bytes  new-large-file\.js/);
  assert.throws(() => readPackageReport("[]"), /complete file list/);
});

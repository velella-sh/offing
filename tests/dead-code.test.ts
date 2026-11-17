import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import ts from "typescript";
import { functionMeasures, TARGETS } from "../tools/check-quality.js";

const checker = fileURLToPath(new URL("../../tools/check-dead-code.mjs", import.meta.url));
const exec = promisify(execFile);

async function fixture(t: TestContext, files: Record<string, string>, manifest: object = {}) {
  const root = await mkdtemp(join(tmpdir(), "offing-dead-code-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contents = {
    "package.json": JSON.stringify({ name: "fixture", type: "module", ...manifest }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" },
      include: ["src/**/*.ts"],
    }),
    "dead-code.json": JSON.stringify({
      entry: ["src/main.ts"],
      project: ["src/**/*.ts"],
      ignore: ["src/fixtures/**"],
      dependencyFiles: ["*.mjs"],
      dependencyReferences: {},
    }),
    ...files,
  };
  for (const [path, text] of Object.entries(contents)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

async function check(root: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    return { ...(await exec(process.execPath, [checker, root])), code: 0 };
  } catch (caught) {
    const error = caught as { code: number; stdout: string; stderr: string };
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("unused exports and disconnected files fail through the normal checker command", async (t) => {
  const root = await fixture(t, {
    "src/main.ts": 'import { used } from "./library.js"; used();',
    "src/library.ts": "export function used() {}\nexport function unused() {}",
    "src/orphan.ts": "export const orphan = 1;",
    "src/fixtures/ignored.ts": "export const ignored = 1;",
  });
  const result = await check(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unused export: src\/library\.ts: unused/);
  assert.match(result.stderr, /Unused file: src\/orphan\.ts/);
  assert.doesNotMatch(result.stderr, /ignored|library\.ts: used/u);
});

test("disconnected import cycles remain unused even when their members reference each other", async (t) => {
  const root = await fixture(t, {
    "src/main.ts": "export const entry = 1;",
    "src/a.ts": 'import { b } from "./b.js"; export const a = () => b;',
    "src/b.ts": 'import { a } from "./a.js"; export const b = () => a;',
  });
  const result = await check(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unused file: src\/a\.ts/);
  assert.match(result.stderr, /Unused file: src\/b\.ts/);
});

test("package exports, compiled CLI paths, aliases, default exports and local uses stay live", async (t) => {
  const root = await fixture(
    t,
    {
      "src/main.ts":
        'import { original as alias } from "./library.js"; import value from "./default.js"; alias(); value(); const object = { alias };',
      "src/library.ts": "export function original() {}\nexport const local = 1; original(local);",
      "src/default.ts": "export default function value() {}",
      "src/public.ts": 'export { Api as PublicApi } from "./api.js";',
      "src/api.ts": "export interface Api { value: string }",
      "src/cli.ts": "export const cli = 1;",
    },
    { exports: { ".": "./dist/src/public.js" }, bin: { fixture: "dist/src/cli.js" } },
  );
  const result = await check(root);
  assert.equal(result.code, 0, result.stderr);
});

test("dynamic imports, destructuring and an escaped namespace retain their exports", async (t) => {
  const root = await fixture(t, {
    "src/main.ts": [
      'const { first } = await import("./first.js"); first();',
      '(await import("./second.js")).second();',
      'import * as whole from "./whole.js"; const output = { ...whole };',
    ].join("\n"),
    "src/first.ts": "export function first() {}",
    "src/second.ts": "export function second() {}",
    "src/whole.ts": "export const one = 1; export const two = 2;",
  });
  const result = await check(root);
  assert.equal(result.code, 0, result.stderr);
});

test("dependencies are checked using source imports, tool imports and package script binaries", async (t) => {
  const root = await fixture(
    t,
    {
      "src/main.ts": 'import "used/subpath"; import "node:test"; import type { Value } from "@scope/types";',
      "config.mjs": 'import "plugin";',
      "node_modules/command-tool/package.json": '{"name":"command-tool","bin":{"command":"cli.js"}}',
    },
    {
      dependencies: { used: "1", "@scope/types": "1", extra: "1" },
      devDependencies: { plugin: "1", "command-tool": "1" },
      scripts: { check: "command --check" },
    },
  );
  const result = await check(root);
  assert.equal(result.code, 1);
  assert.equal(result.stderr.trim(), "Unused dependency: extra");
});

test("undeclared packages fail and malformed configuration fails visibly", async (t) => {
  const root = await fixture(t, { "src/main.ts": 'import "missing/subpath";' });
  const result = await check(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Undeclared dependency: missing/);
  await writeFile(join(root, "tsconfig.json"), "{");
  const invalid = await check(root);
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stderr, /expected/u);
});

test("the JavaScript dead-code checker meets the repository function quality limits", async () => {
  const contents = await readFile(checker, "utf8");
  const source = ts.createSourceFile(checker, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const fn of functionMeasures(source)) {
    assert.ok(fn.complexity <= TARGETS.complexity, fn.name);
    assert.ok(fn.lines <= TARGETS.functionLines, fn.name);
  }
});

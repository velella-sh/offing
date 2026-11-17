import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import tseslint from "typescript-eslint";
import type { Program } from "typescript";

interface ProjectGlob {
  isDynamicPattern(pattern: string): boolean;
  globSync(pattern: string, options: { cwd: string; expandDirectories: boolean; ignore?: string[] }): string[];
}

// The facade exposes ESLint's narrower parser type; the installed parser also returns program services.
const parser = tseslint.parser as typeof tseslint.parser & {
  parseForESLint(code: string, options: Record<string, unknown>): { services: { program?: Program } };
};

const glob = createRequire(import.meta.url)("tinyglobby") as ProjectGlob;

test("the local project glob supports brace patterns, ignore rules and directory exclusion", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-project-glob-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ["app", "lib", "ignored", "tsconfig.json"]) await mkdir(join(root, directory));
  for (const directory of ["app", "lib", "ignored"]) await writeFile(join(root, directory, "tsconfig.json"), "{}");
  assert.equal(glob.isDynamicPattern("app/tsconfig.json"), false);
  assert.equal(glob.isDynamicPattern("{app,lib}/tsconfig.json"), true);
  assert.deepEqual(glob.globSync("{app,lib}/tsconfig.json", { cwd: root, expandDirectories: false }), [
    "app/tsconfig.json",
    "lib/tsconfig.json",
  ]);
  assert.deepEqual(glob.globSync("**/tsconfig.json", { cwd: root, expandDirectories: false, ignore: ["ignored/**"] }), [
    "app/tsconfig.json",
    "lib/tsconfig.json",
  ]);
  assert.throws(() => glob.globSync("**/*", { cwd: root, expandDirectories: true }), /expandDirectories/u);
});

test("the installed typescript-eslint parser builds a type-aware program through project globs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-parser-glob-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "app"));
  const filePath = join(root, "app", "index.ts");
  const source = "export const answer: number = 42;";
  await writeFile(filePath, source);
  await writeFile(join(root, "app", "tsconfig.json"), '{"include":["*.ts"]}');
  const result = parser.parseForESLint(source, {
    filePath,
    project: ["**/tsconfig.json"],
    tsconfigRootDir: root,
  });
  assert.ok(result.services.program);
  assert.equal(result.services.program.getSourceFile(filePath)?.text, source);
});

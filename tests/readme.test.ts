import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");

function assertCurrentBrand(content: string, name: string): void {
  assert.doesNotMatch(content, /\bseaworthy\b/i, `${name} uses the retired project name`);
}

test("the README and documentation use the current project name", async () => {
  const docs = join(root, "docs");
  const files = (await readdir(docs, { recursive: true })).filter((name) => name.endsWith(".md"));
  for (const file of [join(root, "README.md"), ...files.map((name) => join(docs, name))]) {
    assertCurrentBrand(await readFile(file, "utf8"), file);
  }
});

test("the branding check rejects the retired project name", () => {
  assert.throws(() => assertCurrentBrand("# Seaworthy", "fixture.md"), /fixture.md uses the retired project name/);
});

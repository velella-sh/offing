import { readFile, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";

import { assertCurrentBrand } from "./public-brand.js";

const root = resolve(import.meta.dirname, "../..");

test("the README and documentation use the current project name", async () => {
  const docs = join(root, "docs");
  const files = (await readdir(docs, { recursive: true })).filter(
    (name) => name.endsWith(".md") && !name.startsWith("launch" + sep),
  );
  for (const file of [join(root, "README.md"), ...files.map((name) => join(docs, name))]) {
    assertCurrentBrand(await readFile(file, "utf8"), file);
  }
});

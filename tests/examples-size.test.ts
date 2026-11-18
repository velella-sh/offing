import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const root = "examples/forecast";
const snapshots = new Set(["forecast-before.txt", "forecast-after.txt"]);

test("forecast examples contain at most 20 files each, excluding forecast snapshots", async () => {
  for (const example of await readdir(root, { withFileTypes: true })) {
    if (!example.isDirectory()) continue;
    const files = await readdir(join(root, example.name), { withFileTypes: true, recursive: true });
    const count = files.filter((file) => file.isFile() && !snapshots.has(file.name)).length;
    assert.ok(count <= 20, `${example.name} contains ${count} files (maximum 20)`);
  }
});

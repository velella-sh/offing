import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { exampleRepositories } from "../benchmarks/first-run.js";
import { runCli } from "./cli-runner.js";
import { copyFixtureTree } from "./fixture-copies.js";

test("every example has a stable text forecast, including with NO_COLOR", async (t) => {
  const roots: string[] = [];
  t.after(() => Promise.all(roots.map((path) => rm(path, { recursive: true, force: true }))));
  const root = await copyFixtureTree("examples", roots);
  const outputs: string[] = [];
  for (const name of await exampleRepositories(root)) {
    const args = ["forecast", join(root, name), "--as-of", "2026-10-25", "--data-version", "bundled"];
    const result = await runCli(args, { env: { NO_COLOR: undefined } });
    assert.equal(result.code, 0, `${name}: ${result.stderr}`);
    assert.doesNotMatch(result.stdout, /\u001b/);
    if (name === "gallery/nodejs") {
      assert.deepEqual(await runCli(args, { env: { NO_COLOR: "1" } }), result);
    }
    outputs.push(`=== examples/${name} ===\n${result.stdout}`);
  }

  const directory = "tests/__snapshots__";
  const snapshot = join(directory, "forecast-examples.txt");
  if (process.env.UPDATE_GOLDEN === "1") {
    await mkdir(directory, { recursive: true });
    await writeFile(snapshot, outputs.join("\n"));
  }
  assert.equal(outputs.join("\n"), await readFile(snapshot, "utf8"));
});

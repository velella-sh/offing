import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { exampleRepositories } from "../benchmarks/first-run.js";
import { materializeExample } from "../tools/examples.js";
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

test("forecast migrations change the weather from storm to clear", async (t) => {
  const dates = {
    node: "2026-02-01",
    python: "2025-09-01",
    actions: "2026-08-01",
  };
  const weather = { before: "storm", after: "clear" };
  for (const [ecosystem, date] of Object.entries(dates)) {
    for (const [phase, expected] of Object.entries(weather)) {
      const name = `${ecosystem}-${phase}`;
      const directory = await materializeExample(`forecast/${name}`);
      t.after(() => rm(dirname(directory), { recursive: true, force: true }));
      const args = ["forecast", directory, "--as-of", date, "--months", "3", "--data-version", "bundled"];
      const result = await runCli(args, { env: { NO_COLOR: "1" } });
      assert.equal(result.code, 0, `${name}: ${result.stderr}`);
      assert.equal(result.stdout.split("\n", 1)[0], `Weather: ${expected}`, name);
    }
  }
});

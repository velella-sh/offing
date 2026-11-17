import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { RepositoryForecast } from "../src/forecast.js";
import { runCli } from "./cli-runner.js";

test("the CSS.escape coverage gap points to the dependency declaration and rules out clear weather", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-validation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await copyFile("tests/fixtures/validation/css-escape.package.json", join(root, "package.json"));
  const args = ["forecast", root, "--as-of", "2025-03-01", "--data-version", "bundled"];
  const json = await runCli([...args, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  const forecast = JSON.parse(json.stdout) as RepositoryForecast;
  assert.equal(forecast.affecting, 0);
  assert.deepEqual(forecast.noData, [
    {
      component: "coveralls",
      detector: "npm",
      reference: "pkg:npm/coveralls",
      reason: "no lifecycle rule for the package",
      location: { path: "package.json", line: 7 },
    },
  ]);
  const text = await runCli(args);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /^Weather: cloudy\n/u);
  assert.match(text.stdout, /coveralls \(pkg:npm\/coveralls\) at package\.json:7: no lifecycle rule/u);
});

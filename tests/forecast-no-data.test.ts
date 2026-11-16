import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { isIsoDate } from "@velella/ebb/registry";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { RepositoryForecast } from "../src/forecast.js";
import { runCli } from "./cli-runner.js";

test("forecast reports unclassified components and unknown npm packages with locations", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-forecast-no-data-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "workspace"));
  await mkdir(join(root, "malformed"));
  await writeFile(join(root, "malformed", "package.json"), "{");
  await writeFile(
    join(root, "workspace", "package.json"),
    '{"optionalDependencies":{"@example/workspace-unknown":"2"}}',
  );
  const args = ["forecast", root, "--as-of", "2026-10-25", "--data-version", "bundled"];

  const readForecast = async (): Promise<RepositoryForecast> => {
    const result = await runCli([...args, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const schema = JSON.parse(await readFile("schemas/forecast.v1.schema.json", "utf8"));
    const validate = new Ajv2020({ allErrors: true }).addFormat("date", isIsoDate).compile(schema);
    const forecast = JSON.parse(result.stdout) as RepositoryForecast;
    assert.ok(validate(forecast), JSON.stringify(validate.errors));
    return forecast;
  };

  assert.deepEqual((await readForecast()).noData, []);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        workspaces: ["workspace", "malformed"],
        dependencies: { "unknown-package": "1", "request-alias": "npm:request@2.88.2", "%": "1", invalid: 0 },
      },
      null,
      2,
    ),
  );
  await writeFile(join(root, "bun.lockb"), "");
  const { noData } = await readForecast();
  assert.deepEqual(
    noData.map(({ component, location }) => [component, location]),
    [
      ["@example/workspace-unknown", { path: "workspace/package.json" }],
      ["bun.lockb", { path: "bun.lockb", line: 1 }],
      ["unknown-package", { path: "package.json" }],
    ],
  );
  const text = await runCli(args, { env: { NO_COLOR: "1" } });
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /^Weather: cloudy\n/);
  assert.match(
    text.stdout,
    /^No data\n[\s\S]*unknown-package \(pkg:npm\/unknown-package\) at package\.json: no lifecycle rule/m,
  );
  assert.deepEqual(await runCli(args, { env: { NO_COLOR: undefined } }), text);
});

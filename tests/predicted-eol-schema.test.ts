import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { isIsoDate } from "@velella/ebb/registry";
import { Ajv2020 } from "ajv/dist/2020.js";

const execute = promisify(execFile);
const conformance = resolve("docs/spec/predicted-eol/conformance");
const schema = resolve("schemas/forecast.v1.schema.json");

test("the Forecast v1 schema accepts optional predictions and requires their provenance", async () => {
  const document = JSON.parse(await readFile(resolve(conformance, "forecast-valid.json"), "utf8")) as {
    predictions: Record<string, unknown>[];
  };
  const validate = new Ajv2020().addFormat("date", isIsoDate).compile(JSON.parse(await readFile(schema, "utf8")));
  const { predictions, ...confirmed } = document;
  const prediction = predictions[0];
  assert.ok(prediction);
  assert.equal(validate(confirmed), true);
  assert.equal(validate(document), true);
  assert.equal(validate({ ...confirmed, predictions: [] }), false);

  for (const patch of [
    { purl: "pkg:generic/example-runtime" },
    { date: "2030-02-30" },
    { confidence: 1.01 },
    { sources: [] },
    { sources: ["http://example.org/runtime/release-policy"] },
    { method: " " },
    { modelVersion: undefined },
    { endOfLifeDate: "2030-10-01" },
  ]) {
    assert.equal(validate({ ...confirmed, predictions: [{ ...prediction, ...patch }] }), false, JSON.stringify(patch));
  }
});

test("the standalone checker accepts the valid vector and rejects the out-of-range date", async () => {
  const checker = resolve(conformance, "check.mjs");
  const { stdout } = await execute(process.execPath, [checker, resolve(conformance, "forecast-valid.json"), schema]);
  assert.match(stdout, /Forecast v1 schema and prediction intervals passed/);
  await assert.rejects(
    execute(process.execPath, [checker, resolve(conformance, "forecast-invalid.json"), schema]),
    /predictions\[0\]\.interval must contain the modeled date/,
  );
});

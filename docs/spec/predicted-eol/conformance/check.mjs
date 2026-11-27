import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export async function checkForecast(document, schemaPath = new URL("../../../../schemas/forecast.v1.schema.json", import.meta.url)) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const validate = new Ajv2020().addFormat("date", isCalendarDate).compile(schema);
  assert(validate(document), JSON.stringify(validate.errors));
  for (const [index, { date, interval }] of (document.predictions ?? []).entries()) {
    assert(
      interval.earliest <= date && date <= interval.latest,
      `predictions[${index}].interval must contain the modeled date`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , document, schema] = process.argv;
  assert(document, "Usage: node check.mjs <document.json> [schema.json]");
  await checkForecast(JSON.parse(await readFile(document, "utf8")), schema);
  console.log("Forecast v1 schema and prediction intervals passed");
}

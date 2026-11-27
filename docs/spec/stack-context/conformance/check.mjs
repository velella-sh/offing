import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

export async function checkStackContext(document, schemaPath = new URL("../../../../schemas/stack-context.v1.schema.json", import.meta.url)) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const validate = new Ajv2020().compile(schema);
  assert(validate(document), JSON.stringify(validate.errors));
  assert(Math.ceil(JSON.stringify(document, null, 2).length / 3) <= 1_000, "Stack context exceeds 1,000 estimated tokens");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , document, schema] = process.argv;
  assert(document, "Usage: node check.mjs <document.json> [schema.json]");
  await checkStackContext(JSON.parse(await readFile(document, "utf8")), schema);
  console.log("stack-context.v1 schema and token budget passed");
}

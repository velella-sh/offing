import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import { runCli } from "./cli-runner.js";

const sitePrefix = "https://velella.sh/offing/schemas/";
const previousPrefix = "https://github.com/velella-sh/offing/schemas/";

async function publicSchemaFiles(): Promise<string[]> {
  const page = await readFile("docs/SCHEMAS.md", "utf8");
  return [...page.matchAll(/::schema-table\{data="publicSchemas\/([\w-]+)"/g)].map(
    (match) => `${match[1]}.v1.schema.json`,
  );
}

async function registerSchemas(files: readonly string[]) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const aliases = JSON.parse(await readFile("schemas/legacy-ids.json", "utf8")) as Record<string, string>;
  for (const file of files) {
    const schema = JSON.parse(await readFile(join("schemas", file), "utf8")) as { $id: string };
    assert.equal(schema.$id, sitePrefix + file);
    ajv.addSchema(schema, aliases[schema.$id]);
  }
  return { ajv, aliases };
}

test("acc-schemas: public contract IDs and cross-file references resolve, including released IDs", async () => {
  const publicFiles = await publicSchemaFiles();
  const dir = await readdir("schemas");
  const published = await Promise.all(
    dir
      .filter((file) => file.endsWith(".v1.schema.json"))
      .map(async (file) => {
        const { $id } = JSON.parse(await readFile(join("schemas", file), "utf8")) as { $id: string };
        return $id === sitePrefix + file ? file : undefined;
      }),
  );
  assert.deepEqual(publicFiles.slice().sort(), published.filter((file) => file !== undefined).sort());
  const { ajv, aliases } = await registerSchemas(publicFiles);
  for (const file of publicFiles) assert.ok(ajv.getSchema(sitePrefix + file), file);
  for (const [id, alias] of Object.entries(aliases)) {
    assert.equal(alias, id.replace(sitePrefix, previousPrefix));
    assert.ok(ajv.getSchema(id), id);
    assert.equal(ajv.getSchema(alias), ajv.getSchema(id), alias);
  }

  const oldLocation = ajv.getSchema(
    previousPrefix + "scan.v1.schema.json#/properties/findings/items/properties/location",
  );
  const newLocation = ajv.getSchema(sitePrefix + "scan.v1.schema.json#/properties/findings/items/properties/location");
  assert.ok(oldLocation && newLocation);
  const sample = { path: "Dockerfile", line: 1 };
  assert.equal(oldLocation(sample), true, JSON.stringify(oldLocation.errors));
  assert.equal(newLocation(sample), true, JSON.stringify(newLocation.errors));
});

test("acc-schemas: raw CLI recommendation and snippet reports satisfy their packaged schemas", async () => {
  const { ajv } = await registerSchemas(await publicSchemaFiles());
  const results = [
    ["recommend", ["recommend", "node", "--as-of", "2026-01-01", "--json"]],
    ["check-snippet", ["check-snippet", "--path", "Dockerfile", "--json"]],
  ] as const;
  for (const [name, args] of results) {
    const output =
      name === "check-snippet"
        ? spawnSync(process.execPath, ["dist/src/cli.js", ...args], { input: "FROM node:16\n", encoding: "utf8" })
        : await runCli(args);
    const schema = ajv.getSchema(sitePrefix + name + ".v1.schema.json");
    assert.ok(schema, name);
    assert.equal(schema(JSON.parse(output.stdout)), true, JSON.stringify(schema.errors));
  }
});

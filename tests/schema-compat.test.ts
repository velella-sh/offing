import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { assessSchemaBreaks, compareSchema, compareSchemaDirectories } from "../tools/check-schema-compat.js";

const file = "example.v1.schema.json";
const released = {
  $id: "https://example.com/old",
  type: "object",
  properties: {
    legacy: { type: "string" },
    state: { enum: ["ready", "waiting"] },
    values: { type: "array", items: { type: "integer", minimum: 0 } },
    "key/with~symbols": { type: "number" },
  },
  required: ["legacy", "state"],
};

test("optional fields, annotations, identifier moves and enum reordering are compatible", () => {
  const candidate = {
    ...released,
    $id: "https://example.com/new",
    description: "Expanded documentation.",
    properties: {
      ...released.properties,
      state: { enum: ["waiting", "ready"] },
      note: { type: "string" },
    },
    required: ["state", "legacy"],
  };
  assert.deepEqual(compareSchema(file, released, candidate), []);
});

test("detects nested constraints, removed properties, required changes and enum changes", () => {
  const candidate = {
    ...released,
    properties: {
      state: { enum: ["ready", "waiting", "new"] },
      note: { type: "string" },
      values: { type: "array", items: { type: "integer", minimum: 1 } },
      "key/with~symbols": { type: "string" },
    },
    required: ["note", "state"],
  };
  assert.deepEqual(
    compareSchema(file, released, candidate).map(({ pointer }) => pointer),
    [
      "/properties/key~1with~0symbols/type",
      "/properties/legacy",
      "/properties/state/enum",
      "/properties/values/items/minimum",
      "/required/legacy",
      "/required/note",
    ],
  );
});

test("compares packaged files, allows a new schema and reports a removed release contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "offing-schema-compat-"));
  try {
    const oldSchemas = join(root, "released");
    const newSchemas = join(root, "candidate");
    await Promise.all([mkdir(oldSchemas), mkdir(newSchemas)]);
    await Promise.all([
      writeFile(join(oldSchemas, file), JSON.stringify(released)),
      writeFile(join(newSchemas, "new.v1.schema.json"), JSON.stringify(released)),
    ]);
    assert.deepEqual(
      (await compareSchemaDirectories(oldSchemas, newSchemas)).map(({ schema, pointer, reason }) => ({
        schema,
        pointer,
        reason,
      })),
      [{ schema: file, pointer: "", reason: "released schema removed" }],
    );
    await writeFile(join(newSchemas, file), JSON.stringify(released));
    assert.deepEqual(
      (await compareSchemaDirectories(oldSchemas, newSchemas)).map(({ schema, pointer, reason }) => ({
        schema,
        pointer,
        reason,
      })),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a release notice applies only to the exact break set and requires explanatory text", () => {
  const release = "v1.2.3";
  const candidate = { ...released, properties: { ...released.properties, legacy: { type: "number" } } };
  const changes = compareSchema(file, released, candidate);
  const unlisted = assessSchemaBreaks(changes, release, {});
  assert.equal(unlisted.undocumented.length, 1);
  const fingerprint = unlisted.reported[0]?.split("fingerprint: ")[1];
  assert.ok(fingerprint);
  const notes = { [release]: { [file]: { fingerprint, notice: "Use the new numeric field." } } };
  assert.deepEqual(assessSchemaBreaks(changes, release, notes).undocumented, []);
  assert.notEqual(assessSchemaBreaks(changes, "v1.2.4", notes).undocumented.length, 0);
  const different = compareSchema(file, released, {
    ...candidate,
    properties: { ...candidate.properties, legacy: { type: "integer" } },
  });
  assert.notEqual(assessSchemaBreaks(different, release, notes).undocumented.length, 0);
  const noText = { [release]: { [file]: { fingerprint, notice: "  " } } };
  assert.notEqual(assessSchemaBreaks(changes, release, noText).undocumented.length, 0);
});

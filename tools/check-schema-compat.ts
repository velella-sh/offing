import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

const metadata = new Set([
  "$id",
  "$comment",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
]);
const namedChildren = new Set(["properties", "patternProperties", "$defs", "dependentSchemas"]);
const schemaChildren = new Set([
  "items",
  "additionalProperties",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
]);
const unordered = new Set(["enum", "type"]);
const internalFormats = new Set([
  "benchmark-result.v1.schema.json",
  "migration-review-log.v1.schema.json",
  "public-validation.v1.schema.json",
]);

type Attributes = Record<string, unknown>;

export interface SchemaBreak {
  readonly schema: string;
  readonly pointer: string;
  readonly reason: string;
  readonly fingerprint: string;
}

function record(value: unknown): value is Attributes {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function schemaBreak(schema: string, pointer: string, reason: string, before: unknown, after: unknown): SchemaBreak {
  return { schema, pointer, reason, fingerprint: hash({ before, after }) };
}

function pointerFor(pointer: string, key: string): string {
  return `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

function keysOf(before: Attributes, after: Attributes): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
}

function equivalent(keyword: string, before: unknown, after: unknown): boolean {
  if (unordered.has(keyword) && Array.isArray(before) && Array.isArray(after)) {
    return (
      before.length === after.length && before.every((value) => after.some((other) => isDeepStrictEqual(value, other)))
    );
  }
  return isDeepStrictEqual(before, after);
}

function requiredValues(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function compareRequired(schema: string, before: unknown, after: unknown, pointer: string): SchemaBreak[] {
  const oldFields = new Set(requiredValues(before));
  const newFields = new Set(requiredValues(after));
  return [...new Set([...oldFields, ...newFields])].sort().flatMap((field) => {
    if (oldFields.has(field) === newFields.has(field)) return [];
    const reason = newFields.has(field) ? "field became required" : "field is no longer guaranteed";
    return [schemaBreak(schema, pointerFor(pointer, field), reason, oldFields.has(field), newFields.has(field))];
  });
}

function compareNamedChildren(
  schema: string,
  before: Attributes,
  after: Attributes,
  pointer: string,
  keyword: string,
): SchemaBreak[] {
  return keysOf(before, after).flatMap((name) => {
    const location = pointerFor(pointer, name);
    if (!Object.hasOwn(after, name))
      return [schemaBreak(schema, location, `${keyword} entry removed`, before[name], undefined)];
    if (Object.hasOwn(before, name)) return compareSchema(schema, before[name], after[name], location);
    // A new named property or definition does not change an existing field. Patterns and
    // dependencies can also constrain fields that already existed.
    if (keyword === "properties" || keyword === "$defs") return [];
    return [schemaBreak(schema, location, `${keyword} constraint added`, undefined, after[name])];
  });
}

function compareKeyword(
  schema: string,
  keyword: string,
  before: unknown,
  after: unknown,
  pointer: string,
): SchemaBreak[] {
  if (metadata.has(keyword) || equivalent(keyword, before, after)) return [];
  if (keyword === "required") return compareRequired(schema, before, after, pointer);
  if (namedChildren.has(keyword)) {
    return compareNamedChildren(schema, record(before) ? before : {}, record(after) ? after : {}, pointer, keyword);
  }
  if (schemaChildren.has(keyword) && record(before) && record(after)) {
    return compareSchema(schema, before, after, pointer);
  }
  return [schemaBreak(schema, pointer, `${keyword} changed`, before, after)];
}

/** Detect contract shape changes, conservatively flagging changed assertions for review. */
export function compareSchema(schema: string, before: unknown, after: unknown, pointer = ""): SchemaBreak[] {
  if (isDeepStrictEqual(before, after)) return [];
  if (!record(before) || !record(after)) return [schemaBreak(schema, pointer, "schema shape changed", before, after)];
  return keysOf(before, after).flatMap((keyword) =>
    compareKeyword(schema, keyword, before[keyword], after[keyword], pointerFor(pointer, keyword)),
  );
}

async function readSchemas(directory: string): Promise<Map<string, unknown>> {
  const files = (await readdir(directory))
    .filter((file) => /\.v\d+\.schema\.json$/.test(file) && !internalFormats.has(file))
    .sort();
  if (files.length === 0) throw new Error(`No versioned schemas in ${directory}`);
  return new Map(
    await Promise.all(
      files.map(async (file) => [file, JSON.parse(await readFile(join(directory, file), "utf8")) as unknown] as const),
    ),
  );
}

export async function compareSchemaDirectories(releasedDir: string, candidateDir: string): Promise<SchemaBreak[]> {
  const [released, candidate] = await Promise.all([readSchemas(releasedDir), readSchemas(candidateDir)]);
  return [...released].flatMap(([file, schema]) =>
    candidate.has(file)
      ? compareSchema(file, schema, candidate.get(file))
      : [schemaBreak(file, "", "released schema removed", schema, undefined)],
  );
}

function bySchema(changes: readonly SchemaBreak[]): Map<string, SchemaBreak[]> {
  const groups = new Map<string, SchemaBreak[]>();
  for (const change of changes) {
    const items = groups.get(change.schema) ?? [];
    items.push(change);
    groups.set(change.schema, items);
  }
  return groups;
}

function noticeFor(notes: Attributes, release: string, schema: string, digest: string): string | undefined {
  const releaseNotes = notes[release];
  if (!record(releaseNotes)) return undefined;
  const entry = releaseNotes[schema];
  if (!record(entry) || entry.fingerprint !== digest || typeof entry.notice !== "string") return undefined;
  return entry.notice.trim() || undefined;
}

export function assessSchemaBreaks(changes: readonly SchemaBreak[], release: string, notes: Attributes) {
  const undocumented: SchemaBreak[] = [];
  const reported: string[] = [];
  for (const [schema, items] of bySchema(changes)) {
    const digest = hash(items);
    const notice = noticeFor(notes, release, schema, digest);
    if (notice === undefined) {
      undocumented.push(...items);
      reported.push(`${schema}  fingerprint: ${digest}`);
    } else {
      reported.push(`${schema}  documented for ${release}: ${notice}`);
    }
  }
  return { undocumented, reported };
}

async function main(args: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { notes: { type: "string" }, release: { type: "string" } },
  });
  const [released, candidate = "schemas"] = positionals;
  if (released === undefined || positionals.length > 2 || Boolean(values.notes) !== Boolean(values.release)) {
    console.error("Usage: check-schema-compat <released-schema-dir> [candidate-dir] [--release <tag> --notes <file>]");
    return 2;
  }
  const changes = await compareSchemaDirectories(released, candidate);
  const notes: unknown = values.notes === undefined ? {} : JSON.parse(await readFile(values.notes, "utf8"));
  if (!record(notes)) throw new Error("Expected an object containing schema deprecation notices by release.");
  const { undocumented, reported } = assessSchemaBreaks(changes, values.release ?? "", notes);
  for (const line of reported) console.error(line);
  for (const change of undocumented) console.error(`${change.schema}#${change.pointer}  ${change.reason}`);
  if (undocumented.length === 0) console.log("All breaking schema changes have matching notices.");
  return undocumented.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 2;
    },
  );
}

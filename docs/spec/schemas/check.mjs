#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const schemaBase = new URL("https://velella.sh/offing/schemas/");
const schemaName = /^[a-z][a-z0-9-]*\.v[0-9]+\.schema\.json$/;

function fileBase(dir) {
  return pathToFileURL(resolve(dir) + sep);
}

async function readJson(file) {
  if (file.protocol === "file:") return JSON.parse(await readFile(file, "utf8"));
  const response = await fetch(file, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.json();
}

async function stage(src, out) {
  const names = (await readdir(src)).filter((name) => schemaName.test(name)).sort();
  const files = await Promise.all(
    names.map(async (name) => [name, await readFile(new URL(name, src), "utf8")]),
  );
  const publicFiles = files.filter(([name, text]) => JSON.parse(text).$id === new URL(name, schemaBase).href);
  const aliases = await readJson(new URL("legacy-ids.json", src));
  await mkdir(out, { recursive: true });
  await Promise.all(publicFiles.map(([name, text]) => writeFile(new URL(name, out), text)));
  await writeFile(new URL("index.json", out), JSON.stringify({ schemas: publicFiles.map(([name]) => name), aliases }, null, 2) + "\n");
}

function hasPointer(node, hash) {
  if (!hash) return true;
  if (!hash.startsWith("#/")) return false;
  for (const token of decodeURIComponent(hash.slice(2)).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, key)) return false;
    node = node[key];
  }
  return true;
}

function checkRefs(node, owner, byId) {
  if (node === null || typeof node !== "object") return;
  if (typeof node.$ref === "string") {
    const target = new URL(node.$ref, owner);
    const hash = target.hash;
    target.hash = "";
    const schema = byId.get(target.href);
    if (!schema || !hasPointer(schema, hash)) throw new Error(`${owner}: invalid reference ${node.$ref}`);
  }
  for (const value of Object.values(node)) checkRefs(value, owner, byId);
}

function checkCatalogNames(schemas) {
  if (!Array.isArray(schemas) || schemas.length === 0 || new Set(schemas).size !== schemas.length) {
    throw new Error("Expected a nonempty schema catalog with unique filenames.");
  }
  if (!schemas.every((name) => typeof name === "string" && schemaName.test(name))) {
    throw new Error("The catalog contains an invalid schema filename.");
  }
}

async function verify(base) {
  const { schemas, aliases } = await readJson(new URL("index.json", base));
  checkCatalogNames(schemas);
  const byId = new Map(await Promise.all(schemas.map(async (name) => {
    const schema = await readJson(new URL(name, base));
    const id = new URL(name, schemaBase).href;
    if (schema.$id !== id) throw new Error(`${name}: expected $id ${id}`);
    return [id, schema];
  })));
  for (const [id, alias] of Object.entries(aliases)) {
    if (!byId.has(id) || alias !== id.replace(schemaBase.href, "https://github.com/velella-sh/offing/schemas/")) {
      throw new Error(`Invalid schema alias ${alias} for ${id}`);
    }
  }
  for (const [id, schema] of byId) checkRefs(schema, id, byId);
  console.log(`acc-schemas: ${byId.size} published IDs, aliases and schema references resolve`);
}

const { values } = parseArgs({
  options: { directory: { type: "string" }, stage: { type: "string" } },
});
const base = values.directory ? fileBase(values.directory) : schemaBase;
if (values.stage && !values.directory) throw new Error("--stage requires a local --directory");
if (values.stage) await stage(fileBase(values.stage), base);
await verify(base);

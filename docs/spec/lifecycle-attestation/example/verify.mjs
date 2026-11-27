#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { readStatement, utcDay } from "../conformance/check.mjs";

async function hashFile(path) {
  if (!(await stat(path)).isFile()) throw new Error("Expected a regular subject artifact file.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main([file, artifact, today = new Date().toISOString().slice(0, 10), ...rest]) {
  if (!file || !artifact || rest.length) throw new Error("usage: node verify.mjs <statement.json> <artifact> [YYYY-MM-DD]");
  const day = utcDay(today);
  const statement = await readStatement(file);
  const sha256 = await hashFile(artifact);
  if (!statement.subject.some((subject) => subject.digest.sha256 === sha256)) {
    throw new Error("The artifact SHA-256 does not match a statement subject.");
  }
  const { builtOn, components, noData } = statement.predicate;
  const projected = components.map(({ rules, ...component }) => ({
    ...component,
    rules: rules.map(({ ruleId, date }) => date ?
      { ruleId, date, daysLeft: utcDay(date) - day } : { ruleId }),
  }));
  const result = {
    sha256,
    builtOn,
    asOf: today,
    components: [...projected, ...noData.map((component) => ({ ...component, status: "no-data", rules: [] }))],
  };
  console.log(JSON.stringify(result, null, 2));
}

try { await main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }

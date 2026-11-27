import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

const [configPath, statePath, schemaDirectory] = process.argv.slice(2);
assert(configPath && statePath && schemaDirectory, "Usage: node check.mjs <campaign.yml> <state.json> <schemas-dir>");
const read = (file) => readFile(file, "utf8");
const date = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const isCanonicalTime = (value) => {
  const instant = new Date(value);
  return value.length === 24 && Number.isFinite(instant.getTime()) && instant.toISOString() === value;
};
const ajv = new Ajv2020({ ownProperties: true }).addFormat("date", date).addFormat("date-time", isCanonicalTime);
for (const stem of ["campaign", "campaign-state"]) {
  ajv.addSchema(JSON.parse(await read(join(schemaDirectory, `${stem}.v1.schema.json`))), stem);
}
const yaml = parseDocument(await read(configPath), { prettyErrors: false });
assert.equal(yaml.errors.length + yaml.warnings.length, 0, "Invalid YAML.");
const config = yaml.toJS({ maxAliasCount: 0 });
const state = JSON.parse(await read(statePath));
for (const [name, doc] of [["campaign", config], ["campaign-state", state]]) {
  const check = ajv.getSchema(name);
  assert(check(doc), `${name}: ${ajv.errorsText(check.errors)}`);
  assert(doc.batching.concurrency <= doc.batching.size, `${name}: concurrency exceeds batch size`);
}

assert(!state.more, "Expected the complete saved state.");
assert.equal(state.id, config.id);
assert.equal(state.asOf, config.asOf);
assert.deepEqual(state.batching, config.batching);
const selected = config.select.upgradeTarget;
if (selected && config.target) assert.deepEqual(config.target, selected);
assert.deepEqual(state.target, selected ?? config.target);
const identities = [...state.repositories, ...state.omissions].map(({ host, name }) => JSON.stringify([host, name]));
assert.equal(new Set(identities).size, identities.length, "Duplicate repository.");
for (const [index, repository] of state.repositories.entries()) {
  assert.equal(repository.batch, Math.floor(index / state.batching.size) + 1, "Incorrect batch assignment.");
  let last = "queued";
  let previous = "";
  for (const { from, to, at } of repository.transitions) {
    assert.equal(from, last, "Discontinuous repository history.");
    assert(at >= previous, "History timestamps must be nondecreasing.");
    last = to;
    previous = at;
  }
  assert.equal(repository.status, last, "Repository status does not match its history.");
}
console.log("acc-campaigns: campaign and state conform");

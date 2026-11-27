#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const schema = "offing.verify-result.v1";
const groups = ["resolved", "remaining", "introduced"];
const severity = new Set(["info", "low", "medium", "high", "critical"]);
const statuses = new Set(["not-run", "passed", "failed", "skipped"]);
const gitId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const sha256 = /^[a-f0-9]{64}$/;
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.length > 0;
const nullable = (value, check) => value === null || check(value);

function shape(value, required, optional = []) {
  return (
    object(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}

function checkIdentity(value, side) {
  assert(shape(value, ["commit", "offingVersion", "ebbDataVersion"]), `${side}: invalid scan identity shape`);
  assert(nullable(value.commit, (id) => typeof id === "string" && gitId.test(id)), `${side}: invalid commit`);
  assert(nullable(value.offingVersion, text), `${side}: invalid Offing version`);
  assert(nullable(value.ebbDataVersion, text), `${side}: invalid Ebb data version`);
}

function checkFinding(value, label) {
  assert(shape(value, ["id", "rule", "title", "severity", "path"], ["line"]), `${label}: invalid finding shape`);
  for (const key of ["id", "rule", "title", "path"]) assert(text(value[key]), `${label}: invalid finding ${key}`);
  assert(severity.has(value.severity), `${label}: invalid finding severity`);
  if (Object.hasOwn(value, "line")) assert(Number.isInteger(value.line) && value.line > 0, `${label}: invalid finding line`);
}

function orderedDistinct(values, label) {
  assert(values.every((value, index) => index === 0 || compare(values[index - 1], value) < 0), `${label}: not ordered and unique`);
}

function checkCommand(value, index) {
  const label = `commands[${index}]`;
  assert(shape(value, ["command", "purpose", "status", "exitCode", "logSha256"]), `${label}: invalid command shape`);
  assert(text(value.command) && text(value.purpose) && statuses.has(value.status), `${label}: invalid command or status`);
  if (value.status === "not-run" || value.status === "skipped") {
    assert(value.exitCode === null && value.logSha256 === null, `${label}: unexecuted command has evidence`);
  } else {
    assert(Number.isInteger(value.exitCode) && value.exitCode >= 0, `${label}: invalid exit code`);
    assert((value.status === "passed") === (value.exitCode === 0), `${label}: status disagrees with exit code`);
    assert(typeof value.logSha256 === "string" && sha256.test(value.logSha256), `${label}: invalid log hash`);
  }
}

function expectedVerdict(counts, commands) {
  return counts.remaining === 0 && counts.introduced === 0 && !commands.some(({ status }) => status === "failed")
    ? "passed"
    : "failed";
}

/** Check the schema's shape and its semantic invariants without a runtime dependency. */
export function validate(document) {
  assert(shape(document, ["schemaVersion", "before", "after", "counts", ...groups, "verdict", "commands"]), "invalid result shape");
  assert.equal(document.schemaVersion, schema, "unsupported schemaVersion");
  checkIdentity(document.before, "before");
  checkIdentity(document.after, "after");
  assert(shape(document.counts, groups), "invalid counts object");
  const ids = new Set();
  for (const group of groups) {
    const findings = document[group];
    assert(Array.isArray(findings), `${group}: expected an array`);
    assert.equal(document.counts[group], findings.length, `${group}: count mismatch`);
    for (const found of findings) {
      checkFinding(found, group);
      assert(!ids.has(found.id), `${group}: duplicate or overlapping finding id ${found.id}`);
      ids.add(found.id);
    }
    orderedDistinct(findings.map(({ id }) => id), group);
  }
  assert(Array.isArray(document.commands), "commands: expected an array");
  document.commands.forEach(checkCommand);
  orderedDistinct(document.commands.map(({ command }) => command), "commands");
  assert.equal(document.verdict, expectedVerdict(document.counts, document.commands), "verdict disagrees with findings or commands");
}

function scanIdentity(scan) {
  return {
    commit: scan.identity?.commit ?? null,
    offingVersion: scan.identity?.offingVersion ?? null,
    ebbDataVersion: scan.data?.version || null,
  };
}

function project(finding) {
  const { id, ruleId: rule, title, severity: level, location } = finding;
  return { id, rule, title, severity: level, path: location.path, ...(location.line === undefined ? {} : { line: location.line }) };
}

/** Independently rebuild the observable comparison. Execution evidence cannot be inferred from scans. */
export function compareScans(document, before, after) {
  validate(document);
  for (const scan of [before, after]) {
    assert(scan?.schemaVersion === "offing.scan.v1" && Array.isArray(scan.findings), "expected offing.scan.v1");
  }
  assert.deepEqual(document.before, scanIdentity(before), "before identity differs");
  assert.deepEqual(document.after, scanIdentity(after), "after identity differs");
  const previous = new Set(before.findings.map(({ id }) => id));
  const current = new Set(after.findings.map(({ id }) => id));
  const results = {
    resolved: before.findings.filter(({ id }) => !current.has(id)),
    remaining: after.findings.filter(({ id }) => previous.has(id)),
    introduced: after.findings.filter(({ id }) => !previous.has(id)),
  };
  const commands = new Map();
  for (const group of groups) {
    for (const finding of results[group]) {
      for (const { command, purpose } of finding.migration?.verification ?? []) {
        if (!commands.has(command)) commands.set(command, purpose);
      }
    }
    const findings = results[group].map(project).sort((left, right) => compare(left.id, right.id));
    assert.deepEqual(document[group], findings, `${group} differs from scan comparison`);
  }
  const expected = [...commands].sort(([left], [right]) => compare(left, right));
  assert.deepEqual(document.commands.map(({ command, purpose }) => [command, purpose]), expected, "commands differ from scan comparison");
}

async function main(args) {
  if (args.length !== 1 && args.length !== 3) throw new Error("Usage: node check.mjs <verify-result.json> [<before.json> <after.json>]");
  const [document, before, after] = await Promise.all(args.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  if (args.length === 3) compareScans(document, before, after);
  else validate(document);
  console.log(`acc-verify-contract: ${args.length === 3 ? "validated and rebuilt from two scans" : "valid document"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`acc-verify-contract: ${error.message}`);
    process.exitCode = 1;
  });
}

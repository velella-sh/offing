import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
const responseVersion = "offing.agent-guard.response.v1";

function readResponse(output) {
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    throw new Error("expected one JSON decision on standard output");
  }
  if (!result || Array.isArray(result) || typeof result !== "object") {
    throw new Error("response must be an object");
  }
  const { schemaVersion, decision, reason, replacement, source, ...extra } = result;
  if (schemaVersion !== responseVersion || !["allow", "warn", "block"].includes(decision)) {
    throw new Error("expected an Agent Guard v1 decision");
  }
  if (typeof reason !== "string" || !reason.trim() || reason.length > 350) {
    throw new Error("decision needs a non-empty reason of at most 350 characters");
  }
  if (replacement !== undefined && (typeof replacement !== "string" || !replacement.trim() || replacement.length > 350)) {
    throw new Error("replacement must be a non-empty string of at most 350 characters");
  }
  if (source !== undefined && (typeof source !== "string" || source.length > 1000 || !/^https?:\/\/[^/\s]+[^\s]*$/.test(source))) {
    throw new Error("source must be an absolute HTTP or HTTPS URL of at most 1000 characters");
  }
  if (Object.keys(extra).length > 0) throw new Error("unexpected fields in the response");
  return result;
}

function checkCase(target, fixture) {
  const [command, ...args] = target;
  const result = spawnSync(command, args, {
    input: JSON.stringify(fixture.request),
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1_000_000,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`process ended on ${result.signal}`);
  if (fixture.expected === null) {
    if (result.status === 0 || result.stdout.length > 0 || !result.stderr.trim()) {
      throw new Error("invalid input must exit nonzero with empty stdout and a diagnostic on stderr");
    }
    return;
  }
  if (result.status !== 0) throw new Error(`expected exit 0, received ${result.status}: ${result.stderr.trim()}`);
  const response = readResponse(result.stdout);
  for (const [field, expected] of Object.entries(fixture.expected)) {
    if (response[field] !== expected) throw new Error(`${field}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(response[field])}`);
  }
}

function runSuite(target) {
  return fixtures.flatMap((fixture) => {
    try {
      checkCase(target, fixture);
      return [];
    } catch (error) {
      return [`${fixture.id}: ${error.message}`];
    }
  });
}

const target = process.argv.slice(2);
if (target.length === 0) {
  console.error("Usage: node check.mjs <command> [arguments ...]");
  process.exitCode = 2;
} else {
  const failures = runSuite(target);
  if (failures.length === 0) console.log(`acc-guard-protocol: ${fixtures.length} cases passed`);
  else console.error(failures.join("\n"));
  process.exitCode = failures.length === 0 ? 0 : 1;
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const documentType = "https://in-toto.io/Statement/v1";
const predicateType = "https://velella.sh/offing/attestation/v1/";
const hex = /^[0-9a-f]{64}$/u;
const events = ["deprecated", "end-of-support", "end-of-life", "removed", "scheduled-end-of-life"];

const fail = (message) => { throw new Error(message); };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && /\S/u.test(value);
const digest = (value) => typeof value === "string" && value.length === 64 && hex.test(value);

function fields(recordValue, required, optional = []) {
  return record(recordValue) && required.every((key) => Object.hasOwn(recordValue, key)) &&
    Object.keys(recordValue).every((key) => required.includes(key) || optional.includes(key));
}

function https(value) {
  if (typeof value !== "string" || !/^https:\/\/[^\s]+$/u.test(value) || !URL.canParse(value)) return false;
  const { username, password } = new URL(value);
  return !username && !password;
}

export function utcDay(value) {
  if (typeof value !== "string" || value.length !== 10 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) {
    fail("expected a UTC calendar date (YYYY-MM-DD)");
  }
  const instant = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value || value < "0100-01-01") {
    fail("expected a real UTC calendar date from year 0100 through 9999");
  }
  return instant / 86_400_000;
}

function identity(value) {
  const hasPurl = Object.hasOwn(value, "purl");
  const hasName = Object.hasOwn(value, "name");
  if (hasPurl === hasName) return false;
  if (hasPurl && (typeof value.purl !== "string" || !/^pkg:[a-z][a-z0-9.+-]*\/[^\s@?#]+$(?![\s\S])/u.test(value.purl))) return false;
  if (hasName && !text(value.name)) return false;
  if (Object.hasOwn(value, "version") && (!hasPurl || !text(value.version))) return false;
  return !Object.hasOwn(value, "location") || text(value.location);
}

function subject(value) {
  return record(value) && record(value.digest) && digest(value.digest.sha256) &&
    Object.values(value.digest).every((item) => typeof item === "string" && item.length > 0) &&
    (!Object.hasOwn(value, "name") || text(value.name));
}

function ebb(value) {
  if (!fields(value, ["version", "digest"], ["signature"]) || !text(value.version) || typeof value.digest !== "string" ||
      !value.digest.startsWith("sha256:") || !digest(value.digest.slice(7))) return false;
  if (!Object.hasOwn(value, "signature")) return true;
  const signature = value.signature;
  return fields(signature, ["issuer", "identity"], ["bundleUrl"]) && Object.values(signature).every(https);
}

function rule(value, buildDay) {
  if (!fields(value, ["ruleId", "event", "sources"], ["date", "daysLeftAtBuild", "replacement"]) ||
      typeof value.ruleId !== "string" || !/^[a-z0-9][a-z0-9.-]*$(?![\s\S])/u.test(value.ruleId) ||
      !events.includes(value.event) || !Array.isArray(value.sources) || value.sources.length === 0 ||
      !value.sources.every(https) || new Set(value.sources).size !== value.sources.length ||
      (Object.hasOwn(value, "replacement") && !text(value.replacement))) fail("invalid lifecycle rule");
  if (Object.hasOwn(value, "date") !== Object.hasOwn(value, "daysLeftAtBuild")) fail("date requires daysLeftAtBuild");
  if (Object.hasOwn(value, "date") && utcDay(value.date) - buildDay !== value.daysLeftAtBuild) fail("inconsistent daysLeftAtBuild");
  return value.ruleId;
}

function observations(predicate, buildDay) {
  const identityFields = ["purl", "name", "version", "location"];
  if (!Array.isArray(predicate.components) || !Array.isArray(predicate.noData)) fail("expected components and noData arrays");
  for (const value of predicate.components) {
    if (!fields(value, ["purl", "status", "rules"], identityFields) || !identity(value) ||
        !["affected", "version-dependent", "not-affected"].includes(value.status) ||
        !Array.isArray(value.rules) || (value.status === "not-affected") !== (value.rules.length === 0)) {
      fail("invalid component");
    }
    if (new Set(value.rules.map((item) => rule(item, buildDay))).size !== value.rules.length) fail("duplicated component rule");
  }
  for (const value of predicate.noData) {
    if (!fields(value, [], identityFields) || !identity(value)) fail("invalid noData component identity");
  }
}

export function checkStatement(value) {
  if (!record(value) || value._type !== documentType || value.predicateType !== predicateType ||
      !Array.isArray(value.subject) || value.subject.length === 0 || value.subject.length > 1024 ||
      !value.subject.every(subject)) fail("invalid in-toto statement or subject digest");
  const predicate = value.predicate;
  if (!fields(predicate, ["builtOn", "offingVersion", "ebb", "input", "components", "noData"]) ||
      !text(predicate.offingVersion) || !ebb(predicate.ebb) || !["scan", "sbom"].includes(predicate.input)) {
    fail("invalid lifecycle predicate header");
  }
  observations(predicate, utcDay(predicate.builtOn));
  return value;
}

export async function readStatement(file) {
  if (!(await stat(file)).isFile()) fail("expected a regular statement file");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > 64 * 1024 * 1024) fail("statement exceeds 64 MiB");
    chunks.push(chunk);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  return checkStatement(JSON.parse(text));
}

export async function runSuite(reference) {
  const { statement, cases, artifact, today } = JSON.parse(await readFile(new URL("fixtures.json", import.meta.url), "utf8"));
  const directory = await mkdtemp(join(tmpdir(), "offing-lifecycle-conformance-"));
  try {
    const artifactPath = join(directory, "artifact.bin");
    const file = join(directory, "statement.json");
    await writeFile(artifactPath, artifact);
    for (const test of cases) {
      const value = structuredClone(statement);
      for (const { path, value: replacement } of test.replacements) {
        const field = path.at(-1);
        const parent = path.slice(0, -1).reduce((object, key) => object[key], value);
        if (replacement === undefined) delete parent[field];
        else parent[field] = replacement;
      }
      await writeFile(file, JSON.stringify(value));
      let passed = true;
      try { await readStatement(file); } catch { passed = false; }
      if (passed !== test.valid) fail(`${test.name}: unexpected checker verdict`);
      if (reference.length) {
        const child = spawnSync(reference[0], [...reference.slice(1), file, artifactPath, today], { encoding: "utf8" });
        if (child.error || child.signal || child.status !== (test.valid ? 0 : 1)) {
          fail(`${test.name}: reference verifier failure: ${child.error ?? child.stderr}`);
        }
        if (test.expectedDaysLeft !== undefined &&
            JSON.parse(child.stdout).components[0].rules[0].daysLeft !== test.expectedDaysLeft) {
          fail(`${test.name}: reference verifier returned the wrong day count`);
        }
      }
      console.log(`${test.name}: ${passed ? "valid" : "invalid"}`);
    }
    console.log(`acc-lifecycle-attestation: ${cases.length} fixtures passed${reference.length ? " with the reference verifier" : ""}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main([file, ...args]) {
  if (file === "--suite") await runSuite(args);
  else {
    if (!file || args.length) fail("usage: node check.mjs <statement.json> | --suite [reference command...]");
    const statement = await readStatement(file);
    console.log(`Lifecycle statement v1 conforms (${statement.subject.length} subject(s)).`);
  }
}

if (import.meta.main ?? (process.argv[1] && (await realpath(process.argv[1])) === (await realpath(fileURLToPath(import.meta.url))))) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

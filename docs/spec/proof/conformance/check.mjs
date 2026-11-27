import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import { Ajv2020 } from "ajv/dist/2020.js";

const schemaDirectory = fileURLToPath(new URL("../../../../schemas/", import.meta.url));
const [file, repo = process.cwd(), schemas = schemaDirectory, ...extra] = process.argv.slice(2);
const MiB = 1024 ** 2;

function requireEvidence(condition, message) {
  if (!condition) throw new Error(message);
}

async function regular(path, limit, label) {
  try {
    const entry = await lstat(path);
    requireEvidence(entry.isFile() && entry.size <= limit);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      requireEvidence(info.isFile() && info.size === entry.size && info.dev === entry.dev && info.ino === entry.ino);
      const buffer = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      requireEvidence(length === entry.size);
      return buffer.subarray(0, length);
    } finally {
      await handle.close();
    }
  } catch {
    throw new Error(label);
  }
}

function git(args, failure) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => ["PATH", "SYSTEMROOT"].includes(name.toUpperCase())),
  );
  try {
    return execFileSync("git", args, {
      cwd: repo,
      env: {
        ...inherited,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_NO_LAZY_FETCH: "1",
        GIT_ALLOW_PROTOCOL: "",
        GIT_TERMINAL_PROMPT: "0",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
      maxBuffer: 8 * MiB,
    });
  } catch {
    throw new Error(failure);
  }
}

function checkRange(proof) {
  const { base, head } = proof.range;
  requireEvidence(base === proof.verify.before.commit && head === proof.verify.after.commit, "Mismatched scan identities.");
  for (const [label, commit] of Object.entries(proof.range)) {
    const message = `Proof ${label} commit is unavailable.`;
    requireEvidence(git(["rev-parse", "--verify", "--end-of-options", commit + "^{commit}"], message).trim() === commit, message);
  }
  git(["merge-base", "--is-ancestor", base, head], "Proof base commit must be an ancestor of its head commit.");
  const statuses = git(
    ["diff-tree", "--no-commit-id", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-relative", "--no-color", "--ignore-submodules=none",
      "--name-status", "-r", "-z", base, head, "--"],
    "Cannot compare proof commit range.",
  ).split("\0").slice(0, -1).filter((_, index) => index % 2 === 0);
  const fields = new Map([["A", "added"], ["M", "changed"], ["T", "changed"], ["D", "deleted"]]);
  const stats = { added: 0, changed: 0, deleted: 0 };
  for (const status of statuses) {
    const kind = fields.get(status);
    requireEvidence(kind, "Unexpected Git path status.");
    stats[kind] += 1;
  }
  for (const key of Object.keys(stats)) requireEvidence(stats[key] === proof.diff[key], `Proof diff ${key} count disagrees.`);
}

async function checkLogs(proof, path) {
  const logs = new Map();
  for (const [runIndex, run] of proof.testRuns.entries()) {
    for (const [attemptIndex, attempt] of run.attempts.entries()) {
      for (const [channel, log] of Object.entries(attempt.logs)) {
        const label = `test run ${runIndex + 1} attempt ${attemptIndex + 1} ${channel}`;
        requireEvidence(log.tail === "", `Expected an empty log tail for ${label}.`);
        if (!logs.has(log.sha256)) logs.set(log.sha256, label);
      }
    }
  }
  for (const [index, command] of proof.verify.commands.entries()) {
    const sha = command.logSha256;
    if (sha && !logs.has(sha)) logs.set(sha, `verification command ${index + 1}`);
  }
  for (const [sha, label] of logs) {
    const log = await regular(join(dirname(path), `offing-log-${sha}.txt`), 32 * MiB, `Missing or unreadable log for ${label}.`);
    requireEvidence(createHash("sha256").update(log).digest("hex") === sha, `Log SHA-256 disagrees for ${label}.`);
  }
}

try {
  requireEvidence(file && extra.length === 0, "Usage: node check.mjs <proof.json> [repository] [schemas-dir]");
  const ajv = new Ajv2020({ ownProperties: true, strictTuples: false });
  for (const stem of ["verify-result", "test-run", "agent-run", "proof"]) {
    ajv.addSchema(JSON.parse(await readFile(join(schemas, stem + ".v1.schema.json"), "utf8")), stem);
  }
  const path = resolve(file);
  const bytes = await regular(path, 8 * MiB, "Expected a regular proof file up to 8 MiB.");
  const proof = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  const check = ajv.getSchema("proof");
  requireEvidence(check(proof), "Invalid proof schema.");
  for (const field of ["resolved", "remaining", "introduced"]) {
    requireEvidence(proof.verify.counts[field] === proof.verify[field].length, `Invalid verification ${field} count.`);
  }
  for (const [index, command] of proof.verify.commands.entries()) {
    const { status, exitCode, logSha256 } = command;
    const valid = status === "passed" ? exitCode === 0 && logSha256 !== null
      : status === "failed" ? logSha256 !== null
      : exitCode === null && logSha256 === null;
    requireEvidence(valid, `Inconsistent evidence for verification command ${index + 1}.`);
  }
  const failed = proof.verify.remaining.length || proof.verify.introduced.length || proof.verify.commands.some(({ status }) => status === "failed");
  const verdict = failed ? "failed" : "passed";
  requireEvidence(proof.verify.verdict === verdict, "Invalid verification verdict.");
  checkRange(proof);
  await checkLogs(proof, path);
  console.log("Proof verified against local Git and log evidence.");
} catch (error) {
  console.error(error instanceof SyntaxError ? "Invalid proof JSON." : error.message);
  process.exitCode = 1;
}

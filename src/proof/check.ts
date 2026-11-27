import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify, TextDecoder } from "node:util";

import { childEnvironments } from "../autopilot/limits/secrets.js";
import { parseBoundedJson } from "../package-files.js";
import {
  checkedProof,
  checkSummary,
  digest,
  invalid,
  logEvidence,
  logName,
  MAX_LOG_BYTES,
  MAX_PROOF_BYTES,
  mismatch,
  type Proof,
} from "./document.js";

const execute = promisify(execFile);
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

async function readRegular(path: string, limit: number): Promise<Buffer> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.size > limit) throw new Error("Expected a bounded regular file.");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== entry.size || info.dev !== entry.dev || info.ino !== entry.ino) {
      throw new Error("File changed before verification.");
    }
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size) throw new Error("File size changed during verification.");
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}

async function readProof(file: string): Promise<Proof> {
  const json = await readRegular(file, MAX_PROOF_BYTES)
    .then((bytes) => parseBoundedJson(utf8.decode(bytes)))
    .catch(() => undefined);
  if (!json || json.skipped) throw invalid("Expected a regular proof file with valid UTF-8 JSON up to 8 MiB.");
  return checkedProof(json.value);
}

async function git(repo: string, args: string[]): Promise<string> {
  const { tests } = childEnvironments(process.env, "replay", []);
  const result = await execute("git", args, {
    cwd: repo,
    env: {
      ...tests,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1",
      GIT_ALLOW_PROTOCOL: "",
      GIT_TERMINAL_PROMPT: "0",
    },
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  return result.stdout;
}

async function checkCommit(repo: string, label: "base" | "head", commit: string): Promise<void> {
  const actual = await git(repo, ["rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`]).catch(() => "");
  if (actual.trim() !== commit) throw mismatch(`Proof ${label} commit is unavailable in the verification repository.`);
}

function countPaths(output: string): Proof["diff"] {
  const entries = output.split("\0");
  const stats = { added: 0, changed: 0, deleted: 0 };
  for (let index = 0; index < entries.length - 1; index += 2) {
    switch (entries[index]) {
      case "A":
        stats.added += 1;
        break;
      case "M":
      case "T":
        stats.changed += 1;
        break;
      case "D":
        stats.deleted += 1;
        break;
      default:
        throw mismatch("Unexpected Git path status in the proof commit range.");
    }
  }
  return stats;
}

async function checkDiff(repo: string, { range, diff }: Proof): Promise<void> {
  await checkCommit(repo, "base", range.base);
  await checkCommit(repo, "head", range.head);
  const output = await git(repo, [
    "diff-tree",
    "--no-commit-id",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--no-relative",
    "--no-color",
    "--ignore-submodules=none",
    "--name-status",
    "-r",
    "-z",
    range.base,
    range.head,
    "--",
  ]).catch(() => {
    throw mismatch("Cannot compare the proof commit range in the verification repository.");
  });
  const actual = countPaths(output);
  for (const key of ["added", "changed", "deleted"] as const) {
    if (diff[key] !== actual[key]) throw mismatch(`Proof diff ${key} path count disagrees with Git.`);
  }
}

async function checkLogs(folder: string, proof: Proof): Promise<void> {
  const checked = new Set<string>();
  for (const { sha256, label } of logEvidence(proof)) {
    if (checked.has(sha256)) continue;
    const bytes = await readRegular(join(folder, logName(sha256)), MAX_LOG_BYTES).catch(() => undefined);
    if (!bytes) throw mismatch(`Missing or unreadable log evidence for ${label}.`);
    if (digest(bytes) !== sha256) throw mismatch(`Log SHA-256 disagrees for ${label}.`);
    checked.add(sha256);
  }
}

export async function verifyProof(file: string, repo: string): Promise<void> {
  const path = resolve(file);
  const proof = await readProof(path);
  checkSummary(proof);
  await checkDiff(repo, proof);
  await checkLogs(dirname(path), proof);
}

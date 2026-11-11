import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRollbackReadinessArgs } from "../src/commands/rollback-readiness.js";
import { runCli } from "./cli-runner.js";

test("rollback-readiness accepts one candidate and defaults the window to 30 days", () => {
  assert.deepEqual(parseRollbackReadinessArgs(["v2.0.0", "--candidate", "v1.9.0"]), {
    releaseRef: "v2.0.0",
    candidates: ["v1.9.0"],
    withinDays: 30,
    json: false,
  });
});

test("rollback-readiness preserves three ordered candidates and accepts a zero-day JSON window", () => {
  assert.deepEqual(
    parseRollbackReadinessArgs([
      "v2.0.0",
      "--candidate",
      "v1.9.0",
      "--candidate",
      "v1.8.0",
      "--candidate",
      "v1.7.0",
      "--within-days",
      "0",
      "--json",
    ]),
    { releaseRef: "v2.0.0", candidates: ["v1.9.0", "v1.8.0", "v1.7.0"], withinDays: 0, json: true },
  );
});

test("rollback-readiness dispatches valid arguments and reports that comparison is unavailable", async () => {
  const result = await runCli(["rollback-readiness", "v2.0.0", "--candidate", "v1.9.0"]);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /comparison is not yet available/);
  assert.equal(result.stdout, "");
});

const invalidCases: readonly { name: string; args: string[]; error: RegExp }[] = [
  { name: "no release ref", args: ["--candidate", "a"], error: /exactly one <release-ref>/ },
  { name: "two release refs", args: ["release", "other", "--candidate", "a"], error: /exactly one <release-ref>/ },
  { name: "zero candidates", args: ["release"], error: /one to three --candidate/ },
  {
    name: "four candidates",
    args: ["release", "--candidate", "a", "--candidate", "b", "--candidate", "c", "--candidate", "d"],
    error: /one to three --candidate/,
  },
  {
    name: "duplicate candidates",
    args: ["release", "--candidate", "a", "--candidate", "a"],
    error: /Duplicate --candidate/,
  },
  { name: "missing candidate value", args: ["release", "--candidate"], error: /--candidate/ },
  { name: "empty candidate value", args: ["release", "--candidate", ""], error: /non-empty tag/ },
  ...["1.5", "-1", "abc", "", "9007199254740992"].map((window) => ({
    name: `invalid window ${JSON.stringify(window)}`,
    args: ["release", "--candidate", "a", "--within-days", window],
    error: /--within-days/,
  })),
  {
    name: "a repeated window",
    args: ["release", "--candidate", "a", "--within-days", "1.5", "--within-days", "30"],
    error: /--within-days at most once/,
  },
  { name: "missing window value", args: ["release", "--candidate", "a", "--within-days"], error: /--within-days/ },
];

for (const { name, args, error } of invalidCases) {
  test(`rollback-readiness rejects ${name}`, async () => {
    const result = await runCli(["rollback-readiness", "--json", ...args]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, error);
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: "offing.error.v1",
      error: { code: "usage", reason: "invalid-argument", exitCode: 2, message: result.stderr.trimEnd() },
    });
  });
}

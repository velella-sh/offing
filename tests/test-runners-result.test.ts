import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";

import { Ajv2020 } from "ajv/dist/2020.js";

import { runApprovedTest } from "../src/test-runners/run.js";

const command = ["trusted-runner", "test"] as const;
const report = (tool: string) => readFile(resolve("tests/fixtures/test-runners", tool, "junit.xml"), "utf8");

const junitFixtures = [
  ["pytest", 3, 1, "tests.test_suite::test_fail", "assert 1 < 0", "tests/test_suite.py"],
  ["maven", 2, 0, "example.CheckTest::crashes", "Illegal state <example>", null],
  ["gradle", 2, 0, "example.CheckTest::fails()", "expected: <1>", null],
  ["dotnet", 2, 0, "Checks.Math::Fails", "Expected true", "Checks/Math.cs"],
  ["go", 2, 0, "example.test/fixture::TestFail", "suite_test.go:8: expected true", null],
  ["node", 2, 0, "test::red", "Expected values to be strictly equal:1 !== 2", null],
] as const;

for (const [tool, tests, skipped, name, message, file] of junitFixtures) {
  test(`summarizes ${tool} JUnit output and preserves persistent failures`, async () => {
    const content = await report(tool);
    const result = await runApprovedTest(command, async () => ({ exitCode: 1, reports: [content] }), 1000);
    const [first, retry] = result.attempts;
    assert.deepEqual(first.totals, { tests, passed: 1, failed: 1, skipped });
    assert.deepEqual(first.failures, [{ name, message, file }]);
    assert.deepEqual(retry?.failures, first.failures);
    assert.deepEqual(result.flaky, []);
  });
}

test("records SHA-256 for the full streams and identifies a recovered case", async () => {
  const firstReport = await report("pytest");
  const secondReport = firstReport.replace(/<failure[^>]*>.*?<\/failure>/, "");
  const chunk = Buffer.alloc(5000, "x");
  let attempts = 0;
  const result = await runApprovedTest(
    command,
    async (argv, { signal, stdout, stderr }) => {
      assert.deepEqual(argv, command);
      assert.equal(signal.aborted, false);
      stdout(chunk);
      stdout(Buffer.from("done"));
      stderr(Buffer.from("status"));
      attempts += 1;
      return attempts === 1 ? { exitCode: 0, reports: [firstReport] } : { exitCode: 0, reports: [secondReport] };
    },
    1000,
  );
  const [first, retry] = result.attempts;
  assert.equal(first.status, "failed");
  assert.equal(retry?.status, "passed");
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(result.flaky, first.failures);
  assert.equal(first.logs.stdout.sha256, createHash("sha256").update(chunk).update("done").digest("hex"));
  assert.equal(first.logs.stdout.tail, "x".repeat(4092) + "done");
  assert.equal(first.logs.stderr.sha256, createHash("sha256").update("status").digest("hex"));
  assert.equal(first.logs.stderr.tail, "status");
  const schema: object = JSON.parse(await readFile(resolve("schemas/test-run.v1.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...result, rawLogs: "unexpected" }), false);
});

test("uses exit status and tails when all report data cannot be parsed", async () => {
  const good = '<testsuite><testcase name="test"/></testsuite>';
  for (const reports of [undefined, [good, "<testsuite>"], ["<root/>"], Array<string>(33).fill(good)]) {
    const result = await runApprovedTest(
      command,
      async (_, { stderr }) => {
        stderr(Buffer.from("No useful XML"));
        return { exitCode: 2, ...(reports && { reports }) };
      },
      1000,
    );
    assert.equal(result.attempts[0].totals, null);
    assert.equal(result.attempts[0].exitCode, 2);
    assert.equal(result.attempts[0].logs.stderr.tail, "No useful XML");
    assert.deepEqual(result.flaky, []);
  }
});

test("combines reports and requires the same test case to pass on retry", async () => {
  const fail = "<testsuite><testcase><failure/></testcase></testsuite>";
  const other = '<testsuite><testcase name="other"/></testsuite>';
  let attempts = 0;
  const result = await runApprovedTest(
    command,
    async () => {
      attempts += 1;
      return attempts === 1 ? { exitCode: 1, reports: [fail, other] } : { exitCode: 0, reports: [other] };
    },
    1000,
  );
  assert.deepEqual(result.attempts[0].totals, { tests: 2, passed: 1, failed: 1, skipped: 0 });
  assert.deepEqual(result.attempts[0].failures, [{ name: "(unnamed test)", message: "Test failed.", file: null }]);
  assert.deepEqual(result.flaky, []);
});

test("requests executor cancellation at the deadline and never retries a timeout or a signal exit", async () => {
  const result = await runApprovedTest(
    command,
    async (_, { signal, stderr }) => {
      stderr(Buffer.from("started"));
      await setTimeout(10000, undefined, { signal });
      return { exitCode: 0 };
    },
    1,
  );
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].status, "timed-out");
  assert.equal(result.attempts[0].exitCode, null);
  assert.equal(result.attempts[0].logs.stderr.tail, "started");
  const signalExit = await runApprovedTest(command, async () => ({ exitCode: null }), 1000);
  assert.equal(signalExit.attempts.length, 1);
  assert.equal(signalExit.attempts[0].status, "failed");
  await assert.rejects(
    runApprovedTest(
      command,
      async () => {
        throw new Error("backend start failed");
      },
      1000,
    ),
    /backend start failed/,
  );
});

test("a repaired case can be flaky when other cases still fail", async () => {
  const unrepaired = '<testcase name="persistent"><failure/></testcase>';
  const failing = '<testcase name="intermittent"><failure/></testcase>';
  const repaired = '<testcase name="intermittent"/>';
  const first = `<testsuite>${unrepaired}${failing}</testsuite>`;
  const retry = `<testsuite>${unrepaired}${repaired}</testsuite>`;
  const duplicate = `<testsuite>${failing}</testsuite>`;
  for (const [retryReports, expected] of [
    [[retry], ["intermittent"]],
    [[retry, duplicate], []],
  ] as const) {
    let attempts = 0;
    const result = await runApprovedTest(
      command,
      async () => ({
        exitCode: 1,
        reports: attempts++ === 0 ? [first] : retryReports,
      }),
      1000,
    );
    assert.deepEqual(
      result.flaky.map((entry) => entry.name),
      expected,
    );
  }
});

test("requires a real positive timeout", async () => {
  await assert.rejects(
    runApprovedTest(command, async () => ({ exitCode: 0 }), 0),
    RangeError,
  );
});

test("does not retry once the caller's wall-time budget is exhausted", async () => {
  const recorded = await runApprovedTest(command, async () => ({ exitCode: 1 }), 1_000, performance.now() - 1);
  assert.equal(recorded.attempts.length, 1);
});

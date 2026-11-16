import assert from "node:assert/strict";
import { test } from "node:test";

import { installedHook } from "./agent-hooks-e2e/fixture.js";

test("the installed edit hook responds in under 200 ms at p95 with a warm cache", {
  skip: process.execArgv.includes("--experimental-test-coverage"),
}, async (t) => {
  const { run } = await installedHook(t, "claude-code");
  assert.equal(run().status, 2, "warm-up must scan and report the fixture");
  const durations = Array.from({ length: 50 }, () => {
    const start = performance.now();
    const result = run();
    const duration = performance.now() - start;
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Dockerfile:1/);
    return duration;
  }).sort((a, b) => a - b);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Infinity;
  t.diagnostic(`50 warm invocations, p95 ${p95.toFixed(1)} ms`);
  assert.ok(p95 < 200, `warm hook p95 was ${p95.toFixed(1)} ms`);
});

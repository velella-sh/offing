import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";

import { checkSnippet } from "../src/check-snippet.js";

const snippets = [
  { path: "lib/index.ts", content: "export const value = new Buffer(16);\n" },
  { path: "server.py", content: "from datetime import datetime\nnow = datetime.utcnow()\n" },
  { path: "deploy/app.yaml", content: "apiVersion: batch/v1beta1\nkind: CronJob\n" },
  { path: ".github/workflows/test.yml", content: "jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v2\n" },
  { path: "Dockerfile", content: "FROM node:16\n" },
] as const;

test("100 mixed snippet checks have a p95 under 50 ms", async (t) => {
  const durations: number[] = [];
  for (let repeat = 0; repeat < 20; repeat += 1) {
    for (const snippet of snippets) {
      const started = performance.now();
      const result = await checkSnippet(snippet);
      durations.push(performance.now() - started);
      assert.ok(result.findings.length, snippet.path);
    }
  }
  const p95 = durations.sort((a, b) => a - b)[94] ?? Infinity;
  t.diagnostic(`p95: ${p95.toFixed(2)} ms`);
  assert.ok(p95 < 50, `p95 was ${p95.toFixed(2)} ms`);
});

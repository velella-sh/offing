import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";

import { installedHook, type StableHost } from "./fixture.js";

const cases = [
  { host: "claude-code", status: 2, channel: "stderr" },
  { host: "codex", status: 0, channel: "stdout" },
  { host: "cursor", status: 0, channel: "stderr" },
] as const satisfies readonly { host: StableHost; status: number; channel: "stdout" | "stderr" }[];

for (const { host, status, channel } of cases) {
  test(`installed ${host} hook replays an edit and allows an edit with no findings`, async (t) => {
    const hook = await installedHook(t, host);
    const affected = hook.run();
    assert.equal(affected.status, status, affected.stderr);
    assert.match(affected[channel], /Node\.js image release lines.*end-of-life.*Dockerfile:1/s);
    assert.match(affected[channel], /node:22/);
    assert.equal(affected[channel === "stdout" ? "stderr" : "stdout"], "");
    if (host === "codex") {
      const output = JSON.parse(affected.stdout);
      assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
      assert.match(output.hookSpecificOutput.additionalContext, /Dockerfile:1/);
    }

    await writeFile(hook.dockerfile, "FROM node:22\n");
    const supported = hook.run();
    assert.deepEqual([supported.status, supported.stdout, supported.stderr], [0, "", ""]);
  });
}

test("an unavailable pinned bundle allows the edit and emits one host-facing warning", async (t) => {
  for (const { host } of cases) {
    const { run } = await installedHook(t, host);
    const result = run({ OFFING_DATA_VERSION: "2999.01.01" });
    assert.equal(result.status, 0, result.stderr);
    const wire = host === "cursor" ? result.stderr : result.stdout;
    const warning = host === "cursor" ? wire.trim() : JSON.parse(wire).hookSpecificOutput.additionalContext;
    assert.equal(warning, "Offing warning: lifecycle data is unavailable; this edit was not checked.");
    assert.equal(wire.trim().split("\n").length, 1);
    assert.equal(host === "cursor" ? result.stdout : result.stderr, "");
  }
});

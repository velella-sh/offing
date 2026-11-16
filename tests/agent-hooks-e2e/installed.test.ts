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

for (const { host } of cases) {
  test(`installed ${host} pre-write hook blocks new Buffer and passes its replacement`, async (t) => {
    const hook = await installedHook(t, host);
    const codex = host === "codex";
    const run = (code: string, path = "test.js") =>
      codex
        ? hook.beforeWrite("apply_patch", {
            command: `*** Begin Patch\n*** Add File: ${path}\n+${code}\n*** End Patch`,
          })
        : hook.beforeWrite("Write", { file_path: path, content: code });

    const blocked = run("const value = new Buffer(9);");
    if (host === "cursor") {
      assert.equal(blocked.status, 0, blocked.stderr);
      const decision = JSON.parse(blocked.stdout);
      assert.equal(decision.permission, "deny");
      assert.match(decision.agent_message, /test\.js:1[\s\S]*Buffer\.alloc/);
    } else {
      assert.equal(blocked.status, 2, blocked.stderr);
      assert.match(blocked.stderr, /test\.js:1[\s\S]*Buffer\.alloc/);
    }
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    assert.equal(existsSync(join(hook.root, "test.js")), false);
    const clean = run("const value = Buffer.alloc(9);");
    assert.deepEqual([clean.status, clean.stdout, clean.stderr], [0, "", ""]);
    const outside = run("const value = new Buffer(9);", "../outside.js");
    assert.deepEqual([outside.status, outside.stdout, outside.stderr], [0, "", ""]);
  });
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

test("both installed host hooks replay five task pairs with identical prompts and per-attempt metadata", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "offing-guard-eval-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await promisify(execFile)(process.execPath, ["dist/benchmarks/agent-guardrail/run.js", "--output-dir", directory], {
    env: { ...process.env, OFFING_DATA_VERSION: "bundled" },
  });

  for (const host of ["codex", "cursor"]) {
    const { attempts } = JSON.parse(await readFile(join(directory, `replay-${host}.json`), "utf8")) as {
      attempts: {
        arm: string;
        prompt: string;
        startedAt: string;
        task: { id: string };
        agent: { host: string; model: string; version: string; offingVersion: string };
        observation: { content: string | null; deniedRequestedEdit: boolean; failed: boolean };
        hooks: unknown[];
      }[];
    };
    assert.equal(attempts.length, 10);
    for (let index = 0; index < attempts.length; index += 2) {
      const baseline = attempts[index];
      const guarded = attempts[index + 1];
      assert.ok(baseline && guarded);
      assert.deepEqual([baseline.arm, guarded.arm], ["baseline", "guardrail"]);
      assert.equal(baseline.task.id, guarded.task.id);
      assert.equal(baseline.prompt, guarded.prompt);
      assert.equal(baseline.hooks.length, 0);
      assert.equal(guarded.hooks.length, 1);
      for (const attempt of [baseline, guarded]) {
        assert.equal(attempt.agent.host, host);
        assert.equal(attempt.agent.model, "scripted-replay");
        assert.ok(attempt.agent.version && attempt.agent.offingVersion && Date.parse(attempt.startedAt));
        assert.equal(attempt.observation.failed, false);
      }
    }
    assert.equal(attempts[7]?.observation.deniedRequestedEdit, true);
    assert.equal(attempts[7]?.observation.content, null);
    assert.equal(attempts[9]?.observation.deniedRequestedEdit, false);
    assert.ok(attempts[9]?.observation.content);
  }
});

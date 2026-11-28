import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { planSchema } from "../benchmarks/agent-harness/contract.js";
import { runRecordedExperiment } from "../benchmarks/agent-harness/replay.js";
import { withTaskSandbox } from "../benchmarks/agent-harness/sandbox.js";

test("the legacy benchmark entry point refuses to start an unisolated live agent", () => {
  const result = spawnSync(process.execPath, ["dist/benchmarks/agent-staleness/run.js", "--agent", "codex"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Live --agent runs are disabled.*Use --replay-plan/);
});

const generatedProbe = `
  import assert from "node:assert/strict";
  import { readFile, writeFile } from "node:fs/promises";
  import { createConnection } from "node:net";
  import { homedir, networkInterfaces } from "node:os";
  import { join } from "node:path";
  assert.equal(process.env.CODEX_HOME, undefined);
  assert.equal(homedir(), "/tmp");
  await assert.rejects(readFile(process.argv[2]), { code: "ENOENT" });
  await assert.rejects(readFile(join(homedir(), ".codex/config.toml")), { code: "ENOENT" });
  assert.ok(Object.values(networkInterfaces()).flat().every((item) => item.internal));
  await assert.rejects(new Promise((resolve, reject) => {
    const socket = createConnection({ host: "192.0.2.1", port: 443 });
    socket.once("connect", () => { socket.destroy(); resolve(); });
    socket.once("error", reject);
    socket.setTimeout(1_000, () => socket.destroy(new Error("Connection timed out")));
  }), { code: "ENETUNREACH" });
  assert.equal((await readFile(".nvmrc", "utf8")).trim(), "20");
  assert.match(await readFile("AGENTS.md", "utf8"), /Offing/);
  assert.match(await readFile(".codex/hooks.json", "utf8"), /offing hook codex/);
  assert.match(await readFile("../prompt.md", "utf8"), /Task input marker/);
  await assert.rejects(readFile("prior-attempt"), { code: "ENOENT" });
  await writeFile("prior-attempt", "temporary marker");
`;

test("acc-agent-leaderboard: generated fixture code sees the task inputs inside a fresh disconnected container", async (t) => {
  if (process.env.OFFING_AGENT_LEADERBOARD_DOCKER !== "1")
    return t.skip("Set OFFING_AGENT_LEADERBOARD_DOCKER=1 for Docker acceptance.");
  const root = await mkdtemp(join(tmpdir(), "offing-agent-sandbox-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, ".codex");
  const marker = join(config, "config.toml");
  await mkdir(config);
  await writeFile(marker, 'synthetic = "host config marker"');
  assert.match(await readFile(marker, "utf8"), /host config marker/);
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = config;
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  });

  const plan = planSchema.parse({
    schemaVersion: "offing.agent-replay-plan.v1",
    identity: { agent: "codex", agentVersion: "fixture", model: "fixture", settings: {} },
    source: "fixture",
    asOf: "2026-11-28",
    taskIds: ["boundary"],
    fixture: "gallery/nodejs",
    arms: ["hooks"],
    repeats: 2,
  });
  const task = { id: "boundary", category: "fixture", target: "src/probe.mjs", prompt: "Task input marker" };
  const recordings = join(root, "input");
  const folder = join(recordings, "hooks", task.id);
  await mkdir(folder, { recursive: true });
  for (const index of [1, 2]) {
    await writeFile(
      join(folder, `${index}.json`),
      JSON.stringify({
        schemaVersion: "offing.agent-replay.v1",
        turns: [{ [task.target]: generatedProbe }],
      }),
    );
  }
  const output = join(root, "output");
  const rows = await withTaskSandbox((run) =>
    runRecordedExperiment({
      plan,
      tasks: [task],
      recordings,
      output,
      offingCommit: "a".repeat(40),
      sandbox: (stage, command) =>
        run(stage, [
          "sh",
          "-ec",
          'marker="$1"; shift; "$@"; cd checkout; node src/probe.mjs "$marker"',
          "sh",
          marker,
          ...command,
        ]),
    }),
  );
  assert.deepEqual(
    rows.map(({ status, source }) => [status, source]),
    [
      ["completed", "fixture"],
      ["completed", "fixture"],
    ],
  );
  for (const index of [1, 2]) {
    const attempt = join(output, "hooks", task.id, String(index));
    assert.equal(await readFile(join(attempt, task.target), "utf8"), generatedProbe);
    await assert.rejects(readFile(join(attempt, "prior-attempt")), { code: "ENOENT" });
  }
});

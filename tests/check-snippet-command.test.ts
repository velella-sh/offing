import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";

import { readStream, snippetPathFrom } from "../src/commands/check-snippet.js";
import type { CommandContext } from "../src/commands/types.js";

function recordingContext(): { ctx: CommandContext; failures: string[] } {
  const failures: string[] = [];
  const ctx = {
    fail(_kind: string, message: string): number {
      failures.push(message);
      return 2;
    },
  } as unknown as CommandContext;
  return { ctx, failures };
}

test("the snippet path is the value after --path, and --json is allowed", () => {
  const { ctx } = recordingContext();
  assert.equal(snippetPathFrom(["check-snippet", "--path", "Dockerfile", "--json"], ctx), "Dockerfile");
});

test("a missing, valueless, or unknown argument is a usage failure", () => {
  for (const args of [
    ["check-snippet"],
    ["check-snippet", "--path"],
    ["check-snippet", "--path", "--json"],
    ["check-snippet", "--wat"],
  ]) {
    const { ctx, failures } = recordingContext();
    assert.equal(snippetPathFrom(args, ctx), 2, args.join(" "));
    assert.equal(failures.length, 1);
  }
});

test("a stream is read to the end as UTF-8", async () => {
  assert.equal(await readStream(Readable.from([Buffer.from("FROM node:"), Buffer.from("18\n")])), "FROM node:18\n");
  await assert.rejects(
    readStream(
      new Readable({
        read() {
          this.destroy(new Error("boom"));
        },
      }),
    ),
    /boom/,
  );
});

const snippet = [
  "import platform",
  "from datetime import datetime",
  "value = datetime.utcnow()",
  "platform.java_ver()",
].join("\n");

function checkSnippetCli(args: string[]) {
  return spawnSync(process.execPath, [resolve("dist/src/cli.js"), "check-snippet", ...args], {
    input: snippet,
    encoding: "utf8",
    env: { ...process.env, OFFING_DATA_VERSION: "bundled" },
  });
}

test("check-snippet prints text for findings with and without a replacement", () => {
  const result = checkSnippetCli(["--path", "timeutil.py"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Replacement: datetime\.now\(datetime\.UTC\)/);
  assert.match(result.stdout, /Rule: python\.symbol\.platform\.java-ver/);
  assert.equal(result.stdout.match(/Replacement:/g)?.length, 1);
});

test("check-snippet emits code, replacement, and evidence in JSON", () => {
  const result = checkSnippetCli(["--path", "timeutil.py", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const { findings } = JSON.parse(result.stdout);
  assert.deepEqual(
    findings.map(({ code, replacement }: { code: string; replacement: string | null }) => [code, replacement]),
    [
      ["value = datetime.utcnow()", "datetime.now(datetime.UTC)"],
      ["platform.java_ver()", null],
    ],
  );
  assert.match(findings[0].source.url, /^https:\/\/docs\.python\.org\//);
});

test("check-snippet rejects a path outside the repository", () => {
  const result = checkSnippetCli(["--path", "../timeutil.py"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /path must stay inside the repository/);
});

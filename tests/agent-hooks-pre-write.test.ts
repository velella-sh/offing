import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { hookResponse } from "../src/agent-hooks/command.js";

async function project(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "offing-pre-write-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "project");
  await mkdir(root);
  return { root, directory };
}

function check(root: string, name: string, input: object, host = "claude-code", gate = "medium") {
  return hookResponse(
    [host, "--fail-on", gate],
    JSON.stringify({
      hook_event_name: host === "cursor" ? "preToolUse" : "PreToolUse",
      cwd: root,
      tool_name: name,
      tool_input: input,
    }),
  );
}

test("pre-write checks a sequence of edits with the imports from the existing file", async (t) => {
  const { root } = await project(t);
  const file = join(root, "app.py");
  const original = "import imp\nload = None\n";
  await writeFile(file, original);
  const result = await check(root, "MultiEdit", {
    file_path: file,
    edits: [
      { old_string: "import imp", new_string: "import imp as loader" },
      { old_string: "None", new_string: 'loader.find_module("demo")' },
    ],
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /importlib\.util\.find_spec/);
  assert.equal(await readFile(file, "utf8"), original);
});

test("pre-write checks replace-all, and applies the configured severity floor", async (t) => {
  const { root } = await project(t);
  await writeFile(join(root, "app.js"), "const a = Buffer.alloc(8);\nconst b = Buffer.alloc(8);\n");
  const edit = { file_path: "app.js", old_string: "Buffer.alloc", new_string: "new Buffer", replace_all: true };
  const blocked = await check(root, "Edit", edit);
  assert.equal(blocked.exitCode, 2);
  assert.match(blocked.stderr, /app\.js:1[\s\S]*app\.js:2/);
  assert.equal((await check(root, "Edit", edit, "claude-code", "high")).exitCode, 0);
  assert.equal((await check(root, "Edit", edit, "claude-code", "none")).exitCode, 0);
  assert.equal((await check(root, "Edit", { ...edit, old_string: "never matched" })).exitCode, 0);
});

test("Codex previews updated and moved files in a multi-file patch", async (t) => {
  const { root } = await project(t);
  const original = "\nfunction allocate() {\n    return Buffer.alloc(8);\n}\n";
  const file = join(root, "app.js");
  await writeFile(file, original);
  const patch = [
    "*** Begin Patch",
    "*** Delete File: old.js",
    "*** Update File: app.js",
    "*** Move to: lib/app.ts",
    "@@ function allocate() {",
    "-    return Buffer.alloc(8);",
    "+    return new Buffer(8);",
    " }",
    "*** End of File",
    "*** Add File: clean.js",
    "+console.log('hello');",
    "*** End Patch",
    "",
  ].join("\n");
  const blocked = await check(root, "apply_patch", { command: patch }, "codex");
  assert.equal(blocked.exitCode, 2);
  assert.match(blocked.stderr, /lib\/app\.ts:3[\s\S]*Buffer\.alloc/);
  assert.equal(await readFile(file, "utf8"), original);

  const missingContext = patch.replace("function allocate() {", "function missing() {");
  assert.equal((await check(root, "apply_patch", { command: missingContext }, "codex")).exitCode, 0);
  const wrongText = patch.replace("return Buffer.alloc(8);", "return Buffer.alloc(9);");
  assert.equal((await check(root, "apply_patch", { command: wrongText }, "codex")).exitCode, 0);
  const malformed = patch.replace("*** End Patch", "");
  assert.equal((await check(root, "apply_patch", { command: malformed }, "codex")).exitCode, 0);
});

test("pre-write skips targets under a link outside the reported repository", async (t) => {
  const { root, directory } = await project(t);
  const outside = join(directory, "outside");
  await mkdir(outside);
  await symlink(outside, join(root, "linked"), "junction");
  const edit = { file_path: "linked/app.js", content: "new Buffer(8);\n" };
  assert.deepEqual(await check(root, "Write", edit), { stdout: "", stderr: "", exitCode: 0 });
  const short = { file_path: "app.js", content: "new Buffer(8);\n" };
  assert.equal((await check(root, "Read", short)).exitCode, 0);
  assert.equal((await check(root, "Write", { ...short, file_path: 42 })).exitCode, 0);
  assert.equal((await check(root, "Edit", { ...short, content: undefined })).exitCode, 0);
});

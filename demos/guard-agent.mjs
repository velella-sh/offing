import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The prompt and tool inputs from the original Codex recording. Replay the hook
// and the recorded fallback locally so their responses come from the chosen CLI.
const prompt = `Add request@2.88.2 to package.json using apply_patch.
If blocked, use native fetch in client.mjs
and run node client.mjs to print the body of data:,OK.`;
const manifest = `{
  "name": "offing-guard-demo",
  "version": "1.0.0",
  "private": true,
  "dependencies": {}
}
`;
const patch = `*** Begin Patch
*** Update File: package.json
@@
-  "dependencies": {}
+  "dependencies": { "request": "2.88.2" }
*** End Patch
`;
const fallback = 'console.log(await (await fetch("data:,OK")).text());\n';
const recordedRefusal = `Offing found 1 lifecycle issue in package.json:
1) [high] request is deprecated — package.json:5
   Replacement: Native fetch or a maintained HTTP client
   Evidence: https://www.npmjs.com/package/request

Fix this before continuing; nothing was changed automatically.`;
const [input, output, mode] = process.argv.slice(2);
assert.ok(input && output, "Pass the installed Offing CLI and replay output directory.");
const cli = resolve(input);
const project = join(output, "project");
mkdirSync(project);
const packageJson = join(project, "package.json");
writeFileSync(packageJson, manifest);

function run(args, input) {
  const result = spawnSync(process.execPath, args, { cwd: project, input, encoding: "utf8", timeout: 15000 });
  if (result.error) throw result.error;
  return result;
}

if (mode === "legacy") {
  // The published 0.1.1 hook predates PreToolUse. Verify the recorded finding through its check command.
  const check = run([cli, "check", "pkg:npm/request@2.88.2", "--data-version", "bundled"]);
  assert.equal(check.status, 1, check.stderr);
  assert.match(check.stdout, /^Status: affected \(high\)/m);
  assert.match(check.stdout, /^HIGH request is deprecated$/m);
  assert.match(check.stdout, /^Replacement: Native fetch or a maintained HTTP client$/m);
  assert.match(check.stdout, /^Source: https:\/\/www\.npmjs\.com\/package\/request$/m);
} else {
  const hook = run([cli, "hook", "codex"], JSON.stringify({
    cwd: project,
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    tool_input: { command: patch },
  }));
  assert.equal(hook.status, 2, hook.stdout + hook.stderr);
  assert.match(hook.stderr, /\[high\] request is deprecated — package\.json:5/);
  assert.match(hook.stderr, /Replacement: Native fetch or a maintained HTTP client/);
  assert.match(hook.stderr, /Evidence: https:\/\/www\.npmjs\.com\/package\/request/);
}
assert.equal(readFileSync(packageJson, "utf8"), manifest);

writeFileSync(join(project, "client.mjs"), fallback);
const client = run(["client.mjs"]);
assert.equal(client.status, 0, client.stderr);
assert.equal(client.stdout, "OK\n");

const heading = (label) => `\x1b[1;36m${label}\x1b[0m`;
const request = `${heading("User")}

${prompt}
`;
writeFileSync(join(output, "prompt.txt"), request);
const blocked = `${request}
${heading("Codex · apply_patch → package.json")}

${recordedRefusal}
`;
writeFileSync(join(output, "blocked.txt"), blocked);
writeFileSync(join(output, "fallback.txt"), `${blocked}
${heading("Codex · node client.mjs")}

${fallback.trimEnd()}
${client.stdout}`);

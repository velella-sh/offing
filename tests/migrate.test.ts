import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const cli = process.env.OFFING_MIGRATION_TEST_CLI ?? resolve("dist/src/cli.js");
const replay = process.env.OFFING_MIGRATION_TEST_REPLAY ?? resolve("dist/src/migrate/replay.js");
const run = (cwd: string, args: string[]) => execute(process.execPath, [cli, ...args], { cwd });
const git = async (cwd: string, args: string[]) => (await execute("git", args, { cwd })).stdout.trim();

const source = '{\n  "name": "fixture",\n  "dependencies": {\n    "request": "2.88.2"\n  }\n}\n';
const patch = [
  "diff --git a/package.json b/package.json",
  "--- a/package.json",
  "+++ b/package.json",
  "@@ -1,6 +1,6 @@",
  " {",
  '   "name": "fixture",',
  '   "dependencies": {',
  '-    "request": "2.88.2"',
  '+    "axios": "1.16.0"',
  "   }",
  " }",
  "",
].join("\n");

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "offing-migrate-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = join(directory, "repo");
  await git(directory, ["init", "--quiet", repo]);
  await git(repo, ["config", "user.name", "Offing Test"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "commit.gpgSign", "false"]);
  await writeFile(join(repo, "package.json"), source);
  const patchFile = join(directory, "fix.patch");
  await writeFile(patchFile, patch);
  await git(repo, ["add", "package.json"]);
  await git(repo, ["commit", "-qm", "fixture"]);
  const head = await git(repo, ["rev-parse", "HEAD"]);
  const result = JSON.parse((await run(repo, ["scan", "--json"])).stdout) as {
    findings: Array<{ id: string; ruleId: string }>;
  };
  const finding = result.findings.find((entry) => entry.ruleId === "npm.package.request.deprecated");
  assert.ok(finding);
  return { repo, head, findingId: finding.id, agent: `"${process.execPath}" "${replay}" "${patchFile}"` };
}

test("a replay agent writes a local migration branch, an unchanged checkout and a verify trailer", async (t) => {
  const { repo, head, findingId, agent } = await fixture(t);
  const result = await run(repo, ["migrate", findingId, "--agent", agent]);
  const branch = /local branch (\S+)\./.exec(result.stdout)?.[1];
  const receiptPath = /Verification result: ([^\n]+)/.exec(result.stdout)?.[1];
  assert.ok(branch);
  assert.ok(branch.startsWith("offing/migrate/") && receiptPath);
  t.after(() => rm(receiptPath, { force: true }));
  assert.equal(await git(repo, ["rev-parse", "HEAD"]), head);
  assert.equal(await git(repo, ["status", "--porcelain"]), "");
  assert.equal(await readFile(join(repo, "package.json"), "utf8"), source);
  assert.match(await git(repo, ["show", `${branch}:package.json`]), /"axios"/);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
    schemaVersion: string;
    verdict: string;
    commands: Array<{ status: string }>;
  };
  assert.equal(receipt.schemaVersion, "offing.verify-result.v1");
  assert.equal(receipt.verdict, "passed");
  assert.ok(receipt.commands.every((entry) => entry.status === "not-run"));
  const trailer = await git(repo, ["log", "-1", "--format=%(trailers:key=Offing-Verify-Result,valueonly)", branch]);
  assert.deepEqual(JSON.parse(trailer), receipt);
  await assert.rejects(run(repo, ["migrate", findingId, "--agent", agent]), /already exists/);
});

test("migration refuses a dirty checkout before starting an agent", async (t) => {
  const { repo, findingId, agent } = await fixture(t);
  await writeFile(join(repo, "uncommitted.txt"), "local");
  await assert.rejects(run(repo, ["migrate", findingId, "--agent", agent]), /clean working tree/);
  assert.equal(await git(repo, ["branch", "--list", "offing/migrate/*"]), "");
});

test("migration reports agent timeouts and rejects edits outside the packet", async (t) => {
  const { repo, findingId } = await fixture(t);
  const outside = `"${process.execPath}" -e "require('fs').writeFileSync('outside.txt', 'x')"`;
  await assert.rejects(run(repo, ["migrate", findingId, "--agent", outside]), /outside the packet/);
  const wait = `"${process.execPath}" -e "setTimeout(() => {}, 10000)"`;
  await assert.rejects(run(repo, ["migrate", findingId, "--agent", wait, "--timeout-ms", "25"]), /timed out/);
  assert.equal(await git(repo, ["branch", "--list", "offing/migrate/*"]), "");
  assert.equal(await git(repo, ["status", "--porcelain"]), "");
});

test("migrate --from-refusals plans a separate worktree for an unhandled package finding", async (t) => {
  const { repo, agent } = await fixture(t);
  const result = await run(repo, ["migrate", "--from-refusals", "--agent", agent]);
  assert.match(result.stdout, /local branch offing\/migrate\//);
  const receiptPath = /Verification result: ([^\n]+)/.exec(result.stdout)?.[1];
  if (receiptPath) t.after(() => rm(receiptPath, { force: true }));
  assert.equal(await git(repo, ["status", "--porcelain"]), "");
});

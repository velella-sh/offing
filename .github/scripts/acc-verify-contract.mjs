import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { compareScans } from "../../docs/spec/verify/conformance/check.mjs";

const execute = promisify(execFile);
const binary = resolve(process.argv[2]);
const folder = await mkdtemp(join(tmpdir(), "offing-verify-consumer-"));
const root = join(folder, "repo");
const before = join(folder, "before.json");
const run = async (file, args) => (await execute(file, args, { cwd: root })).stdout;
const offing = (...args) => binary.endsWith(".js") ? run(process.execPath, [binary, ...args]) : run(binary, args);
const git = (...args) => run("git", args);

try {
  await mkdir(root);
  await git("init", "-q");
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  const workflow = ".github/workflows/ci.yml";
  await writeFile(join(root, workflow), "on: push\njobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n");
  await git("add", "--", workflow);
  await git("-c", "user.name=Offing", "-c", "user.email=offing@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  await git("config", "user.name", "Offing");
  await git("config", "user.email", "offing@example.invalid");
  await git("config", "commit.gpgsign", "false");
  const oldHead = (await git("rev-parse", "HEAD")).trim();
  const scan = await offing("scan", ".", "--json");
  await writeFile(before, scan);
  const fix = JSON.parse(await offing("fix", ".", "--branch", "--json"));
  assert.equal(fix.before.commit, oldHead);
  assert.notEqual(fix.after.commit, oldHead);
  assert.ok(fix.counts.resolved > 0);
  const receipt = JSON.parse(await offing("receipt", ".", "--before", before, "--format", "verify-result"));
  const after = JSON.parse(await offing("scan", ".", "--json"));
  assert.deepEqual(receipt, fix);
  compareScans(receipt, JSON.parse(scan), after);
  const body = await offing("receipt", ".", "--before", before);
  const block = body.split("<!-- offing-verify-result:v1 -->\n```json\n")[1]?.split("\n```")[0];
  assert.ok(block, "the Markdown receipt includes the JSON fence");
  assert.deepEqual(JSON.parse(block), receipt);
  console.log("acc-verify-contract: branch fix, receipt, pull request block and independent comparison agree");
} finally {
  await rm(folder, { recursive: true, force: true });
}

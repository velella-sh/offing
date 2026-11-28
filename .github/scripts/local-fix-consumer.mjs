import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { compareScans } from "../../docs/spec/verify/conformance/check.mjs";

const execute = promisify(execFile);
const workflow = ".github/workflows/ci.yml";
const notes = "notes.md";
const unrelatedEdit = "Keep this existing edit.\n";

export const scanArgs = ["scan", ".", "--json"];
export const receiptArgs = (before) => ["receipt", ".", "--before", before, "--format", "verify-result"];

export async function withRepository(cli, run, checkout = "v4") {
  const folder = await mkdtemp(join(tmpdir(), "offing-first-fix-"));
  const root = join(folder, "repo");
  const env = { ...process.env, OFFING_DATA_VERSION: "bundled", OFFING_NO_CACHE: "1" };
  for (const credential of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) delete env[credential];
  const options = { cwd: root, env, timeout: 15_000 };
  const git = async (...args) => (await execute("git", args, options)).stdout.trim();
  const offing = async (...args) => (await execute(process.execPath, [cli, ...args], options)).stdout;
  const setCheckout = (ref) =>
    writeFile(join(root, workflow), `on: push\njobs:\n  test:\n    steps:\n      - uses: actions/checkout@${ref}\n`);
  try {
    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await git("init", "-q");
    await setCheckout(checkout);
    await writeFile(join(root, notes), "Original notes.\n");
    await git("add", "--", workflow, notes);
    await git("-c", "user.name=Offing", "-c", "user.email=offing@example.invalid", "-c", "commit.gpgsign=false",
      "-c", "core.hooksPath=.git/no-hooks", "commit", "-qm", "baseline");
    const head = await git("rev-parse", "HEAD");
    await writeFile(join(root, notes), unrelatedEdit);

    const assertWorkingTree = async (fixed) => {
      assert.equal(await git("rev-parse", "HEAD"), head, "the host made no commit");
      assert.equal(await git("diff", "--cached", "--name-only"), "", "the host staged no changes");
      assert.equal(await readFile(join(root, notes), "utf8"), unrelatedEdit, "the unrelated edit survived");
      const changed = (await git("diff", "--name-only")).split(/\r?\n/).sort();
      assert.deepEqual(changed, fixed ? [workflow, notes] : [notes]);
      assert.deepEqual(await git("ls-files", "--others", "--exclude-standard"), "", "no evidence in the repository");
    };
    await run({
      root, env, offing, head,
      beforePath: join(folder, "before.json"),
      scan: async () => JSON.parse(await offing(...scanArgs)),
      fix: () => setCheckout("v7"),
      assertWorkingTree,
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export function selectFinding(scan) {
  assert.equal(scan.schemaVersion, "offing.scan.v1");
  const finding = scan.findings.find(({ ruleId, location }) =>
    ruleId === "github-actions.checkout.node20" && location.path === workflow);
  assert.ok(finding, "the installed scan observed the checkout finding");
  return finding;
}

export function checkEvidence(finding, id) {
  assert.equal(finding.id, id);
  assert.equal(finding.ruleId, "github-actions.checkout.node20");
  assert.equal(finding.location.path, workflow);
  assert.ok(finding.location.line > 0);
  assert.ok(finding.sources.some(({ url }) => /^https:\/\/github\.com\/(actions\/checkout|actions\/runner|github\/)/u.test(url)),
    JSON.stringify(finding.sources));
}

export function verifyReceipt(receipt, before, after, findingId, resolved, version, head) {
  compareScans(receipt, before, after);
  assert.equal(receipt.before.offingVersion, version);
  assert.equal(receipt.after.offingVersion, version);
  assert.equal(receipt.before.commit, head);
  assert.equal(receipt.after.commit, head);
  assert.deepEqual(receipt.resolved.map(({ id }) => id), resolved ? [findingId] : []);
  assert.deepEqual(receipt.remaining.map(({ id }) => id), resolved ? [] : [findingId]);
  assert.deepEqual(receipt.introduced, []);
  assert.equal(receipt.verdict, resolved ? "passed" : "failed");
  assert.ok(receipt.commands.every(({ status }) => status === "not-run"), "Offing ran no project checks");
}

export const explainArgs = (id) => ["explain", id, ".", "--json"];
export const contextArgs = (id) => ["context", id, ".", "--json"];

export function checkContext(context, id) {
  assert.equal(context.schemaVersion, "offing.context.v1");
  checkEvidence(context.finding, id);
  assert.ok(context.affectedFiles.includes(workflow));
  assert.ok(context.steps.length > 0);
}

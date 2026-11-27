import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";

import { diffFor } from "../src/fix/codemods/shared/edits.js";
import { declarationSchema, declarativeCodemod } from "../src/fix/kit/declaration.js";
import { planFixture, testCases, testCodemod } from "../src/fix/kit/conformance.js";
import { guardedPlan, permissionFlag } from "../src/fix/kit/guarded.js";
import { planFixReport } from "../src/fix/index.js";
import type { Finding, ScanResult } from "../src/domain.js";
import { runCli } from "./cli-runner.js";

const rootExample = resolve("docs/spec/codemod/example");
const declaration = declarationSchema.parse(JSON.parse(await readFile(join(rootExample, "codemod.json"), "utf8")));
const good: Finding = {
  id: "finding",
  ruleId: declaration.ruleId,
  detector: "mise",
  title: "",
  summary: "",
  severity: "high",
  confidence: "exact",
  location: { path: declaration.path, line: 2 },
  replacement: declaration.expectedReplacement,
  sources: [],
};

function scan(root: string, findings: Finding[]): ScanResult {
  return { schemaVersion: "offing.scan.v1", root, findings, scannedAt: "2026-11-26", diagnostics: [] };
}

async function scratch(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "offing-codemod-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("declarations require one safe exact edit", () => {
  for (const invalid of [
    { path: "../file" },
    { path: "sub/.git/config" },
    { path: String.raw`dir\file` },
    { before: "a\nb" },
    { before: declaration.after },
    { command: "anything" },
  ]) {
    assert.equal(declarationSchema.safeParse({ ...declaration, ...invalid }).success, false);
  }
});

test("dispatch honors rule, path and replacement, with precise refusals", async (t) => {
  const root = await scratch(t);
  const fixer = declarativeCodemod(declaration);
  const plan = (findings: Finding[]) => planFixReport(scan(root, findings), [fixer]);
  await writeFile(join(root, declaration.path), `[tools]\n${declaration.before}\n`);
  assert.equal((await plan([good])).patches.length, 1);
  assert.deepEqual(await plan([{ ...good, ruleId: "another.rule" }]), { patches: [], refusals: [] });
  assert.deepEqual(await plan([{ ...good, location: { path: "other.toml", line: 2 } }]), {
    patches: [],
    refusals: [],
  });
  assert.match((await plan([{ ...good, replacement: "changed" }])).refusals[0]?.reason ?? "", /rule no longer names/);
  assert.match(
    (await plan([{ ...good, location: { path: declaration.path } }])).refusals[0]?.reason ?? "",
    /exact old/,
  );
  await writeFile(join(root, declaration.path), `${declaration.after}\n`);
  assert.deepEqual(await plan([{ ...good, location: { path: declaration.path, line: 1 } }]), {
    patches: [],
    refusals: [],
  });
  await rm(join(root, declaration.path));
  assert.match((await plan([good])).refusals[0]?.reason ?? "", /could not be read/);
});

test("external data never loads adjacent programs and conformance checks a clean consumer", async (t) => {
  const root = await scratch(t);
  await cp(rootExample, root, { recursive: true });
  await writeFile(join(root, "codemod.mjs"), 'throw new Error("the fixture was executed");');
  assert.deepEqual(await testCodemod(root), { id: "mise-node-pin", cases: ["applies", "refuses"] });
  const accepted = await runCli(["codemod", "test", root]);
  assert.match(accepted.stdout, /passed 2 case/);
  const usage = await runCli(["codemod", "apply", root]);
  assert.equal(usage.code, 2);
  await writeFile(join(root, "codemod.json"), JSON.stringify({ ...declaration, command: "node codemod.mjs" }));
  const rejected = await runCli(["codemod", "test", root]);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /command/);
});

test("runner rejects nondeterministic and non-idempotent planners", async () => {
  const cases = join(rootExample, "cases");
  const clean = { patches: [], refusals: [] };
  const file = declaration.path;
  const patch = diffFor(file, `[tools]\n${declaration.before}\n`, `[tools]\n${declaration.after}\n`);
  assert.ok(patch);
  const changed = { patches: [{ ...patch, fixer: declaration.id }], refusals: [] };
  let run = 0;
  await assert.rejects(
    testCases(cases, async () => (++run === 1 ? changed : clean)),
    /deterministic/,
  );
  await assert.rejects(
    testCases(cases, async () => changed),
    /not idempotent/,
  );
});

test("bad fixture trees, missing cases and misdeclared output fail", async (t) => {
  const root = await scratch(t);
  const cases = join(root, "cases");
  const plan = planFixture({ declaration });
  await mkdir(cases);
  await assert.rejects(testCases(cases, plan), /one fixture/);
  await cp(join(rootExample, "cases"), cases, { recursive: true });
  const before = join(cases, "applies", "before");
  const after = join(cases, "applies", "after");
  await writeFile(join(after, `${declaration.path}.fixture`), "[tools]\n");
  await assert.rejects(testCases(cases, plan), /after tree/);
  await mkdir(join(before, ".git"));
  await assert.rejects(testCases(cases, plan), /Git metadata/);
  await rm(join(before, ".git"), { recursive: true });
  const fixtureGit = join(before, ".git.fixture");
  await writeFile(fixtureGit, "disallowed fixture metadata");
  await assert.rejects(testCases(cases, plan), /Git metadata/);
  await rm(fixtureGit);
  const fixtureParent = join(before, "...fixture");
  await writeFile(fixtureParent, "invalid name");
  await assert.rejects(testCases(cases, plan), /portable fixture name/);
  await rm(fixtureParent);
  await writeFile(join(before, "package.json"), "{}");
  await writeFile(join(before, "package.json.fixture"), "{}");
  await assert.rejects(testCases(cases, plan), /More than one fixture/);
});

test("fixture symlinks are rejected before reading their targets", {
  skip: process.platform === "win32",
}, async (t) => {
  const root = await scratch(t);
  await cp(rootExample, root, { recursive: true });
  await symlink(join(root, "codemod.json"), join(root, "cases", "applies", "before", "link"));
  await assert.rejects(testCodemod(root), /regular fixture file/);
});

test("planner process denies writes, child processes and network access", async (t) => {
  const root = await scratch(t);
  const script = `
    import assert from "node:assert/strict";
    import { writeFileSync } from "node:fs";
    import { spawnSync } from "node:child_process";
    import { blockNetwork } from ${JSON.stringify(new URL("../src/fix/kit/network-guard.js", import.meta.url).href)};
    const verify = blockNetwork();
    assert.throws(() => writeFileSync("sentinel", "changed"), {code: "ERR_ACCESS_DENIED"});
    assert.throws(() => spawnSync(process.execPath, ["--version"]), {code: "ERR_ACCESS_DENIED"});
    await assert.rejects(import("node:http"), /cannot use the network/);
    assert.throws(() => process.getBuiltinModule("dns"), /cannot use the network/);
    assert.throws(() => fetch("http://127.0.0.1:1"), /cannot use the network/);
    assert.throws(verify, /cannot use the network/);
  `;
  const flags = process.allowedNodeEnvironmentFlags;
  assert.equal(permissionFlag(new Set()), "--experimental-permission");
  assert.equal(permissionFlag(new Set(["--permission"])), "--permission");
  execFileSync(process.execPath, [permissionFlag(flags), "--allow-fs-read=*", "--input-type=module", "-e", script], {
    cwd: root,
  });
  await assert.rejects(readFile(join(root, "sentinel")), { code: "ENOENT" });
  await assert.rejects(guardedPlan(root, { builtIn: "missing" }), /built-in codemod/);
});

test("scaffolding makes a distinct codemod with a single fixture and refuses collisions", async (t) => {
  const root = await scratch(t);
  await mkdir(join(root, "src/fix/codemods"), { recursive: true });
  await mkdir(join(root, "src/fix/kit"));
  await mkdir(join(root, "tests/fixtures/codemods"), { recursive: true });
  await writeFile(join(root, "src/fix/kit/define.ts"), "");
  const scaffold = (id: string) =>
    execFileSync(process.execPath, [resolve("tools/scaffold/codemod.mjs"), id], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  assert.throws(() => scaffold("../bad"), /kebab-case-id/);
  assert.match(scaffold("demo-fix"), /Created/);
  const source = await readFile(join(root, "src/fix/codemods/demo-fix.ts"), "utf8");
  assert.match(source, /demoFixFixer = defineCodemod/);
  assert.equal(
    await readFile(join(root, "tests/fixtures/codemods/demo-fix/example/expect.json"), "utf8"),
    '{ "refusals": [] }\n',
  );
  assert.throws(() => scaffold("demo-fix"), /EEXIST/);
  assert.equal(await readFile(join(root, "src/fix/codemods/demo-fix.ts"), "utf8"), source);
});

test("the registry generator discovers a new codemod and checks for stale output", async (t) => {
  const root = await scratch(t);
  await cp(resolve("src/fix"), join(root, "src/fix"), { recursive: true });
  await mkdir(join(root, "tools"));
  const generator = join(root, "tools/generate-codemod-registry.mjs");
  await cp(resolve("tools/generate-codemod-registry.mjs"), generator);
  const generate = (...args: string[]) =>
    execFileSync(process.execPath, [generator, ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  generate();
  const generated = join(root, "src/fix/registry.generated.ts");
  const original = await readFile(generated, "utf8");
  const source = join(root, "src/fix/codemods/demo.ts");
  await writeFile(source, 'export const demoFixer = defineCodemod({ id: "new-demo" });\n');
  assert.throws(() => generate("--check"), /out of date/);
  generate();
  generate("--check");
  assert.match(await readFile(generated, "utf8"), /import \{ demoFixer \} from "\.\/codemods\/demo\.js";/);
  await writeFile(source, 'export const demoFixer = defineCodemod({ id: "go-mod" });\n');
  assert.throws(() => generate(), /ids must be unique/);
  await rm(source);
  generate();
  assert.equal(await readFile(generated, "utf8"), original);
});

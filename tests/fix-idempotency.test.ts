import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { fixtureFiles, writeFixture } from "../src/fix/kit/fixture.js";
import { planFixture, testCases } from "../src/fix/kit/conformance.js";
import { fixers, planFixReport } from "../src/fix/index.js";
import { builtInDetectors } from "../src/detectors/index.js";
import { scanRepository } from "../src/engine/index.js";

const fixtures = resolve("tests/fixtures/codemods");

for (const { id } of fixers) {
  test(`${id}: fixtures conform under the planning guard`, async () => {
    const directory = join(fixtures, id);
    const cases = await testCases(directory, planFixture({ builtIn: id }));
    assert.ok(cases.includes("idempotency") || cases.includes("example"));
  });
}

test("guarded plans match the normal fixer path on baseline cases", async (t) => {
  const roots: string[] = [];
  t.after(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });
  for (const fixer of fixers) {
    const before = join(fixtures, fixer.id, "idempotency", "before");
    if (!(await stat(before).catch(() => undefined))?.isDirectory()) continue;
    const root = await mkdtemp(join(tmpdir(), "offing-fix-parity-"));
    roots.push(root);
    await writeFixture(root, await fixtureFiles(before, true));
    const scan = await scanRepository(root, builtInDetectors, { noCache: true });
    assert.deepEqual(await planFixture({ builtIn: fixer.id })(root), await planFixReport(scan, [fixer]));
  }
});

test("every registered fixture directory belongs to a shipped fixer", async () => {
  assert.deepEqual((await readdir(fixtures)).sort(), fixers.map(({ id }) => id).sort());
});

test("codemod fixture names stay neutral, including workflow and Dockerfile names", async () => {
  const files = await fixtureFiles(join(fixtures, "workflow-commands/syntax/before"), true);
  assert.deepEqual([...files.keys()], [".github/workflows/ci.yml"]);
  const docker = await fixtureFiles(join(fixtures, "dockerfile-legacy/syntax/before"), true);
  assert.deepEqual([...docker.keys()], ["Dockerfile"]);
});

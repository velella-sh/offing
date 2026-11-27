import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { builtInDetectors } from "../src/detectors/index.js";
import { scanRepository } from "../src/engine/index.js";
import { fixers, planFixReport } from "../src/fix/index.js";
import { testCases } from "../src/fix/kit/conformance.js";
import { classifyFixCoverage, coverageTable } from "../tools/codemod-coverage.js";
import { applyPatches, cleanup, repository } from "./codemod-helpers.js";

const day = "2026-11-27T00:00:00.000Z";
const scan = (root: string) => scanRepository(root, builtInDetectors, { scannedAt: day, noCache: true });

for (const id of ["action-runtime", "github-actions-uses", "kubernetes", "python", "runtime-pins"]) {
  test(`${id} plans the pinned before, after and refusal cases`, async () => {
    const fixer = fixers.find((candidate) => candidate.id === id);
    assert.ok(fixer);
    const cases = await testCases(resolve("tests/fixtures/codemods", id), async (root) =>
      planFixReport(await scan(root), [fixer]),
    );
    assert.ok(cases.length >= 2);
  });
}

test("coverage attributes refused and missing patches to distinct rules", async (t) => {
  t.after(cleanup);
  const root = await repository({
    ".tool-versions": "nodejs 20.3.1\n",
    "setup.cfg": "[options]\npython_requires = >=3.9,<4\n",
    "runtime.txt": "python-3.9.2\n",
    "clock.py": "from datetime import datetime\nprint(datetime.utcnow())\n",
  });
  const result = await scan(root);
  const counts = await classifyFixCoverage(result);
  assert.deepEqual(counts.get("nodejs.runtime.eol-20"), { patched: 1, refused: 0, unfixed: 0 });
  assert.deepEqual(counts.get("python.runtime.eol-3.9-and-older"), { patched: 0, refused: 1, unfixed: 1 });
  assert.match(coverageTable(counts), /\| `python\.runtime\.eol-3\.9-and-older` \| 0 \| 1 \| 1 \|\n\| `nodejs/);
});

test("setup expressions stay unclassified and cannot produce a runtime edit", async (t) => {
  t.after(cleanup);
  const root = await repository({
    ".github/workflows/ci.yml": [
      "jobs:",
      "  test:",
      "    steps:",
      "      - uses: actions/setup-node@v5",
      "        with:",
      "          node-version: ${{ inputs.node }}",
      "      - uses: actions/setup-python@v6",
      "        with:",
      "          python-version: ${{ inputs.python }}",
      "",
    ].join("\n"),
  });
  const result = await scan(root);
  assert.deepEqual(result.unclassified?.references.map(({ component }) => component).sort(), [
    "actions/setup-node",
    "actions/setup-python",
  ]);
  assert.deepEqual(await planFixReport(result), { patches: [], refusals: [] });
});

test("new runtime and Kubernetes edits compose with existing fixes in the same file", async (t) => {
  t.after(cleanup);
  const workflow = ".github/workflows/ci.yml";
  const manifest = "manifests/mixed.yml";
  const root = await repository({
    [workflow]: [
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/setup-node@v5",
      "        with:",
      "          node-version: 20",
      '      - run: echo "::set-output name=answer::42"',
      "",
    ].join("\n"),
    [manifest]: [
      "apiVersion: extensions/v1beta1",
      "kind: Ingress",
      "spec:",
      "  backend:",
      "    serviceName: web",
      "    servicePort: 80",
      "---",
      "apiVersion: policy/v1beta1",
      "kind: PodDisruptionBudget",
      "spec:",
      "  minAvailable: 1",
      "",
    ].join("\n"),
  });
  const plan = await planFixReport(await scan(root));
  assert.deepEqual(
    plan.patches.map(({ path }) => path),
    [workflow, manifest],
  );
  await applyPatches(root, plan.patches);
  const changedWorkflow = await readFile(join(root, workflow), "utf8");
  assert.match(changedWorkflow, /node-version: 24/);
  assert.match(changedWorkflow, /GITHUB_OUTPUT/);
  const changedManifest = await readFile(join(root, manifest), "utf8");
  assert.match(changedManifest, /defaultBackend:/);
  assert.match(changedManifest, /apiVersion: policy\/v1\n/);
  assert.deepEqual((await planFixReport(await scan(root))).patches, []);
});

test("runtime edits reject workflows carrying YAML anchors or aliases", async (t) => {
  t.after(cleanup);
  const steps =
    "jobs:\n  check:\n    steps:\n      - example-text\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 20\n";
  const root = await repository({
    ".github/workflows/anchor.yml": "env: &shared {EXAMPLE: value}\n" + steps,
    ".github/workflows/alias.yml": "env: *shared\nmetadata: &shared {EXAMPLE: value}\n" + steps,
  });
  const result = await scan(root);
  const plan = await planFixReport(result);
  assert.deepEqual(plan.patches, []);
  assert.equal(plan.refusals.length, 2);
  assert.ok(plan.refusals.every(({ reason }) => /YAML anchors or aliases/.test(reason)));
});

test("classifier arrays preserve long comments containing repeated hash characters", async (t) => {
  t.after(cleanup);
  const text = [
    "[project]",
    'name = "test"',
    "classifiers = [",
    "  # " + "#".repeat(2000) + " keep this explanation",
    '  "Programming Language :: Python :: 3.9",',
    '  "Programming Language :: Python :: 3.11",',
    "  # " + "#".repeat(2000) + " keep this one too",
    "]",
    "",
  ].join("\n");
  const root = await repository({ "pyproject.toml": text });
  const result = await scan(root);
  const plan = await planFixReport(result);
  assert.equal(plan.patches.length, 1);
  await applyPatches(root, plan.patches);
  assert.equal(
    await readFile(join(root, "pyproject.toml"), "utf8"),
    text.replace('  "Programming Language :: Python :: 3.9",\n', ""),
  );
});

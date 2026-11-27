import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { parseNpm } from "../src/forecast-tool/parse-lock.js";
import { parsePyproject, parseRequirements } from "../src/forecast-tool/parse-python.js";
import { parseWorkflow } from "../src/forecast-tool/parse-workflow.js";

function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("reads resolved versions from npm lockfiles v2 and v3", async () => {
  const [v2, v3] = await Promise.all([
    read("tests/fixtures/forecast-web/package-lock-v2.json"),
    read("extensions/vscode/package-lock.json"),
  ]);
  const v2References = parseNpm(v2);
  assert.deepEqual(
    v2References.map(({ purl, version }) => [purl, version]),
    [
      ["pkg:npm/a", "1.2.3"],
      ["pkg:npm/b", "1.2.3"],
    ],
  );
  const v3References = parseNpm(v3);
  assert.ok(v3References.some(({ purl, version }) => purl === "pkg:npm/%40types/node" && version?.startsWith("22.")));
  assert.ok(!v3References.some(({ purl }) => purl === "pkg:npm/offing-vscode"));
  assert.throws(() => parseNpm('{"lockfileVersion":1}', "package-lock.json"), /lockfileVersion 2 or 3/);
});

test("reads explicit npm manifest versions and leaves unsupported ranges unresolved", () => {
  const references = parseNpm('{"dependencies":{"a":"^1.2.3","b":">2.0.0","c":"npm:@scope/c@3.0.0"}}');
  assert.deepEqual(
    references.map(({ purl, version }) => [purl, version]),
    [
      ["pkg:npm/a", "1.2.3"],
      ["pkg:npm/b", undefined],
      ["pkg:npm/%40scope/c", "3.0.0"],
    ],
  );
});

test("reads pins and explicit minimums from real Python project files", async () => {
  const [requirements, pyproject] = await Promise.all([
    read("tests/fixtures/forecast-web/requirements.txt.fixture"),
    read("tests/fixtures/forecast-web/pyproject.toml.fixture"),
  ]);
  assert.deepEqual(
    parseRequirements(requirements).map(({ purl, version }) => [purl, version]),
    [["pkg:pypi/sphinx", "7.2.6"]],
  );
  const references = parsePyproject(pyproject);
  assert.ok(references.some(({ purl, version }) => purl === "pkg:pypi/urllib3" && version === "1.26"));
  assert.ok(references.some(({ purl, version }) => purl === "pkg:generic/python" && version === "3.10"));
  assert.ok(references.some(({ purl, version }) => purl === "pkg:pypi/pysocks" && version === "1.5.6"));
  assert.deepEqual(
    parseRequirements("a>1\nb==2.*\nc>=1,>=2\nd>=4,<2").map(({ version }) => version),
    [undefined, undefined, "2", undefined],
  );
});

test("reads uses and literal or matrix runtimes from three GitHub workflows", async () => {
  const [example, ci, pages] = await Promise.all([
    read("examples/workflows/forecast.yml"),
    read(".github/workflows/ci.yml"),
    read(".github/workflows/pages.yml"),
  ]);
  assert.ok(parseWorkflow(example).some(({ purl }) => purl === "pkg:github/velella-sh/offing"));
  assert.ok(
    parseWorkflow(ci).some(({ purl, version }) => purl === "pkg:github/actions/checkout" && version === "7.0.0"),
  );
  assert.ok(
    parseWorkflow(pages).some(({ purl, version }) => purl === "pkg:github/actions/deploy-pages" && version === "5.0.1"),
  );

  const workflow = [
    "jobs:",
    "  test:",
    "    strategy:",
    "      matrix:",
    "        node: [22, 24]",
    "    steps:",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: ${{ matrix.node }}",
    "      - uses: actions/setup-python@v5",
    "        with:",
    "          python-version: 3.10",
    "      - run: |",
    "          uses: fake/action@v1",
  ].join("\n");
  assert.deepEqual(
    parseWorkflow(workflow).map(({ purl, version }) => [purl, version]),
    [
      ["pkg:github/actions/setup-node", "4.0.0"],
      ["pkg:github/actions/setup-python", "5.0.0"],
      ["pkg:generic/python", "3.10"],
      ["pkg:generic/nodejs", "22.0.0"],
      ["pkg:generic/nodejs", "24.0.0"],
    ],
  );
});

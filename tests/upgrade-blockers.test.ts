import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";

import { buildBlockerGraph } from "../src/upgrade/graph.js";
import { checkUpgrade } from "../src/upgrade/index.js";
import type { UpgradeIssue } from "../src/upgrade/types.js";
import { runCli } from "./cli-runner.js";

async function fixture(t: TestContext, files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "offing-blockers-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  return root;
}

function find(issues: UpgradeIssue[], subject: string): UpgradeIssue {
  const issue = issues.find((item) => item.subject === subject);
  assert.ok(issue, subject);
  return issue;
}

const npmPackages = [
  ["", { dependencies: { "b-root": "^1", "a-root": "^1" } }],
  ["node_modules/b-root", { version: "1.0.0", dependencies: { child: "^1" } }],
  ["node_modules/a-root", { version: "1.0.0", dependencies: { child: "^1", other: "^1" } }],
  ["node_modules/child", { version: "1.0.0", engines: { node: "<22" } }],
  ["node_modules/b-root/node_modules/child", { version: "2.0.0", engines: { node: "<22" } }],
  ["node_modules/other", { version: "1.0.0", engines: { node: "<22" } }],
  ["node_modules/orphan", { version: "1.0.0", engines: { node: "<22" } }],
] as const;

const npmLock = (reverse = false): string =>
  JSON.stringify(
    {
      lockfileVersion: 3,
      packages: Object.fromEntries(reverse ? [...npmPackages].reverse() : npmPackages),
    },
    null,
    2,
  );

test("npm uses actual installed copies and stable shortest root paths, with byte-identical graph renderings", async (t) => {
  const root = await fixture(t, { "package-lock.json": npmLock() });
  const reordered = await fixture(t, { "package-lock.json": npmLock(true) });
  const target = { runtime: "nodejs", version: "22" };
  const report = await checkUpgrade(root, target);
  assert.deepEqual(find(report.issues, "child@1.0.0").chain, ["a-root@1.0.0", "child@1.0.0"]);
  assert.deepEqual(find(report.issues, "child@2.0.0").chain, ["b-root@1.0.0", "child@2.0.0"]);
  assert.equal(find(report.issues, "orphan@1.0.0").chain, undefined);
  const graph = buildBlockerGraph(report);
  assert.deepEqual(
    graph.roots.map(({ dependency, unlocks }) => [dependency, unlocks]),
    [
      ["a-root@1.0.0", 2],
      ["b-root@1.0.0", 1],
    ],
  );
  assert.equal(graph.ungrouped[0]?.firstSupported, "unknown");
  assert.equal(graph.total, 4);
  const graphOnly = async (path: string) => {
    const result = await runCli(["upgrade-check", "--to", "nodejs@22", path, "--graph", "--json"]);
    assert.equal(result.code, 1);
    return JSON.stringify(JSON.parse(result.stdout).graph);
  };
  assert.equal(await graphOnly(root), await graphOnly(reordered));
  for (const format of ["mermaid", "svg"]) {
    const first = await runCli(["upgrade-check", "--to", "nodejs@22", root, "--graph", "--format", format]);
    const second = await runCli(["upgrade-check", "--to", "nodejs@22", reordered, "--graph", "--format", format]);
    const repeated = await runCli(["upgrade-check", "--to", "nodejs@22", root, "--graph", "--format", format]);
    assert.equal(first.code, 1);
    assert.equal(first.stdout, second.stdout);
    assert.equal(first.stdout, repeated.stdout);
    assert.match(first.stdout, /No recorded dependency path/);
  }
  const dark = await runCli(["upgrade-check", "--to", "nodejs@22", root, "--format", "svg", "--theme", "dark"]);
  assert.match(dark.stdout, /#151d29/);
  const text = await runCli(["upgrade-check", "--to", "nodejs@22", root, "--graph"]);
  assert.match(text.stdout, /^nodejs@22: blocked.*\n  4 blockers for nodejs@22\n    a-root@1\.0\.0 \(2 blockers\)/);
});

test("pnpm follows importer and snapshot edges and ignores undeclared roots", async (t) => {
  const root = await fixture(t, {
    "pnpm-lock.yaml": [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "      top: {specifier: ^1, version: 1.0.0}",
      "packages:",
      "  top@1.0.0: {}",
      "  bottom@2.0.0: {engines: {node: '<22'}}",
      "  orphan@3.0.0: {engines: {node: '<22'}}",
      "snapshots:",
      "  top@1.0.0: {dependencies: {bottom: 2.0.0}}",
      "  bottom@2.0.0: {}",
      "  orphan@3.0.0: {}",
    ].join("\n"),
  });
  const { issues } = await checkUpgrade(root, { runtime: "nodejs", version: "22" });
  assert.deepEqual(find(issues, "bottom@2.0.0").chain, ["top@1.0.0", "bottom@2.0.0"]);
  assert.equal(find(issues, "orphan@3.0.0").chain, undefined);
});

test("Poetry, uv, and PDM use unambiguous locked edges from declared Python dependencies", async (t) => {
  const root = await fixture(t, {
    "pyproject.toml": '[project]\ndependencies = ["top==1.0.0"]',
    "poetry.lock": [
      "[[package]]",
      'name = "top"',
      'version = "1.0.0"',
      'python-versions = ">=3.8"',
      "[package.dependencies]",
      'poetry-bottom = "*"',
      "[[package]]",
      'name = "poetry-bottom"',
      'version = "2.0.0"',
      'python-versions = "<3.13"',
    ].join("\n"),
    "uv.lock": [
      "version = 1",
      'requires-python = ">=3.8"',
      "[[package]]",
      'name = "top"',
      'version = "1.0.0"',
      'dependencies = [{name = "uv-bottom", version = "2.0.0"}]',
      "[[package]]",
      'name = "uv-bottom"',
      'version = "2.0.0"',
      "resolution-markers = [\"python_full_version < '3.13'\"]",
    ].join("\n"),
    "pdm.lock": [
      "[[package]]",
      'name = "top"',
      'version = "1.0.0"',
      'dependencies = ["pdm-bottom>=2"]',
      "[[package]]",
      'name = "pdm-bottom"',
      'version = "2.0.0"',
      'requires_python = "<3.13"',
      "[[package]]",
      'name = "orphan"',
      'version = "2.0.0"',
      'requires_python = "<3.13"',
    ].join("\n"),
  });
  const { issues } = await checkUpgrade(root, { runtime: "python", version: "3.13" });
  for (const name of ["poetry", "uv", "pdm"]) {
    const bottom = name + "-bottom@2.0.0";
    assert.deepEqual(find(issues, bottom).chain, ["top@1.0.0", bottom]);
  }
  assert.equal(find(issues, "orphan@2.0.0").chain, undefined);
});

test("Composer follows package requirements and Go leaves indirect vendor entries ungrouped", async (t) => {
  const composer = await fixture(t, {
    "composer.json": JSON.stringify({ require: { "example/top": "^1" } }),
    "composer.lock": JSON.stringify({
      packages: [
        { name: "example/top", version: "1.0.0", require: { "example/bottom": "^2" } },
        { name: "example/bottom", version: "2.0.0", require: { php: "<8.4" } },
      ],
    }),
  });
  const php = await checkUpgrade(composer, { runtime: "php", version: "8.4" });
  assert.deepEqual(find(php.issues, "example/bottom@2.0.0").chain, ["example/top@1.0.0", "example/bottom@2.0.0"]);

  const go = await fixture(t, {
    "go.mod":
      "module example.org/project\ngo 1.23\nrequire (\nexample.org/top v1.0.0\nexample.org/bottom v1.0.0 // indirect\n)\n",
    "vendor/modules.txt":
      "# example.org/top v1.0.0\n## explicit; go 1.24\nexample.org/top\n# example.org/bottom v1.0.0\n## explicit; go 1.24\nexample.org/bottom\n",
  });
  const modules = await checkUpgrade(go, { runtime: "go", version: "1.23" });
  assert.deepEqual(find(modules.issues, "example.org/top@v1.0.0").chain, ["example.org/top@v1.0.0"]);
  assert.equal(find(modules.issues, "example.org/bottom@v1.0.0").chain, undefined);
});

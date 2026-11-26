import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { devEngineEntries } from "../src/detectors/npm/dev-engines.js";
import { npmDetector } from "../src/detectors/npm/index.js";
import { pythonDetector } from "../src/detectors/python/index.js";
import { scanWithBuiltIns } from "../src/scan-builtins.js";
import { readPinnedRuntimes } from "../src/runtime-pin.js";
import { parseCondaEnvironment } from "../src/version-files/conda.js";
import { parseMisePins } from "../src/version-files/mise.js";
import { parseToolVersionEntries } from "../src/version-files/tool-versions.js";

const fixtures = resolve("tests/fixtures/version-files");

function fixture(path: string): Promise<string> {
  return readFile(join(fixtures, path), "utf8");
}

test("reads pinned public project inputs with reviewed line numbers", async () => {
  const mise = parseMisePins(await fixture("mise/mise.toml"));
  assert.deepEqual(mise, [{ tool: "node", purl: "pkg:generic/nodejs", value: "24", line: 35 }]);
  assert.deepEqual(parseMisePins(await fixture("dot-mise/.mise.toml")), []);

  const manifest = await fixture("dev-engines/package.json.fixture");
  assert.deepEqual(devEngineEntries(manifest, "runtime"), [{ name: "node", version: "26.13.1", line: 10 }]);
  assert.deepEqual(devEngineEntries(manifest, "packageManager"), [{ name: "pnpm", version: "12.24.0", line: 5 }]);

  const conda = parseCondaEnvironment(await fixture("conda/environment.yml"));
  assert.deepEqual(conda.python, [{ raw: "python=3.8", version: "3.8", operator: "=", line: 6 }]);
  assert.deepEqual(conda.pip, [
    { raw: "jupyterlite==0.1.0b10", line: 131 },
    { raw: "sphinx-toggleprompt", line: 132 },
  ]);
  const findings = await pythonDetector.scan({ root: join(fixtures, "conda") });
  assert.deepEqual(
    findings.map(({ ruleId, location }) => [ruleId, location]),
    [["python.runtime.eol-3.9-and-older", { path: "environment.yml", line: 6 }]],
  );

  const asdf = parseToolVersionEntries(await fixture("asdf/.tool-versions"));
  assert.deepEqual(
    asdf.map(({ tool, line }) => [tool, line]),
    [
      ["bats", 1],
      ["shellcheck", 2],
      ["shfmt", 3],
      ["golang", 4],
    ],
  );
});

test("preserves ordered fallback candidates, comments, and lines for asdf", () => {
  assert.deepEqual(parseToolVersionEntries("# comment\r\n\r\n  ruby 3.2.2  3.3.0 # fallback\r\n"), [
    { tool: "ruby", versions: ["3.2.2", "3.3.0"], tail: "3.2.2  3.3.0 # fallback", line: 3 },
  ]);
});

test("reads quoted TOML keys, multiple versions and literal options within tools", () => {
  const contents = [
    "[env]",
    'node = "not a tool"',
    '["tools"]',
    "'nodejs' = [",
    '  "18.20.8",',
    '  { version = "20.18.0", option = "value # with hash" },',
    "]",
    '"npm:node" = "16"',
    "[tasks.check]",
    'node = "16"',
  ].join("\n");
  assert.deepEqual(parseMisePins(contents), [
    { tool: "nodejs", purl: "pkg:generic/nodejs", value: "18.20.8", line: 4 },
    { tool: "nodejs", purl: "pkg:generic/nodejs", value: "20.18.0", line: 4 },
  ]);
  assert.deepEqual(parseMisePins("[tools]\nnode = 18\n"), []);
  assert.deepEqual(parseMisePins("[tools]\nnode = ["), []);
  assert.deepEqual(parseMisePins('tools = ["node"]'), []);
});

test("scan sends mise pins to existing Ebb detectors without a package manifest", async () => {
  const root = join(fixtures, "consumer");
  const result = await scanWithBuiltIns(root, { noCache: true });
  assert.deepEqual(
    result.findings.map(({ ruleId, location }) => [ruleId, location.path, location.line]),
    [
      ["deno.bun.runtime.eol-1.0", "mise.toml", 9],
      ["deno.runtime.eol-1.x", "mise.toml", 8],
      ["elixir.erlang.eol-25", "mise.toml", 6],
      ["elixir.erlang.eol-25", "mise.toml", 7],
      ["elixir.runtime.eol-1.14", "mise.toml", 6],
      ["nodejs.runtime.eol-18", "mise.toml", 2],
      ["php.runtime.eol-7.4", "mise.toml", 5],
      ["python.runtime.eol-3.9-and-older", "mise.toml", 3],
      ["ruby.runtime.eol-3.2", "mise.toml", 4],
      ["terraform.cli.end-of-support-1.5", "mise.toml", 10],
    ],
  );
  assert.deepEqual(result.unclassified?.references, [
    {
      component: "pkg:generic/nodejs",
      reference: "lts",
      reason: "no-data: this version declaration cannot be resolved offline",
      detector: "npm",
      location: { path: "mise.toml", line: 2 },
    },
  ]);
  assert.deepEqual(await readPinnedRuntimes(root), { node: "18.20.8", python: "3.8.20" });
});

test("locates npm devEngines arrays and reports a Conda pip package with no pyproject", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-version-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "package.json"),
    [
      "{",
      '  "overrides": { "devEngines": { "runtime": "decoy" } },',
      '  "devEngines": {',
      '    "runtime": [null, { "name": "node", "version": "18.x" }, { "name": "node", "version": "lts" }],',
      '    "packageManager": { "name": "bun", "version": "1.0.29" }',
      "  }",
      "}",
    ].join("\n"),
  );
  await writeFile(join(root, ".mise.toml"), '[tools]\ndeno = "1.46.3"\npython = "latest"\n');
  await writeFile(
    join(root, "environment.yaml"),
    [
      "dependencies:",
      "  - python >=3.8, <3.11",
      "  - python-dateutil",
      "  - python <3.11",
      "  - pip:",
      "      - nose==1.3.7",
    ].join("\n"),
  );

  const npm = await npmDetector.analyze({ root });
  assert.deepEqual(npm.findings.map(({ ruleId, location }) => [ruleId, location.line]).sort(), [
    ["deno.bun.runtime.eol-1.0", 5],
    ["nodejs.runtime.eol-18", 4],
  ]);
  assert.deepEqual(
    npm.unclassified.map(({ reference, location }) => [reference, location.line]),
    [["lts", 4]],
  );
  const result = await scanWithBuiltIns(root, { noCache: true });
  assert.ok(
    result.findings.some(
      ({ ruleId, location }) =>
        ruleId === "deno.runtime.eol-1.x" && location.path === ".mise.toml" && location.line === 2,
    ),
  );
  const python = await pythonDetector.analyze({ root });
  assert.deepEqual(
    python.findings.map(({ ruleId, location }) => [ruleId, location.path, location.line]),
    [
      ["python.runtime.eol-3.9-and-older", "environment.yaml", 2],
      ["python.package.nose.maintenance-only", "environment.yaml", 6],
    ],
  );
  assert.deepEqual(
    python.unclassified.map(({ reference, location }) => [reference, location.line]),
    [
      ["latest", 3],
      ["python <3.11", 4],
    ],
  );
});

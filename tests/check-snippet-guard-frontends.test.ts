import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const modulePath = process.env.OFFING_GUARD_FRONTENDS_MODULE;
const frontendUrl = modulePath
  ? pathToFileURL(modulePath).href
  : new URL("../src/usage/parsers.js", import.meta.url).href;
const { analyzeGuardSymbols }: typeof import("../src/usage/parsers.js") = await import(frontendUrl);

const go = [
  "package example",
  'import ("fmt"; srv "example.org/server/v2"; . `example.org/legacy`; _ "blank/sideeffect")',
  'func demo() { fmt.Println("x"); srv.Legacy(); DotCall(); unrelated.Legacy() }',
  "// srv.SkipComment()",
  'var s = "srv.SkipString()"',
].join("\n");

const java = [
  "package example;",
  "import org.example.Api;",
  "import org.example.tools.*;",
  "import static org.example.Api.run;",
  "import static org.example.Extra.*;",
  "class Demo { void use() {",
  "  org.example.Api.run(); Api.run(); run(); helper();",
  "  Widget.open(); new Widget(); new org.example.Api(); new Api<String>();",
  '  String s = "Api.hidden()"; // Api.hidden();',
  "} }",
].join("\n");

const csharp = [
  "global using Contoso.Api;",
  "using Core = Contoso.Api.Tool;",
  "using static Contoso.Api.Tool;",
  "using Alias = global::Contoso.Api.Tool;",
  "class Demo { void Use() {",
  "  Contoso.Api.Tool.Run(); Core.Run(); Run(); Alias.Run();",
  "  global::Contoso.Api.Tool.Run(); Tool.Run(); new Tool();",
  '  var s = "Core.Hidden()"; // Core.Hidden();',
  "} }",
].join("\n");

test("acc-guard-coverage extracts Go package imports, aliases, selectors and dot calls", async () => {
  const symbols = await analyzeGuardSymbols("example.go", go);
  assert.ok(symbols);
  assert.deepEqual(
    symbols.imports.map(({ kind, module, alias }) => [kind, module, alias]),
    [
      ["alias", "fmt", "fmt"],
      ["alias", "example.org/server/v2", "srv"],
      ["dot", "example.org/legacy", undefined],
      ["blank", "blank/sideeffect", undefined],
    ],
  );
  assert.deepEqual(
    symbols.invocations.map(({ name, candidates, line, column }) => [name, candidates, line, column]),
    [
      ["fmt.Println", ["fmt.Println"], 3, 15],
      ["srv.Legacy", ["example.org/server/v2.Legacy"], 3, 33],
      ["DotCall", ["example.org/legacy.DotCall"], 3, 47],
      ["unrelated.Legacy", [], 3, 58],
    ],
  );
  const ambiguous = await analyzeGuardSymbols("example.go", 'package p\nimport (. "a"; . "b")\nfunc f() { Name() }');
  assert.deepEqual(ambiguous?.invocations[0]?.candidates, []);
});

test("acc-guard-coverage extracts Java static and wildcard imports, qualified calls and constructors", async () => {
  const symbols = await analyzeGuardSymbols("Demo.java", java);
  assert.ok(symbols);
  assert.deepEqual(
    symbols.imports.map(({ kind, module, alias, line }) => [kind, module, alias, line]),
    [
      ["type", "org.example.Api", "Api", 2],
      ["namespace", "org.example.tools", undefined, 3],
      ["static", "org.example.Api.run", "run", 4],
      ["static-wildcard", "org.example.Extra", undefined, 5],
    ],
  );
  assert.deepEqual(
    symbols.invocations.map(({ kind, name, candidates }) => [kind, name, candidates]),
    [
      ["call", "org.example.Api.run", ["org.example.Api.run"]],
      ["call", "Api.run", ["org.example.Api.run"]],
      ["call", "run", ["org.example.Api.run"]],
      ["call", "helper", ["org.example.Extra.helper"]],
      ["call", "Widget.open", ["org.example.tools.Widget.open"]],
      ["construct", "Widget", ["org.example.tools.Widget"]],
      ["construct", "org.example.Api", ["org.example.Api"]],
      ["construct", "Api", ["org.example.Api"]],
    ],
  );
  const ambiguous = await analyzeGuardSymbols(
    "Demo.java",
    "import a.Api; import b.Api; class C { void f(){ Api.run(); } }",
  );
  assert.deepEqual(ambiguous?.invocations[0]?.candidates, []);
});

test("acc-guard-coverage extracts C# global directives, aliases, static imports and member calls", async () => {
  const symbols = await analyzeGuardSymbols("Demo.cs", csharp);
  assert.ok(symbols);
  assert.deepEqual(
    symbols.imports.map(({ kind, module, alias, global, line }) => [kind, module, alias, global, line]),
    [
      ["namespace", "Contoso.Api", undefined, true, 1],
      ["alias", "Contoso.Api.Tool", "Core", undefined, 2],
      ["static-wildcard", "Contoso.Api.Tool", undefined, undefined, 3],
      ["alias", "Contoso.Api.Tool", "Alias", undefined, 4],
    ],
  );
  assert.deepEqual(
    symbols.invocations.map(({ kind, candidates }) => [kind, candidates]),
    [...Array.from({ length: 6 }, () => ["call", ["Contoso.Api.Tool.Run"]]), ["construct", ["Contoso.Api.Tool"]]],
  );
  assert.ok(!symbols.invocations.some(({ name }) => name.includes("Hidden")));
});

const sample = String.raw`
  import fs from "node:fs/promises";
  import { syncBuiltinESMExports } from "node:module";
  import { basename } from "node:path";
  const files = [];
  const original = fs.readFile;
  fs.readFile = (...args) => {
    const filename = String(args[0]);
    if (filename.endsWith(".wasm.b64")) files.push(basename(filename));
    return original(...args);
  };
  syncBuiltinESMExports();
  const [moduleUrl, path, source] = process.argv.slice(1);
  const { analyzeGuardSymbols } = await import(moduleUrl);
  const before = [...files];
  const start = performance.now();
  const first = await analyzeGuardSymbols(path, source);
  const cold = performance.now() - start;
  const loaded = [...files];
  const warmStart = performance.now();
  const again = await analyzeGuardSymbols(path, source);
  console.log(JSON.stringify({ before, loaded, after: files, cold, warm: performance.now() - warmStart, repeated: JSON.stringify(first) === JSON.stringify(again) }));
`;

test("acc-guard-coverage measures cold and warm parsing and loads only the selected grammar", async (t) => {
  const execute = promisify(execFile);
  for (const [grammar, path, source] of [
    ["go", "example.go", go],
    ["java", "Demo.java", java],
    ["csharp", "Demo.cs", csharp],
  ] as const) {
    const { stdout } = await execute(process.execPath, [
      "--input-type=module",
      "-e",
      sample,
      frontendUrl,
      path,
      source,
    ]);
    const result = JSON.parse(stdout);
    assert.deepEqual(result.before, []);
    assert.deepEqual(result.loaded, ["tree-sitter.wasm.b64", `tree-sitter-${grammar}.wasm.b64`]);
    assert.deepEqual(result.after, result.loaded);
    assert.equal(result.repeated, true);
    t.diagnostic(`${grammar} frontend cold ${result.cold.toFixed(2)} ms, warm ${result.warm.toFixed(2)} ms`);
  }
  assert.equal(await analyzeGuardSymbols("package.json", "{}"), undefined);
});

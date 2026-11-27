import { isIsoDate } from "@velella/ebb/registry";
import assert from "node:assert/strict";
import { glob, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import { inspectConfig } from "../src/config-validate.js";
import { ConfigError, KNOWN_CONFIG_KEYS, validateConfig } from "../src/config.js";
import { MAXIMUM_JSON_DEPTH, MAXIMUM_READ_BYTES } from "../src/package-files.js";
import { runCli } from "./cli-runner.js";

const fixture = (file: string) => resolve("tests/fixtures/config-validate", file);

async function repository(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "offing-config-validate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, ".git"), "gitdir: ../elsewhere\n");
  return { root, file: join(root, ".offing.json") };
}

test("config schema and the runtime validator accept and reject the same values", async () => {
  const schema = JSON.parse(await readFile("schemas/config.v1.schema.json", "utf8"));
  const validate = new Ajv2020({ allowUnionTypes: true, ownProperties: true })
    .addFormat("date", isIsoDate)
    .compile(schema);
  assert.deepEqual(new Set(Object.keys(schema.properties)), KNOWN_CONFIG_KEYS);
  const values = [null, false, 9, {}, [], ["dist"], [false], ["ok", " "], "", " ", "dist", "high", "offing.config.v1"];
  const cases = [
    ...values,
    ...Array.from(KNOWN_CONFIG_KEYS).flatMap((key) => values.map((value) => ({ [key]: value }))),
    { failOn: null, "fail-on": "high", baselineFiles: "baseline.json" },
    { failOn: "high", "fail-on": "invalid" },
    { ignore: ["dist"], ignorePaths: ["vendor"], "ignore-paths": null },
    JSON.parse('{"__proto__":true}'),
  ];
  for (const raw of cases) {
    const accepted = validate(raw);
    if (accepted) assert.doesNotThrow(() => validateConfig(raw), JSON.stringify(raw));
    else assert.throws(() => validateConfig(raw), ConfigError, JSON.stringify(raw));
  }
});

test("config validate returns all diagnostics in source order with an exact location and suggestion", async () => {
  const path = fixture("invalid.json");
  const output = await runCli(["config", "validate", path, "--json"]);
  assert.equal(output.code, 2);
  assert.equal(output.stderr, "");
  const result = JSON.parse(output.stdout);
  const schema = JSON.parse(await readFile("schemas/config-validation.v1.schema.json", "utf8"));
  const validateResult = new Ajv2020().compile<Awaited<ReturnType<typeof inspectConfig>>>(schema);
  assert.ok(validateResult(result), JSON.stringify(validateResult.errors));
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.diagnostics.map(({ code, pointer, line, column }) => [code, pointer, line, column]),
    [
      ["invalid-value", "/failOn", 2, 13],
      ["deprecated-key", "/ignorePaths", 3, 3],
      ["invalid-value", "/ignorePaths/1", 3, 30],
      ["invalid-value", "/ignorePaths/2", 3, 33],
      ["unknown-key", "/unknown", 4, 3],
    ],
  );
  assert.equal(result.file, path);
  assert.match(result.diagnostics[1]?.suggestion ?? "", /Use "ignore"/);
  const text = await runCli(["config", "validate", path]);
  assert.equal(text.stdout, "");
  assert.match(text.stderr, /:3:30: error: .*Use a value of type string/);
});

test("config validate discovers a worktree config and reports both legacy keys without failing", async (t) => {
  const { root, file } = await repository(t);
  const child = join(root, "subdir");
  await mkdir(child);
  const missing = await runCli(["config", "validate", "--json"], { cwd: child });
  assert.deepEqual(JSON.parse(missing.stdout), {
    schemaVersion: "offing.config-validation.v1",
    file: null,
    valid: true,
    diagnostics: [],
  });
  assert.equal((await runCli(["config", "validate"], { cwd: child })).stdout, "No Offing config found.\n");
  await writeFile(file, '{\r\n  "ignore-paths": [],\r\n  "ignorePaths": "dist"\r\n}');
  const warning = await runCli(["config", "validate"], { cwd: child });
  assert.equal(warning.code, 0);
  assert.match(warning.stdout, /Valid Offing config/);
  assert.match(warning.stderr, /:2:3: warning: Key "ignore-paths" is deprecated.*Use "ignore"/);
  assert.match(warning.stderr, /:3:3: warning: Key "ignorePaths" is deprecated.*Use "ignore"/);
  const explicit = await runCli(["config", "validate", child, "--json"]);
  assert.equal(JSON.parse(explicit.stdout).file, file);
});

test("config validate handles strict JSON errors, duplicate keys, and escaped JSON Pointers", async (t) => {
  const { file } = await repository(t);
  await writeFile(file, '{\n  "failOn": "high",\n}');
  const syntax = await inspectConfig(file);
  assert.equal(syntax.valid, false);
  assert.equal(syntax.diagnostics[0]?.code, "invalid-json");
  assert.equal(syntax.diagnostics[0]?.line, 3);
  assert.match(syntax.diagnostics[0]?.suggestion ?? "", /trailing comma/);

  await writeFile(file, '{\n  "failOn": "high",\n  "failOn": 19,\n  "x/y~z": {}\n}');
  assert.deepEqual(
    (await inspectConfig(file)).diagnostics.map(({ pointer, line }) => [pointer, line]),
    [
      ["/failOn", 3],
      ["/x~1y~0z", 4],
    ],
  );

  await writeFile(file, "[]");
  assert.match((await inspectConfig(file)).diagnostics[0]?.suggestion ?? "", /object/);
  await writeFile(file, '{"schemaVersion":"wrong"}');
  assert.match((await inspectConfig(file)).diagnostics[0]?.suggestion ?? "", /offing.config.v1/);
});

test("config validate rejects missing, oversized, overly nested and invalid invocations", async (t) => {
  const { root, file } = await repository(t);
  for (const path of [file, root]) {
    assert.equal((await inspectConfig(path)).diagnostics[0]?.code, "unreadable-file");
  }
  await writeFile(file, " ".repeat(MAXIMUM_READ_BYTES + 1));
  assert.equal((await inspectConfig(file)).diagnostics[0]?.code, "input-limit");
  await writeFile(file, "[".repeat(MAXIMUM_JSON_DEPTH + 1) + "]".repeat(MAXIMUM_JSON_DEPTH + 1));
  assert.equal((await inspectConfig(file)).diagnostics[0]?.code, "input-limit");
  for (const args of [[], ["show"], ["validate", "--invalid"], ["validate", "a", "b"]]) {
    const result = await runCli(["config", ...args]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Usage: offing config validate/);
  }
});

test("doctor runs the same located validation and treats deprecations as warnings", async (t) => {
  const { root, file } = await repository(t);
  await writeFile(file, await readFile(fixture("invalid.json")));
  const invalid = await runCli(["doctor", root, "--json"]);
  assert.equal(invalid.code, 1);
  const check = JSON.parse(invalid.stdout).checks.find(({ id }: { id: string }) => id === "config.validation");
  assert.equal(check.status, "fail");
  assert.match(check.details, /:2:13: error:.*failOn/);
  assert.match(check.details, /:4:3: error: Unknown key/);

  await writeFile(file, '{"ignorePaths":[]}');
  const warning = await runCli(["doctor", root]);
  assert.equal(warning.code, 0);
  assert.match(warning.stdout, /\[WARN\] config:/);
  await writeFile(file, "{}");
  assert.match((await runCli(["doctor", root])).stdout, /\[PASS\] config:/);
});

test("all marked documentation config examples and linked example files validate as documented", async function (t) {
  const { file } = await repository(t);
  let count = 0;
  for await (const path of glob(["README.md", "docs/**/*.md", "examples/**/.offing.json"])) {
    const contents = await readFile(path, "utf8");
    if (path.endsWith(".offing.json")) {
      assert.equal((await inspectConfig(path)).valid, true, path);
      continue;
    }
    for (const match of contents.matchAll(
      /<!-- offing-config: (valid|invalid) -->\r?\n```json\r?\n([\s\S]*?)\r?\n```/g,
    )) {
      const [state, json] = match.slice(1);
      if (!json) throw new Error(`Missing example in ${path}`);
      count += 1;
      await writeFile(file, json);
      const result = await runCli(["config", "validate", file, "--json"]);
      assert.equal(result.code, state === "valid" ? 0 : 2, path);
      assert.equal(JSON.parse(result.stdout).valid, state === "valid", path);
    }
  }
  assert.ok(count >= 2);
});

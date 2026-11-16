import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { severityValues } from "../src/domain.js";
import { guardCommand, parseGuardArgs } from "../src/guard.js";
import { runCli } from "./cli-runner.js";

const managers = [
  {
    manager: "npm",
    args: ["i", "--save-dev", "--prefix", "web app"],
    spec: "request@2.88.2",
    purl: "pkg:npm/request",
    version: "2.88.2",
  },
  {
    manager: "pnpm",
    args: ["--filter", "my-app", "add", "--workspace"],
    spec: "request@2.88.2",
    purl: "pkg:npm/request",
    version: "2.88.2",
  },
  {
    manager: "yarn",
    args: ["add", "-D", "--mode=skip-build"],
    spec: "request@2.88.2",
    purl: "pkg:npm/request",
    version: "2.88.2",
  },
  {
    manager: "bun",
    args: ["add", "-D", "--cwd", "web app"],
    spec: "request@2.88.2",
    purl: "pkg:npm/request",
    version: "2.88.2",
  },
  {
    manager: "pip",
    args: ["install", "--target", "web app"],
    spec: "NoSe[extra]==1.3.7",
    purl: "pkg:pypi/nose",
    version: "1.3.7",
  },
  {
    manager: "uv",
    args: ["add", "--group", "dev"],
    spec: "NoSe[extra]==1.3.7; python_version < '0'",
    purl: "pkg:pypi/nose",
    version: "1.3.7",
  },
] as const;

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

async function stubManager(cwd: string, manager: string): Promise<{ PATH: string; GUARD_ARGV_PATH: string }> {
  const argvPath = join(cwd, "args.json");
  const script = join(cwd, "stub.cjs");
  await writeFile(
    script,
    'require("node:fs").writeFileSync(process.env.GUARD_ARGV_PATH, JSON.stringify(process.argv.slice(2)));\nprocess.exitCode = 7;\n',
  );
  if (process.platform === "win32") {
    await writeFile(join(cwd, manager + ".cmd"), '@echo off\r\n"' + process.execPath + '" "' + script + '" %*\r\n');
  } else {
    await writeFile(
      join(cwd, manager),
      "#!/bin/sh\nexec " + shellQuote(process.execPath) + " " + shellQuote(script) + ' "$@"\n',
      { mode: 0o755 },
    );
  }
  return { PATH: [cwd, process.env.PATH].join(delimiter), GUARD_ARGV_PATH: argvPath };
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

for (const { manager, args, spec, purl, version } of managers) {
  test(manager + " refuses a known package, allows its PURL once, and forwards original arguments", async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), "offing guard argv "));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const env = await stubManager(cwd, manager);
    const install = [
      manager,
      ...args,
      spec,
      "--debug",
      "--version",
      "-h",
      "--no-cache",
      "--data-version",
      "manager-value",
    ];
    const blocked = await runCli(["guard", "--data-version", "bundled", ...install], { cwd, env });
    assert.equal(blocked.code, 1, blocked.stderr);
    assert.match(blocked.stderr, /Replacement: .+\nEvidence: https:/);
    await assert.rejects(readFile(env.GUARD_ARGV_PATH), { code: "ENOENT" });

    const allowed = await runCli(["guard", "--allow", purl + "@" + version, ...install], { cwd, env });
    assert.equal(allowed.code, 7, allowed.stderr);
    assert.ok(allowed.stderr.includes("--allow override used for " + purl + "@" + version));
    assert.deepEqual(JSON.parse(await readFile(env.GUARD_ARGV_PATH, "utf8")), install.slice(1));
    assert.equal((await runCli(["guard", ...install], { cwd, env })).code, 1);

    const unknown = manager === "pip" || manager === "uv" ? "offing-unknown[extra]==1.0" : "@offing/unknown@^1.0.0";
    const forwarded = [manager, ...args, unknown, "--version"];
    const passed = spawnSync(process.execPath, [cli, "guard", ...forwarded], {
      cwd,
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    assert.equal(passed.status, 7, passed.stderr);
    assert.match(passed.stderr, /no data for pkg:(npm\/%40offing\/unknown|pypi\/offing-unknown)/);
    assert.deepEqual(JSON.parse(await readFile(env.GUARD_ARGV_PATH, "utf8")), forwarded.slice(1));
  });
}

for (const { manager, args, purl } of managers.slice(0, 4)) {
  test(manager + " parses scoped names and version ranges", () => {
    const spec = "@scope/pkg@^1.2.3";
    const { request } = parseGuardArgs([manager, ...args, spec]);
    assert.deepEqual(
      request.arguments.flatMap((arg) => arg.package ?? []),
      [{ purl: purl.replace("request", "%40scope/pkg"), version: "1.2.3", spec }],
    );
  });
}

test("reads local requirements, their nested includes, extras, pins and hashes for pip and uv", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "offing-guard-requirements-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "nested"));
  const requirements = join(cwd, "test requirements.txt");
  await writeFile(
    requirements,
    '# comment\n--index-url https://example.test\n-r "nested/base.txt"\nOdd_NAME.Extra[dev]>=1\n',
  );
  await writeFile(join(cwd, "nested", "base.txt"), "NoSe[extra]==1.3.7 \\\n --hash=sha256:abc # comment\n");
  for (const args of [
    ["pip", "install", "-r", requirements],
    ["uv", "add", "--requirements=" + requirements],
    ["uv", "add", "-r", "test requirements.txt", "--directory", cwd],
    ["uv", "--directory=" + cwd, "add", "-rtest requirements.txt"],
  ]) {
    const result = await guardCommand(args, { run: () => assert.fail("blocked install ran") });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(
      result.checks.map(({ package: { purl, version } }) => [purl, version]),
      [
        ["pkg:pypi/nose", "1.3.7"],
        ["pkg:pypi/odd-name-extra", undefined],
      ],
    );
    assert.match(result.output, /no data for pkg:pypi\/odd-name-extra/);
  }
  assert.throws(
    () => parseGuardArgs(["pip", "install", "-r", join(cwd, "missing.txt")]),
    /Cannot read requirements file/,
  );
  assert.throws(
    () => parseGuardArgs(["uv", "add", "-r", "https://example.test/requirements.txt"]),
    /local requirements file/,
  );
  assert.throws(() => parseGuardArgs(["pip", "install", "-r"]), /local requirements file/);
});

test("the repository severity controls the gate and --fail-on takes precedence", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "offing-guard-gate-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const env = await stubManager(cwd, "npm");
  const install = ["npm", "install", "request@2.88.2"];
  const blockedAt = new Set(["info", "low", "medium", "high"]);
  for (const failOn of [...severityValues, "none"]) {
    await writeFile(join(cwd, ".offing.json"), JSON.stringify({ failOn }));
    const result = await runCli(["guard", ...install], { cwd, env });
    assert.equal(result.code, blockedAt.has(failOn) ? 1 : 7, failOn + ": " + result.stderr);
  }
  const result = await runCli(["guard", "--fail-on", "high", ...install], { cwd, env });
  assert.equal(result.code, 1, result.stderr);
});

test("a PURL allowance matches only the intended package and version", async () => {
  const install = ["npm", "install", "request@2.88.2", "request@2.88.1"];
  const wrongVersion = await guardCommand(["--allow", "pkg:npm/request@2.88.2", ...install], {
    run: () => assert.fail("blocked install ran"),
  });
  assert.equal(wrongVersion.allowed, false);
  assert.match(wrongVersion.output, /pkg:npm\/request@2\.88\.1/);
  const anyVersion = await guardCommand(["--allow", "pkg:npm/request", ...install], { run: () => 0 });
  assert.equal(anyVersion.allowed, true);
  assert.match(anyVersion.output, /override used for pkg:npm\/request@2\.88\.1/);
  assert.throws(() => parseGuardArgs(["--allow", "request", ...install]), /--allow needs a package URL/);
  assert.throws(() => parseGuardArgs(["--allow", "pkg:npm/request?x=y", ...install]), /--allow needs a package URL/);
  assert.throws(() => parseGuardArgs(["--bogus", ...install]), /Unknown guard option/);
});

test("the refusal snapshot fits in five lines and --verbose shows the remaining evidence", async () => {
  const install = ["npm", "install", "request@2.88.2", "request@2.88.1"];
  const run = () => assert.fail("blocked install ran");
  const compact = await guardCommand(install, { run });
  assert.equal(
    compact.output,
    [
      "offing guard: refused to run npm (2 blocked, --fail-on high).",
      "pkg:npm/request@2.88.2 — request is deprecated",
      "Replacement: Native fetch or a maintained HTTP client",
      "Evidence: https://www.npmjs.com/package/request",
      "Use --allow <purl> or --force before npm to override, or --verbose for details.",
    ].join("\n"),
  );
  assert.equal(compact.output.split("\n").length, 5);
  const verbose = await guardCommand(["--verbose", ...install], { run });
  assert.ok(verbose.output.split("\n").length > 5);
  assert.match(verbose.output, /pkg:npm\/request@2\.88\.1/);
});

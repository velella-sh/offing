import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import type { DoctorResult } from "../src/doctor.js";
import { detectTestPlan } from "../src/test-runners/detect.js";
import { runCli } from "./cli-runner.js";
import { copyFixtureTree } from "./fixture-copies.js";

const fixtureRoots: string[] = [];
after(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true })));
});

const fixture = (tool: string) => copyFixtureTree(resolve("tests/fixtures/test-runners", tool), fixtureRoots);

const commands = {
  npm: [
    ["npm", "ci"],
    ["npm", "run", "build"],
    ["npm", "run", "test"],
  ],
  pnpm: [
    ["pnpm", "install", "--frozen-lockfile"],
    ["pnpm", "run", "build"],
    ["pnpm", "run", "test"],
  ],
  yarn: [
    ["yarn", "install", "--immutable"],
    ["yarn", "run", "build"],
    ["yarn", "run", "test"],
  ],
  pytest: [
    ["python3", "-m", "venv", ".offing-venv"],
    ["./.offing-venv/bin/python", "-m", "pip", "install", "--no-deps", "-r", "requirements.txt"],
    ["./.offing-venv/bin/python", "-m", "pytest"],
  ],
  tox: [["python3", "-m", "tox"]],
  go: [
    ["go", "build", "-mod=readonly", "./..."],
    ["go", "test", "-mod=readonly", "./..."],
  ],
  maven: [
    ["mvn", "-DskipTests", "package"],
    ["mvn", "test"],
  ],
  gradle: [
    ["./gradlew", "assemble"],
    ["./gradlew", "test"],
  ],
  dotnet: [
    ["dotnet", "build", "./fixture.csproj"],
    ["dotnet", "test", "./fixture.csproj"],
  ],
};

for (const [tool, expected] of Object.entries(commands)) {
  test(`detects the ${tool} plan from root metadata`, async () => {
    const plan = await detectTestPlan(await fixture(tool), "linux");
    assert.deepEqual(
      plan.steps.map((step) => step.command),
      expected,
    );
    assert.ok(plan.steps.every((step) => step.tool === tool));
  });
}

test("honors a declared Node manager and keeps installs out of an unlocked plan", async () => {
  const root = await fixture("npm");
  await writeFile(join(root, "pnpm-lock.yaml"), "");
  assert.deepEqual((await detectTestPlan(root)).steps, []);
  await writeFile(join(root, "package.json"), JSON.stringify({ packageManager: "yarn@4.0.0", scripts: { test: "x" } }));
  const plan = await detectTestPlan(root);
  assert.deepEqual(
    plan.steps.map((step) => step.command),
    [["yarn", "run", "test"]],
  );
  assert.match(plan.notes.join(" "), /yarn\.lock/);
  await writeFile(join(root, "package.json"), "invalid JSON");
  assert.match((await detectTestPlan(root)).notes.join(" "), /Fix package\.json/);
  await writeFile(join(root, "package.json"), "[]");
  assert.match((await detectTestPlan(root)).notes.join(" "), /Fix package\.json/);
  await writeFile(join(root, "package.json"), "{}");
  await rm(join(root, "pnpm-lock.yaml"));
  assert.deepEqual((await detectTestPlan(root)).steps, []);
  await writeFile(join(root, "package.json"), '{"scripts":{"test":"check"}}');
  await rm(join(root, "package-lock.json"));
  await writeFile(join(root, "npm-shrinkwrap.json"), "{}");
  assert.deepEqual((await detectTestPlan(root)).steps[0]?.command, ["npm", "ci"]);
});

test("locks Yarn installs when Classic is declared or the major version is unknown", async () => {
  const root = await fixture("yarn");
  await writeFile(join(root, "yarn.lock"), "# yarn lockfile v1\n");
  for (const packageManager of ["yarn@1.22.22", "yarn@4.invalid", undefined]) {
    await writeFile(join(root, "package.json"), JSON.stringify({ packageManager, scripts: { test: "check" } }));
    assert.deepEqual((await detectTestPlan(root)).steps[0]?.command, ["yarn", "install", "--frozen-lockfile"]);
  }
});

test("refuses loose Python requirements and selects native wrapper and solution arguments", async () => {
  const root = await fixture("pytest");
  await writeFile(join(root, "requirements.txt"), "# not a lock\npytest>=8\n");
  await writeFile(join(root, "mvnw.cmd"), "");
  await writeFile(join(root, "pom.xml"), "<project/>");
  await writeFile(join(root, "gradlew.bat"), "");
  await writeFile(join(root, "ignored.csproj"), "");
  await writeFile(join(root, "project with spaces.sln"), "");
  const plan = await detectTestPlan(root, "win32");
  assert.deepEqual(
    plan.steps.filter((step) => step.kind === "test").map((step) => step.command),
    [
      ["python", "-m", "pytest"],
      ["./mvnw.cmd", "test"],
      ["./gradlew.bat", "test"],
      ["dotnet", "test", "./project with spaces.sln"],
    ],
  );
  assert.equal(
    plan.steps.some((step) => step.kind === "install"),
    false,
  );
  await writeFile(join(root, "requirements.txt"), "pytest==8.3.5\n");
  assert.equal((await detectTestPlan(root, "win32")).steps[1]?.command[0], ".offing-venv/Scripts/python.exe");
});

test("uses only regular root markers and bounds files read for detection", {
  skip: process.platform === "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "offing-test-plan-"));
  fixtureRoots.push(root);
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested", "go.mod"), "");
  await symlink(join(root, "nested", "go.mod"), join(root, "go.mod"));
  assert.match((await detectTestPlan(root)).notes.join(" "), /supported project manifest/);
  await writeFile(join(root, "package.json"), " ".repeat(1024 * 1024 + 1));
  assert.match((await detectTestPlan(root)).notes.join(" "), /Fix package\.json/);
  await writeFile(join(root, "pytest.ini"), "");
  assert.equal((await detectTestPlan(root)).steps[0]?.tool, "pytest");
  assert.match((await detectTestPlan(join(root, "missing"))).notes.join(" "), /readable project directory/);
});

test("doctor --tests renders the plan without executing repository scripts", async () => {
  const root = await fixture("npm");
  const sentinel = join(root, "ran");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { test: `node -e "require('fs').writeFileSync('ran', 'yes')"` } }),
  );
  await writeFile(join(root, "project with spaces.sln"), "");
  const { stdout, code } = await runCli(["doctor", root, "--tests"]);
  assert.equal(code, 0);
  assert.match(stdout, /\[npm\] test: npm run test/);
  assert.match(stdout, /dotnet test "\.\/project with spaces\.sln"/);
  await assert.rejects(rm(sentinel), { code: "ENOENT" });
});

test("doctor and Autopilot preview the same configured argv instead of detected commands", async () => {
  const root = await fixture("npm");
  const secret = "offing-test-fixture-only-secret";
  const env = { FIXTURE_TEST_SECRET: secret };
  const commands = [["npm", "run", "check:ci", "--", "file with spaces", secret], ["custom-test"]];
  await writeFile(
    join(root, ".offing.json"),
    JSON.stringify({ autopilot: { tests: commands, secretEnv: Object.keys(env) } }),
  );

  const doctor = await runCli(["doctor", root, "--tests", "--json"], { env });
  assert.equal(doctor.code, 0, doctor.stderr);
  const output: unknown = JSON.parse(doctor.stdout);
  const schema = JSON.parse(await readFile("schemas/doctor.v1.schema.json", "utf8")) as object;
  const validate = new Ajv2020().compile<DoctorResult>(schema);
  assert.ok(validate(output), JSON.stringify(validate.errors));
  const expected = [["npm", "run", "check:ci", "--", "file with spaces", "[REDACTED]"], ["custom-test"]];
  assert.deepEqual(
    output.tests?.steps,
    expected.map((command) => ({ tool: "configured", kind: "test", command })),
  );
  assert.ok(!doctor.stdout.includes(secret));

  const preview = await runCli(["autopilot", root, "--dry-run"], { env });
  assert.equal(preview.code, 0, preview.stderr);
  for (const command of expected) assert.ok(preview.stdout.includes(JSON.stringify(command)));
  assert.doesNotMatch(preview.stdout, /\["npm","(?:ci|run","(?:build|test))"\]/);
  assert.ok(!preview.stdout.includes(secret));

  await writeFile(join(root, ".offing.json"), JSON.stringify({ autopilot: { tests: ["not-argv"] } }));
  const invalid = await runCli(["doctor", root, "--tests", "--json"]);
  assert.equal(invalid.code, 1, invalid.stderr);
  assert.match(invalid.stdout, /\/autopilot\/tests\/0/);
  assert.doesNotMatch(invalid.stdout, /not-argv|"configured"/);
});

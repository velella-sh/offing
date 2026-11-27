import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { FleetHost, FleetRepository } from "../src/fleet/host.js";
import { scanFleet } from "../src/fleet/index.js";
import { simulateFleet } from "../src/what-if/fleet.js";
import { simulateRepository } from "../src/what-if/index.js";
import { renderWhatIf } from "../src/what-if/render.js";
import { coversVersion, excludesVersion, simulationTargets } from "../src/what-if/target.js";
import { runCli } from "./cli-runner.js";

const date = "2026-11-27";
const hostName = "https://github.com";
const validSha = "a".repeat(40);

async function directory(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "offing-what-if-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function lockfile(range: string) {
  return JSON.stringify(
    {
      name: "example",
      lockfileVersion: 3,
      packages: {
        "": { name: "example", dependencies: { library: "1.0.0" } },
        "node_modules/library": { version: "1.0.0", engines: { node: range } },
      },
    },
    null,
    2,
  );
}

async function schema(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(`schemas/${name}.v1.schema.json`, "utf8")) as Record<string, unknown>;
}

test("valid and invalid v1 vectors verify independently of the implementation", async () => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  ajv.addSchema(await schema("more"), "more.v1.schema.json");
  const validate = ajv.compile(await schema("whatif"));
  const vectors = JSON.parse(await readFile("docs/spec/what-if/conformance/vectors.json", "utf8")) as Array<{
    name: string;
    valid: boolean;
    report: unknown;
  }>;
  for (const { name, valid, report } of vectors)
    assert.equal(validate(report), valid, `${name}: ${JSON.stringify(validate.errors)}`);
});

test("numeric version intervals require concrete disproof before an event is removed", () => {
  assert(excludesVersion("vers:semver/>=18.0.0|<19.0.0", "22"));
  assert(!excludesVersion("vers:semver/>=22.10.0|<22.20.0", "22"));
  assert(coversVersion("vers:semver/>=22.0.0|<23.0.0", "22"));
  assert(!coversVersion("vers:semver/>=22.0.0|<23.0.0|!=22.5.0", "22"));
  assert(!excludesVersion("invalid", "22"));
  assert(!coversVersion("invalid", "22"));
  assert.throws(() => simulationTargets([]), /one to eight/);
  assert.throws(() => simulationTargets(["nodejs@22+build"]), /literal/);
  assert.throws(() => simulationTargets(["nodejs@latest"]), /literal/);
});

test("version pins are local, compatibility is separate, and effort is evidence-backed", async (t) => {
  const root = await directory(t);
  await writeFile(join(root, "package.json"), '{"name":"example","dependencies":{"library":"1.0.0"}}\n');
  await writeFile(join(root, "package-lock.json"), lockfile("^18.0.0"));
  await writeFile(join(root, ".nvmrc"), "18\n");
  await writeFile(join(root, ".tool-versions"), "nodejs 18 20\n");
  await writeFile(
    join(root, "Dockerfile"),
    "FROM node:18 AS build\nFROM node:18-alpine3.17\nCOPY --from=build /file /file\n",
  );
  const result = await simulateRepository(root, simulationTargets(["nodejs@24", "nodejs@22", "nodejs@18"]), {
    asOf: date,
    effort: true,
  });
  const [later, scheduled, ended] = result.reports;
  assert(later && scheduled && ended);
  assert.equal(later.verdict, "blocked");
  assert(later.blockers.total > 0);
  assert(later.pins.some((pin) => pin.path === ".nvmrc" && pin.effort?.kind === "automatic"));
  assert(later.pins.some((pin) => pin.field === "FROM" && pin.effort?.kind === "assisted"));
  assert(later.pins.some((pin) => pin.path === ".tool-versions" && pin.effort?.kind === "manual"));
  assert(later.forecast.removed.some((entry) => entry.path === ".nvmrc"));
  assert(later.forecast.retained.some((entry) => entry.path === "Dockerfile" && entry.line === 2));
  assert.equal(scheduled.support.date, "2027-04-30");
  assert(scheduled.forecast.added.some((entry) => entry.date === "2027-04-30"));
  assert.equal(ended.support.status, "ended");
  assert.equal(ended.verdict, "blocked");
  assert.match(renderWhatIf(result, "text"), /blocker: library@1\.0\.0/);
  assert.match(renderWhatIf(result, "markdown"), /^## nodejs@24$/m);
  assert.equal(await readFile(join(root, ".nvmrc"), "utf8"), "18\n");
});

test("historical evaluation compares the recorded target date with a later line", async (t) => {
  const root = await directory(t);
  await writeFile(join(root, ".nvmrc"), "16\n");
  const result = await simulateRepository(root, simulationTargets(["nodejs@18"]), { asOf: "2025-01-01" });
  const [report] = result.reports;
  assert(report);
  assert.equal(report.verdict, "unknown");
  assert.equal(report.support.date, "2025-04-30");
  assert.equal(report.support.next?.date, "2026-04-30");
  assert(report.issues.some((issue) => issue.level === "warning" && issue.reason.includes("2025-04-30")));
});

test("a private registrant sharing the official image name is not a runtime pin", async (t) => {
  const root = await directory(t);
  await writeFile(join(root, "Dockerfile"), "FROM private.example/library/node:18\n");
  const report = await simulateRepository(root, simulationTargets(["nodejs@22"]), { asOf: date });
  assert.equal(report.reports[0]?.pins.length, 0);
  assert.equal(report.reports[0]?.verdict, "unknown");
});

test("pin evidence keeps symbolic links out of simple declarations and workflow roots", async (t) => {
  if (process.platform === "win32") return t.skip("GitHub Windows may disallow user-created symlinks");
  const root = await directory(t);
  const elsewhere = await directory(t);
  await writeFile(join(elsewhere, "pin"), "18\n");
  await symlink(join(elsewhere, "pin"), join(root, ".nvmrc"));
  await mkdir(join(elsewhere, "workflows"));
  await writeFile(
    join(elsewhere, "workflows", "test.yml"),
    "jobs:\n  example:\n    steps:\n      - uses: actions/setup-node@v4\n        with: {node-version: 18}\n",
  );
  await symlink(elsewhere, join(root, ".github"));
  const report = await simulateRepository(root, simulationTargets(["nodejs@22"]), { asOf: date });
  assert.deepEqual(report.reports[0]?.pins, []);
  assert.deepEqual(report.reports[0]?.forecast.removed, []);
});

const entry = (name: string, archived = false): FleetRepository => ({
  name: `org/${name}`,
  defaultBranch: "main",
  archived,
  disabled: false,
  fork: false,
  topics: [],
});

function exampleHost(): FleetHost {
  return {
    origin: hostName,
    listRepositories: async () => [entry("good"), entry("bad"), entry("archive", true)],
    readDefaultBranchHead: async () => validSha,
    async fetchFilesAtCommit(repository, commit, root, selection) {
      assert.equal(commit, validSha);
      assert(selection.includes("package-lock.json"));
      assert(selection.includes("vendor/modules.txt"));
      await writeFile(join(root, "package-lock.json"), lockfile(repository.name.endsWith("good") ? ">=22" : "^18.0.0"));
      return 1;
    },
  };
}

test("records exact-commit readiness through the fleet scan and preserves reasons on offline replay", async () => {
  const targets = simulationTargets(["nodejs@22"]);
  const stored = await scanFleet(exampleHost(), "org", { whatIf: { targets, asOf: date } });
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(await schema("fleet"));
  assert.equal(validate(stored), true, JSON.stringify(validate.errors));
  const result = simulateFleet(stored, targets).reports[0];
  assert(result);
  assert.equal(result.ready[0]?.name, "org/good");
  assert.equal(result.blocked[0]?.name, "org/bad");
  assert.match(result.blocked[0]?.reason ?? "", /excludes Node.js 22/);
  assert.equal(result.ready[0]?.commit, validSha);
  assert.equal(result.unknown[0]?.name, "org/archive");
  assert.equal(result.unknown[0]?.commit, null);
  assert.equal(simulateFleet(stored, simulationTargets(["nodejs@24"])).reports[0]?.unknown.length, 3);
  assert.equal(simulateFleet(stored, targets, "2026-11-28").reports[0]?.unknown.length, 3);
});

test("rejects invalid modes and malformed fleet recordings without weakening forecast's normal modes", async (t) => {
  const root = await directory(t);
  const pathname = join(root, "fleet.json");
  await writeFile(pathname, "{}");
  for (const args of [
    ["--effort"],
    ["--target", "nodejs@22", "--months", "0"],
    ["--target", "nodejs@22", "--format", "ics"],
    ["--fleet", pathname, "--target", "nodejs@22"],
    ["--fleet", pathname, "--target", "nodejs@22", "--effort"],
  ]) {
    assert.equal((await runCli(["forecast", ...args])).code, 2, args.join(" "));
  }
  const original = await runCli(["forecast", root, "--months", "1", "--as-of", date, "--json"]);
  assert.equal(original.code, 0);
  assert.match(original.stdout, /ebb\.forecast\.v1/);
});

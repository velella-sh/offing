import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

import { Ajv2020 } from "ajv/dist/2020.js";
import { type Campaign, readCampaign, readCampaignState } from "../src/campaign/document.js";
import { planCampaign } from "../src/campaign/select.js";
import { scanFleet } from "../src/fleet/index.js";
import { runCli } from "./cli-runner.js";

const captureDay = "2026-11-27";
const host = "https://gitlab.example/code";
const commit = "a".repeat(40);
const ruleId = "nodejs.runtime.eol-18";
const campaign = {
  schemaVersion: "offing.campaign.v1",
  id: "node-upgrade",
  asOf: captureDay,
  batching: { size: 2, concurrency: 1, minGapMinutes: 10, maxFailureRate: 0.25 },
  select: { ruleId },
} satisfies Campaign;
const vectorDir = resolve("docs/spec/campaign/conformance");
const run = promisify(execFile);

async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "offing-campaign-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function row(name: string, day: string | null, owners: string[]) {
  return {
    host,
    name: `project/${name}`,
    commit,
    status: "scanned",
    forecastEvidence: {
      findings: [{ ruleId, deadline: day, owners }],
    },
  };
}

function fleet(rows: unknown[], forecastAsOf = captureDay) {
  return { schemaVersion: "offing.fleet.v1", forecastAsOf, repositoryStatus: rows };
}

test("closest owner deadline orders batches, exclusions take priority and stale observations stay unclassified", () => {
  const early = row("b-early", "2026-12-01", ["@fast/team"]);
  const same = row("a-same-owner", "2027-03-01", ["@fast/team"]);
  const late = row("c-other-owner", "2026-12-20", ["@later/team"]);
  const unowned = row("d-undated", null, []);
  const removed = row("z-excluded", captureDay, ["@fast/team"]);
  const skipped = { ...row("y-skipped", null, []), status: "skipped", commit: null };
  const other = row("z-no-rule", null, []);
  other.forecastEvidence.findings[0]!.ruleId = "ruby.runtime.retired";
  const rows = [unowned, late, early, same, removed, skipped, other];
  const config = { ...campaign, exclude: [`${host}/${removed.name}`] };
  const plan = planCampaign(config, fleet(rows));
  assert.deepEqual(
    plan.repositories.map(({ name, batch }) => [name, batch]),
    [
      [same.name, 1],
      [early.name, 1],
      [late.name, 2],
      [unowned.name, 2],
    ],
  );
  assert.deepEqual(
    plan.omissions.map(({ reason }) => reason),
    ["not-scanned", "excluded", "no-match"],
  );
  assert.deepEqual(planCampaign(config, fleet(rows.slice().reverse())), plan);
  assert.equal(planCampaign(config, fleet(rows, "2026-11-26")).repositories.length, 0);
  assert.deepEqual(
    planCampaign({ ...campaign, include: [early.name] }, fleet(rows)).repositories.map(({ name }) => name),
    [early.name],
  );
  assert.throws(() => planCampaign(campaign, fleet([early, early])), /repeats a repository/);
  assert.throws(() => planCampaign(campaign, {}), /offing.fleet.v1/);
});

test("upgrade selection needs one positive pinned verdict on the campaign day and for the exact target", () => {
  const target = { runtime: "nodejs", version: "22" };
  const targetRow = (name: string, verdict: string, date = captureDay, version = "22") => ({
    ...row(name, null, []),
    whatIfEvidence: { date, targets: [{ ...target, version, verdict }] },
  });
  const output = planCampaign(
    { ...campaign, select: { upgradeTarget: target } },
    fleet([
      targetRow("a-ready", "ready"),
      targetRow("b-blocked", "blocked"),
      targetRow("c-unknown", "unknown"),
      targetRow("d-stale", "ready", "2026-11-26"),
      targetRow("e-other-line", "ready", captureDay, "24"),
      row("f-older-fleet", null, []),
    ]),
  );
  assert.deepEqual(output.target, target);
  assert.deepEqual(
    output.repositories.map(({ name }) => name),
    ["project/a-ready"],
  );
  assert.deepEqual(
    output.omissions.map(({ reason }) => reason),
    ["blocked", "unknown", "missing-evidence", "missing-evidence", "missing-evidence"],
  );
});

test("pinned Fleet capture discovers real codemods and static commands and the CLI only reads the saved files", async (t) => {
  const config = {
    ...campaign,
    select: { release: { product: "nodejs", line: "18" } },
    target: { runtime: "nodejs", version: "22" },
  };
  const directory = await scratch(t);
  const input = join(directory, "fleet.json");
  const configFile = join(directory, "campaign.yml");
  const state = join(directory, "state.json");
  const recording = await scanFleet(
    {
      origin: host,
      listRepositories: async () => [
        { name: "project/example", defaultBranch: "main", archived: false, fork: false, disabled: false, topics: [] },
      ],
      readDefaultBranchHead: async () => commit,
      async fetchFilesAtCommit(_repo, ref, root, filter) {
        assert.equal(ref, commit);
        assert.ok(filter.includes(".nvmrc"));
        assert.ok(filter.includes("requirements.txt"));
        await writeFile(join(root, ".nvmrc"), "18\n");
        await writeFile(join(root, "Dockerfile"), "FROM node:18.1-alpine\n");
        await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "exit 77" } }));
        return 12;
      },
    },
    "project",
    { campaign: true, forecast: { gitlab: true, asOf: captureDay } },
  );
  const schema = new Ajv2020({ strict: false }).compile(
    JSON.parse(await readFile("schemas/fleet.v1.schema.json", "utf8")),
  );
  assert.ok(schema(recording), JSON.stringify(schema.errors));
  const evidence = recording.repositoryStatus[0]?.campaignEvidence;
  assert.deepEqual(evidence?.runtimePins, [
    { runtime: "nodejs", version: "18" },
    { runtime: "nodejs", version: "18.1" },
  ]);
  assert.ok(evidence?.codemods.includes("runtime-pins"));
  assert.deepEqual(evidence.checks, [{ kind: "test", command: ["npm", "run", "test"] }]);
  const narrowerLine = { ...config, select: { release: { product: "nodejs", line: "18.0" } } };
  assert.equal(planCampaign(narrowerLine, recording).repositories.length, 0);
  await writeFile(input, JSON.stringify(recording));
  await writeFile(configFile, JSON.stringify(config));
  const preview = await runCli(["campaign", "plan", configFile, "--fleet", input]);
  assert.equal(preview.code, 0, preview.stderr);
  assert.match(preview.stdout, /Target: nodejs@22/);
  assert.match(preview.stdout, /Codemods: .*runtime-pins/);
  assert.match(preview.stdout, /test: \["npm","run","test"\]/);
  const json = await runCli(["campaign", "plan", configFile, "--fleet", input, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(await readdir(directory), ["campaign.yml", "fleet.json"]);
  await writeFile(state, json.stdout);
  assert.equal((await runCli(["campaign", "status", state, "--json"])).stdout, json.stdout);
  assert.match((await runCli(["campaign", "status", state])).stdout, /queued/);
});

test("campaign validation rejects illegal YAML, state transitions and ambiguous identities", async (t) => {
  const dir = await scratch(t);
  const valid = join(vectorDir, "valid-campaign.json");
  const sample = join(vectorDir, "valid-state.json");
  const config = await readCampaign(valid);
  const state = await readCampaignState(sample);
  await assert.rejects(readCampaign(join(vectorDir, "invalid-campaign.json")), /Invalid campaign/);
  await assert.rejects(readCampaignState(join(vectorDir, "invalid-state.json")), /Invalid campaign state/);
  await assert.rejects(readCampaignState(join(dir, "missing.json")), /readable, regular/);
  const yaml = join(dir, "campaign.yml");
  await writeFile(yaml, "id: &identity example\nschemaVersion: *identity\n");
  await assert.rejects(readCampaign(yaml), /without aliases/);
  await writeFile(yaml, JSON.stringify({ ...config, batching: { ...config.batching, concurrency: 6 } }));
  await assert.rejects(readCampaign(yaml), /concurrency exceeds/);
  await writeFile(
    yaml,
    JSON.stringify({
      ...config,
      select: { upgradeTarget: { runtime: "nodejs", version: "22" } },
      target: { runtime: "nodejs", version: "24" },
    }),
  );
  await assert.rejects(readCampaign(yaml), /differs from its upgrade selector/);
  const result = join(dir, "state.json");
  const repo = state.repositories[0]!;
  await writeFile(
    result,
    JSON.stringify({
      ...state,
      repositories: [
        { ...repo, status: "merged", transitions: [{ from: "review", to: "merged", at: "2026-11-27T12:00:00.000Z" }] },
      ],
    }),
  );
  await assert.rejects(readCampaignState(result), /discontinuous/);
  await writeFile(result, JSON.stringify({ ...state, repositories: [{ ...repo, batch: 2 }] }));
  await assert.rejects(readCampaignState(result), /inconsistent batch/);
  await writeFile(result, JSON.stringify({ ...state, repositories: [repo, repo] }));
  await assert.rejects(readCampaignState(result), /repeats a repository/);
  await writeFile(result, JSON.stringify({ ...state, repositories: [{ ...repo, status: "running" }] }));
  await assert.rejects(readCampaignState(result), /status does not match/);
  await writeFile(
    result,
    JSON.stringify({
      ...state,
      more: {
        truncated: true,
        hint: "read complete state",
        omitted: [],
        estimatedTokens: 100,
      },
    }),
  );
  await assert.rejects(readCampaignState(result), /complete saved document/);
  const timeline = [
    { from: "queued", to: "running", at: "2026-11-27T12:00:00.000Z" },
    { from: "running", to: "verified", at: "2026-11-27T12:01:00.000Z" },
  ];
  const observed = { ...state, repositories: [{ ...repo, status: "verified", transitions: timeline }] };
  await writeFile(result, JSON.stringify(observed));
  assert.deepEqual(await readCampaignState(result), observed);
  timeline.reverse().forEach((event, index) => {
    const [from, to] = index === 0 ? ["queued", "running"] : ["running", "verified"];
    Object.assign(event, { from, to });
  });
  await writeFile(result, JSON.stringify(observed));
  await assert.rejects(readCampaignState(result), /nondecreasing/);
});

test("standalone conformance accepts the published vectors and rejects invalid inputs", async () => {
  const script = join(vectorDir, "check.mjs");
  const schemas = resolve("schemas");
  const config = join(vectorDir, "valid-campaign.json");
  const state = join(vectorDir, "valid-state.json");
  assert.match((await run(process.execPath, [script, config, state, schemas])).stdout, /acc-campaigns/);
  await assert.rejects(run(process.execPath, [script, join(vectorDir, "invalid-campaign.json"), state, schemas]));
  await assert.rejects(run(process.execPath, [script, config, join(vectorDir, "invalid-state.json"), schemas]));
});

test("the campaign admits only repositories marked ready by the pinned Fleet What-If path", async (t) => {
  const target = { runtime: "nodejs", version: "22" };
  const results = await scanFleet(
    {
      origin: host,
      listRepositories: async () =>
        ["ready", "blocked", "unknown"].map((name) => ({
          name: `project/${name}`,
          defaultBranch: "main",
          archived: false,
          fork: false,
          disabled: false,
          topics: [],
        })),
      readDefaultBranchHead: async () => commit,
      async fetchFilesAtCommit(repo, sha, root, filter) {
        assert.equal(sha, commit);
        assert.ok(filter.includes("package-lock.json"));
        assert.ok(filter.includes("requirements.txt"));
        if (repo.name.endsWith("/unknown")) return 0;
        const allowed = repo.name.endsWith("/ready") ? ">=22" : "^18.0.0";
        await writeFile(
          join(root, "package-lock.json"),
          JSON.stringify(
            {
              name: "sample",
              lockfileVersion: 3,
              packages: {
                "": { name: "sample", dependencies: { library: "1.0.0" } },
                "node_modules/library": { version: "1.0.0", engines: { node: allowed } },
              },
            },
            null,
            2,
          ),
        );
        return 1;
      },
    },
    "project",
    { campaign: true, forecast: { gitlab: true, asOf: captureDay }, whatIf: { targets: [target], asOf: captureDay } },
  );
  const root = await scratch(t);
  const fleet = join(root, "fleet.json");
  const config = join(root, "campaign.yml");
  await writeFile(fleet, JSON.stringify(results));
  await writeFile(config, JSON.stringify({ ...campaign, select: { upgradeTarget: target } }));
  const result = await runCli(["campaign", "plan", config, "--fleet", fleet, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).repositories.map(({ name }: { name: string }) => name),
    ["project/ready"],
    JSON.stringify(results.repositoryStatus),
  );
  assert.deepEqual(
    JSON.parse(result.stdout).omissions.map(({ reason }: { reason: string }) => reason),
    ["blocked", "unknown"],
  );
});

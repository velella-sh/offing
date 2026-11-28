import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";

import type { CampaignRepository, CampaignState } from "../src/campaign/document.js";
import type { HostTarget } from "../src/campaign/host-config.js";
import type { FleetHost } from "../src/fleet/host.js";
import { digest } from "../src/proof/document.js";
import { gitLoopback } from "./campaign-host-fixture.js";

const execute = promisify(execFile);
const fixture = resolve("tests/fixtures/campaign-20");
const candidate = process.env.OFFING_CAMPAIGN_CLI ?? resolve("dist/src/cli.js");
const recording = process.env.OFFING_CAMPAIGN_20_RECORD === "1";
if (recording) assert.equal(process.env.OFFING_CAMPAIGN_20, "1");
const targetDate = "2026-11-27";
const gitlabOrigin = "https://gitlab.example.invalid/forge";
const githubOrigin = "https://github.com";
const marker = "synthetic-fixture-campaign-20";
const actor = 86;
const fakeTokens = { OFFING_CAMPAIGN_TOKEN_GITHUB: marker + "-gh", OFFING_CAMPAIGN_TOKEN_GITLAB: marker + "-gl" };
const cleanEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  TZ: "UTC",
  TMPDIR: tmpdir(),
  OFFING_DATA_VERSION: "bundled",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
};

const json = <T>(path: string): Promise<T> => readFile(path, "utf8").then((text) => JSON.parse(text));
const put = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n");
const installed = (module: string) => import(pathToFileURL(join(dirname(candidate), module + ".js")).href);
const git = async (cwd: string, ...argv: string[]) =>
  (
    await execute("git", argv, {
      cwd,
      env: cleanEnv,
      timeout: 30_000,
    })
  ).stdout.trim();

interface Source {
  host: string;
  name: string;
  checkout: string;
  commit: string;
}

interface RecordedProof {
  head: string;
  bundle: string;
  body?: string;
}

interface Evidence {
  board: unknown;
  proofs: Record<string, RecordedProof>;
}

async function workspace(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "offing-campaign-20-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function cli(root: string, clock?: string) {
  return async (...args: string[]) =>
    (
      await execute(process.execPath, [...(clock ? ["--import", clock] : []), candidate, ...args], {
        cwd: root,
        env: cleanEnv,
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
      })
    ).stdout;
}

async function source(root: string, index: number): Promise<Source> {
  const service = "service-" + String(index).padStart(2, "0");
  const host = index % 2 ? githubOrigin : gitlabOrigin;
  const name = (host === githubOrigin ? "example/" : "fixture/") + service;
  const checkout = join(root, service);
  await mkdir(checkout, { recursive: true });
  await mkdir(join(checkout, "tests"));
  await writeFile(join(checkout, "CODEOWNERS"), "* @fixture/" + (index % 3 ? "runtime" : "platform") + "\n");
  await put(join(checkout, "package.json"), {
    name: service,
    version: "1.0.0",
    engines: { node: "18" },
    scripts: { test: "node tests/check.cjs" },
  });
  await put(join(checkout, ".offing.json"), {
    autopilot: { driver: "replay", allowedPaths: ["package.json"], tests: [["node", "tests/check.cjs"]] },
  });
  await writeFile(
    join(checkout, "tests/check.cjs"),
    [
      'const assert = require("node:assert/strict");',
      'const { engines } = require("../package.json");',
      'assert.ok(["18", ">=22"].includes(engines.node));',
      'assert.ok(!Object.keys(process.env).some(key => key.startsWith("OFFING_CAMPAIGN_TOKEN_")));',
      "",
    ].join("\n"),
  );
  await git(checkout, "init", "-q", "--object-format=sha1", "--initial-branch=main", "--template=");
  await git(checkout, "add", ".");
  await execute(
    "git",
    [
      "-c",
      "user.name=Offing Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture: " + service,
    ],
    {
      cwd: checkout,
      env: { ...cleanEnv, GIT_AUTHOR_DATE: targetDate + "T00:00:00Z", GIT_COMMITTER_DATE: targetDate + "T00:00:00Z" },
    },
  );
  return { host, name, checkout, commit: await git(checkout, "rev-parse", "HEAD") };
}

function gitFleet(origin: string, sources: Source[]): FleetHost {
  const refs = new Map(sources.map((item) => [item.name, item]));
  const repository = (name: string) => {
    const source = refs.get(name);
    assert.ok(source);
    return source;
  };
  return {
    origin,
    async listRepositories() {
      return sources.map(({ name }) => ({
        name,
        defaultBranch: "main",
        archived: false,
        disabled: false,
        fork: false,
        topics: [],
      }));
    },
    async readDefaultBranchHead({ name }) {
      return repository(name).commit;
    },
    async fetchFilesAtCommit({ name }, commit, root, filter) {
      const match = repository(name);
      assert.equal(commit, match.commit);
      let bytes = 0;
      for (const path of ["CODEOWNERS", "package.json", ".offing.json"]) {
        if (!filter.includes(path)) continue;
        const { stdout } = await execute("git", ["show", commit + ":" + path], { cwd: match.checkout, env: cleanEnv });
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), stdout);
        bytes += Buffer.byteLength(stdout);
      }
      return bytes;
    },
  };
}

async function plan(root: string, sources: Source[], command: ReturnType<typeof cli>) {
  const { scanFleet } = (await installed("fleet/index")) as typeof import("../src/fleet/index.js");
  const captures = await Promise.all(
    [githubOrigin, gitlabOrigin].map((origin) => {
      const group = sources.filter(({ host }) => host === origin);
      return scanFleet(gitFleet(origin, group), "fixture", {
        jobs: 4,
        campaign: true,
        noCache: true,
        forecast: { asOf: targetDate, gitlab: origin === gitlabOrigin },
      });
    }),
  );
  const fleet = {
    schemaVersion: "offing.fleet.v1",
    forecastAsOf: targetDate,
    repositoryStatus: captures.flatMap(({ repositoryStatus }) => repositoryStatus),
  };
  const fleetFile = join(root, "fleet.json");
  await put(fleetFile, fleet);
  const saved = join(root, "state.json");
  const initial = await command("campaign", "plan", join(fixture, "campaign.json"), "--fleet", fleetFile, "--json");
  await writeFile(saved, initial);
  const state: CampaignState = JSON.parse(initial);
  assert.equal(state.repositories.length, 20);
  assert.ok(state.repositories.every(({ owners }) => owners.length > 0));
  return { saved, state, initial };
}

async function replayInputs(root: string, sources: Source[]) {
  const { scanWithBuiltIns } = (await installed("scan-builtins")) as typeof import("../src/scan-builtins.js");
  return Promise.all(
    sources.map(async ({ host, name, checkout }) => {
      const scan = await scanWithBuiltIns(checkout, { noCache: true });
      const finding = scan.findings.find(
        ({ ruleId, location }) => ruleId === "nodejs.runtime.eol-18" && location.path === "package.json",
      );
      assert.ok(finding, name);
      const manifest = await json<{ engines: { node: string } }>(join(checkout, "package.json"));
      manifest.engines.node = ">=22";
      const turns = join(root, basename(checkout) + "-node22.json");
      await put(turns, {
        schemaVersion: "offing.agent-replay.v1",
        turns: [{ "package.json": JSON.stringify(manifest, null, 2) + "\n" }],
      });
      return { host, name, checkout, recording: turns, finding: finding.id };
    }),
  );
}

async function consumerBatch(root: string, clock: string) {
  const bin = process.env.OFFING_CAMPAIGN_BIN;
  if (!bin) return undefined;
  const name = "offing-campaign.yml";
  const source = resolve(dirname(bin), "../@velella/offing/templates/workflows", name);
  const directory = join(root, ".github/workflows");
  await mkdir(directory, { recursive: true });
  const text = await readFile(source, "utf8");
  await writeFile(join(directory, name), text);
  const workflow = parse(text);
  assert.deepEqual(Object.keys(workflow.on), ["schedule"]);
  assert.deepEqual(workflow.permissions, {});
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const job = workflow.jobs.batch;
  assert.deepEqual(job["runs-on"], ["self-hosted", "linux", "offing-campaign"]);
  assert.match(job.if, /github\.event\.repository\.fork == false/u);
  assert.match(job.if, /github\.event\.repository\.default_branch/u);
  assert.match(job.if, /vars\.OFFING_CAMPAIGN_DIRECTORY != ''/u);
  assert.match(job.if, /vars\.OFFING_CAMPAIGN_VERSION != ''/u);
  assert.equal(job.permissions, undefined);
  assert.equal(job.steps.length, 1);
  const [step] = job.steps;
  assert.equal(step.uses, undefined);
  assert.deepEqual(step.env, {
    OFFING_CAMPAIGN_DIRECTORY: "${{ vars.OFFING_CAMPAIGN_DIRECTORY }}",
    OFFING_CAMPAIGN_VERSION: "${{ vars.OFFING_CAMPAIGN_VERSION }}",
  });
  const version = (await execute(bin, ["--version"], { env: cleanEnv })).stdout.trim();
  const invoke = (directory: string, pinned: string) =>
    execute("bash", ["-euo", "pipefail", "-c", step.run], {
      cwd: root,
      env: {
        ...cleanEnv,
        PATH: dirname(bin) + ":" + cleanEnv.PATH,
        NODE_OPTIONS: "--import=" + pathToFileURL(clock).href,
        OFFING_CAMPAIGN_DIRECTORY: directory,
        OFFING_CAMPAIGN_VERSION: pinned,
      },
      timeout: 180_000,
    }).then(({ stdout }) => stdout);
  const refusal = /Use an absolute campaign directory and install the approved Offing version/u;
  await assert.rejects(invoke(".", version), refusal);
  await assert.rejects(invoke(root, "unexpected-version"), refusal);
  return () => invoke(root, version);
}

async function checkoutLedger(
  t: TestContext,
  root: string,
  command: ReturnType<typeof cli>,
  saved: string,
  state: CampaignState,
  sources: Source[],
  tick: (minutes?: number) => Promise<number>,
  clock: string,
) {
  const inputs = await replayInputs(root, sources);
  const inputPath = join(root, "local.json");
  const omitted = new Set([state.repositories[3]?.name, state.repositories[4]?.name, state.repositories[19]?.name]);
  const run =
    (await consumerBatch(root, clock)) ??
    (() => command("campaign", "run", saved, "--inputs", inputPath, "--one-batch"));
  const read = () => json<CampaignState>(saved);
  t.after(async () => {
    const history = await read().catch(() => undefined);
    for (const { run } of history?.repositories ?? []) {
      if (run) await rm(join(tmpdir(), "offing-autopilot-" + run), { recursive: true, force: true });
    }
  });
  await put(
    inputPath,
    inputs.filter(({ name }) => !omitted.has(name)),
  );
  await command("campaign", "pause", saved);
  assert.match(await run(), /Campaign paused/u);
  await command("campaign", "resume", saved);
  assert.match(await run(), /Batch 1 paused: 2\/5 failed/u);
  const retried = state.repositories[4]?.name;
  assert.ok(retried);
  omitted.delete(retried);
  await put(
    inputPath,
    inputs.filter(({ name }) => !omitted.has(name)),
  );
  await command("campaign", "retry", saved, retried);
  await command("campaign", "resume", saved);
  await tick();
  assert.match(await run(), /Finished batch 1/u);
  assert.match(await run(), /Batch 2 can start after/u);
  for (let batch = 2; batch <= 4; batch++) {
    await tick();
    assert.match(await run(), new RegExp("Finished batch " + batch, "u"));
  }
  assert.equal((await read()).repositories.filter(({ status }) => status === "verified").length, 18);
}

async function publishLedger(
  t: TestContext,
  root: string,
  saved: string,
  sources: Source[],
  tick: (minutes?: number) => Promise<number>,
) {
  const { updateCampaign } = (await installed("campaign/run")) as typeof import("../src/campaign/run.js");
  const { managePublication } = (await installed(
    "campaign/publication",
  )) as typeof import("../src/campaign/publication.js");
  const { createCampaignBranch } = (await installed(
    "campaign/host-git",
  )) as typeof import("../src/campaign/host-git.js");
  const state = await json<CampaignState>(saved);
  const rows = state.repositories.filter(({ status, batch }) => status === "verified" && batch < 4);
  const forges = await Promise.all(
    rows.map(async (row) => {
      const local = sources.find(({ name }) => name === row.name);
      assert.ok(local);
      const lab = row.host === gitlabOrigin;
      const tokenEnv = lab ? "OFFING_CAMPAIGN_TOKEN_GITLAB" : "OFFING_CAMPAIGN_TOKEN_GITHUB";
      const forge = await gitLoopback(t, root, local.checkout, row.commit, fakeTokens[tokenEnv], actor, lab, row.name);
      return { row, forge, tokenEnv };
    }),
  );
  const byName = new Map(forges.map(({ forge }) => [forge.repo, forge]));
  let now = await tick();
  const permissions = {
    campaign: state.id,
    repositories: forges.map(({ row, tokenEnv }) => ({
      host: row.host,
      name: row.name,
      baseBranch: "main",
      actorId: actor,
      tokenEnv,
    })),
  };
  const request = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const lab = url.origin === "https://gitlab.example.invalid";
    assert.ok(lab || url.origin === "https://api.github.com", url.href);
    const pool = forges.filter(({ row }) => (row.host === gitlabOrigin) === lab);
    const user = url.pathname.endsWith("/user");
    const item = user
      ? pool[0]
      : pool.find(({ row }) =>
          url.pathname.startsWith(
            lab ? "/forge/api/v4/projects/" + encodeURIComponent(row.name) : "/repos/" + row.name,
          ),
        );
    assert.ok(item, url.href);
    if (!lab) return item.forge.request(url, init);
    return fetch(new URL(url.pathname + url.search, item.forge.origin), init);
  }) as typeof fetch;
  const options = {
    env: fakeTokens,
    now: () => now,
    request,
    async push(target: HostTarget, checkout: string, base: string, head: string, branch: string) {
      const forge = byName.get(target.repo);
      assert.ok(forge);
      await createCampaignBranch({ ...target, origin: new URL(forge.origin + "/") }, checkout, base, head, branch);
    },
  };
  const action = (name: "publish" | "refresh") =>
    updateCampaign(saved, (current, save) => managePublication(name, current, permissions, save, true, options));
  for (let batch = 1; batch <= 3; batch++) {
    assert.equal(await action("publish"), "Published batch " + batch + ".");
    now = await tick();
  }
  await action("refresh");
  const merge = async ({ forge }: (typeof forges)[number]) => {
    const review = forge.reviews[0];
    assert.ok(review);
    await forge.git("merge-base", "--is-ancestor", "refs/heads/main", review.head);
    await forge.git("update-ref", "refs/heads/main", review.head);
    forge.branches.set("main", review.head);
    assert.equal(await forge.git("rev-parse", "refs/heads/main"), review.head);
    review.status = "merged";
  };
  // A deterministic reviewer leaves several requests open and closes others without merging.
  for (const [index, item] of forges.entries()) {
    assert.deepEqual([item.forge.counts.push, item.forge.counts.create], [1, 1]);
    if (index < 7) await merge(item);
    else if (index < 10) item.forge.reviews[0]!.status = "closed";
  }
  await action("refresh");
  const last = forges.at(-1);
  assert.ok(last);
  assert.equal(
    (await json<CampaignState>(saved)).repositories.find(({ name }) => name === last.row.name)?.status,
    "review",
  );
  now = await tick();
  await merge(last);
  await action("refresh");
  assert.equal(await action("publish"), "No verified campaign repositories are ready to publish.");
  return new Map(forges.map(({ forge }) => [forge.repo, { body: forge.reviews[0]?.body, bare: forge.bare }]));
}

async function storeEvidence(
  root: string,
  saved: string,
  sources: Source[],
  forges: Awaited<ReturnType<typeof publishLedger>>,
  out: string,
) {
  const { readCampaignProof } = (await installed("campaign/proof")) as typeof import("../src/campaign/proof.js");
  const state = await json<CampaignState>(saved);
  const mirror = join(root, "mirror");
  await mkdir(mirror);
  await git(mirror, "init", "--bare", "--template=");
  const proofs: Evidence["proofs"] = {};
  for (const row of state.repositories) {
    const source = sources.find(({ name }) => name === row.name);
    assert.ok(source);
    await git(mirror, "fetch", "--quiet", "--no-tags", source.checkout, row.commit + ":refs/heads/pins/" + row.name);
    if (!row.run) continue;
    const { head, bundle, checkout } = await readCampaignProof(row, fakeTokens);
    await git(mirror, "fetch", "--quiet", "--no-tags", checkout, head + ":refs/heads/results/" + row.name);
    const host = forges.get(row.name);
    if (host) {
      await git(mirror, "fetch", "--quiet", "--no-tags", host.bare, "refs/heads/main:refs/heads/host/" + row.name);
    }
    proofs[row.name] = { head, bundle, ...(host?.body && { body: host.body }) };
  }
  await mkdir(out, { recursive: true });
  await put(join(out, "state.json"), state);
  const { stdout } = await execute("git", ["fast-export", "--all", "--use-done-feature"], {
    cwd: mirror,
    env: cleanEnv,
  });
  await writeFile(join(out, "commits.fi"), stdout);
  const command = cli(root);
  const boardPath = join(root, "board-" + nowKey(out));
  await command("campaign-board", saved, "--out", boardPath);
  const board: unknown = await json(join(boardPath, "_data/summary.json"));
  const evidence = { board, proofs } satisfies Evidence;
  assert.ok(!JSON.stringify(evidence).includes(marker));
  await put(join(out, "evidence.json"), evidence);
}

const nowKey = (value: string) => digest(value).slice(0, 8);

function transitions(row: CampaignRepository) {
  const { run: _run, publication, ...remaining } = row;
  return {
    ...remaining,
    ...(publication && {
      publication: {
        branch: publication.branch,
        baseBranch: publication.baseBranch,
        actorId: publication.actorId,
        number: publication.number,
        observed: publication.observed,
      },
    }),
  };
}

const artifactNames = ["campaign.json", "fleet.json", "plan.json", "state.json", "commits.fi", "evidence.json"];

async function artifactHashes(directory: string) {
  return Object.fromEntries(
    await Promise.all(artifactNames.map(async (file) => [file, digest(await readFile(join(directory, file)))])),
  );
}

async function snapshot(root: string, directory: string, name: string) {
  assert.deepEqual(await json(join(directory, "sha256.json")), await artifactHashes(directory));
  const command = cli(root);
  const plan = await command(
    "campaign",
    "plan",
    join(directory, "campaign.json"),
    "--fleet",
    join(directory, "fleet.json"),
    "--json",
  );
  assert.deepEqual(JSON.parse(plan), await json(join(directory, "plan.json")));
  const file = join(directory, "state.json");
  const state = JSON.parse(await command("campaign", "status", file, "--json")) as CampaignState;
  assert.equal(state.repositories.length, 20);
  const evidence = await json<Evidence>(join(directory, "evidence.json"));
  const mirror = join(root, "inspect-" + name);
  await mkdir(mirror);
  await git(mirror, "init", "--quiet", "--bare", "--template=");
  const source = await readFile(join(directory, "commits.fi"));
  const importing = execute("git", ["fast-import", "--quiet"], { cwd: mirror, env: cleanEnv });
  importing.child.stdin?.end(source);
  await importing;
  const { verifyProof } = (await installed("proof/check")) as typeof import("../src/proof/check.js");
  const revisions = [];
  for (const row of state.repositories) {
    assert.equal(await git(mirror, "rev-parse", "refs/heads/pins/" + row.name), row.commit);
    assert.equal(JSON.parse(await git(mirror, "show", row.commit + ":package.json")).engines.node, "18");
    const result = evidence.proofs[row.name];
    if (!row.run) {
      assert.equal(result, undefined);
      continue;
    }
    assert.ok(result);
    await checkResult(root, name, row, result, mirror, verifyProof);
    revisions.push({ name: row.name, tree: await git(mirror, "rev-parse", result.head + "^{tree}") });
  }
  assert.equal(revisions.length, 18);
  const cliProof = join(root, "proof-" + name, "example/service-01/offing-proof.json");
  assert.match(
    await command("proof", "verify", cliProof, "--repo", mirror),
    /Proof verified against local Git and log evidence/u,
  );
  const board = join(root, "verify-board-" + name);
  await command("campaign-board", file, "--out", board);
  assert.deepEqual(await json(join(board, "_data/summary.json")), evidence.board);
  return {
    plan: JSON.parse(plan),
    state: { ...state, repositories: state.repositories.map(transitions) },
    board: evidence.board,
    revisions,
  };
}

async function checkResult(
  root: string,
  name: string,
  row: CampaignRepository,
  result: RecordedProof,
  mirror: string,
  verifyProof: typeof import("../src/proof/check.js").verifyProof,
) {
  assert.equal(await git(mirror, "rev-parse", "refs/heads/results/" + row.name), result.head);
  assert.equal(JSON.parse(await git(mirror, "show", result.head + ":package.json")).engines.node, ">=22");
  const bundle = JSON.parse(result.bundle) as Record<string, string>;
  const files = join(root, "proof-" + name, row.name);
  await mkdir(files, { recursive: true });
  for (const [path, bytes] of Object.entries(bundle)) {
    assert.match(path, /^(?:offing-proof\.json|offing-log-[a-f0-9]{64}\.txt)$/u);
    await writeFile(join(files, path), bytes);
  }
  await verifyProof(join(files, "offing-proof.json"), mirror);
  const proof = JSON.parse(bundle["offing-proof.json"] ?? "");
  assert.deepEqual(proof.range, { base: row.commit, head: result.head });
  assert.equal(proof.verify.verdict, "passed");
  if (!row.publication) return;
  assert.equal(
    await git(mirror, "rev-parse", "refs/heads/host/" + row.name),
    row.status === "merged" ? result.head : row.commit,
  );
  assert.equal(row.publication.head, result.head);
  assert.equal(row.publication.proofSha256, digest(result.bundle));
  assert.ok(result.body);
  assert.equal(row.publication.bodySha256, digest(result.body));
  const embedded = result.body.match(/^\x60{3}json\n([^\n]+)\n\x60{3}$/mu)?.[1];
  assert.ok(embedded);
  assert.deepEqual(JSON.parse(embedded), bundle);
}

test("the pinned 20-repository campaign has matching Git, proof and board artifacts", {
  skip: recording,
}, async (t) => {
  const actual = await snapshot(await workspace(t), fixture, "recorded");
  const counts = Object.fromEntries(
    ["merged", "closed", "review", "verified", "failed"].map((status) => [
      status,
      actual.state.repositories.filter((row) => row.status === status).length,
    ]),
  );
  assert.deepEqual(counts, { merged: 8, closed: 3, review: 3, verified: 4, failed: 2 });
  const events = actual.state.repositories.flatMap(({ name, transitions }) =>
    transitions.filter(({ to }) => to === "merged").map(({ at }) => ({ at, name })),
  );
  assert.equal(events.sort((a, b) => a.at.localeCompare(b.at)).at(-1)?.name, "fixture/service-10");
  const retried = actual.state.repositories.filter(({ transitions }) =>
    transitions.some(({ from, to }) => from === "failed" && to === "queued"),
  );
  assert.deepEqual(
    retried.map(({ name }) => name),
    ["example/service-09"],
  );
});

test("installed candidate replays the 20-repository Node 18 to 22 fixture", {
  skip: process.env.OFFING_CAMPAIGN_20 !== "1",
}, async (t) => {
  const root = await workspace(t);
  let time = Date.parse(targetDate + "T01:00:00Z");
  const clock = join(root, "clock.mjs");
  const tick = async (minutes = 45) => {
    time += minutes * 60_000;
    await writeFile(clock, "Date.now = () => " + time + ";\n");
    return time;
  };
  await tick(0);
  const command = cli(root, clock);
  const sources = await Promise.all(Array.from({ length: 20 }, (_, index) => source(root, index + 1)));
  const { initial, saved, state } = await plan(root, sources, command);
  await checkoutLedger(t, root, command, saved, state, sources, tick, clock);
  const forges = await publishLedger(t, root, saved, sources, tick);
  const out = recording ? fixture : resolve(process.env.OFFING_CAMPAIGN_20_OUTPUT ?? join(root, "out"));
  await storeEvidence(root, saved, sources, forges, out);
  await writeFile(join(out, "plan.json"), initial);
  await put(join(out, "campaign.json"), await json(join(fixture, "campaign.json")));
  await put(join(out, "fleet.json"), await json(join(root, "fleet.json")));
  await put(join(out, "sha256.json"), await artifactHashes(out));
  const replay = await snapshot(root, out, "replay");
  if (!recording) assert.deepEqual(replay, await snapshot(root, fixture, "reference"));
  console.log(
    "acc-campaigns: 20 pinned repos replayed, 18 proof heads verified, final merge and Campaign Board counts reproduced",
  );
});

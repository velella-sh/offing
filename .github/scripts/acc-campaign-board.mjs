import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";

const [cli, packageDirectory, tools, fixture, demo] = process.argv.slice(2).map((path) => resolve(path));
assert(cli && packageDirectory && tools && fixture, "Expected installed CLI, package directory, site tools and synthetic state");
const run = promisify(execFile);
const work = await mkdtemp(join(tmpdir(), "offing-campaign-board-smoke-"));
const read = (path) => readFile(path, "utf8");
const cleanEnv = { PATH: process.env.PATH };

async function readBuildStep() {
  const workflow = parse(await read(join(packageDirectory, "templates/campaign-board/pages.yml")));
  const { build, deploy } = workflow.jobs;
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
  assert.equal(workflow.on.workflow_call.inputs.from_campaign.default, true);
  assert.deepEqual(workflow.permissions, {});
  assert.equal(workflow.concurrency.queue, "max");
  assert.equal(build.if, "github.ref_type == 'branch' && github.ref_name == github.event.repository.default_branch");
  assert.deepEqual(build.permissions, { actions: "read", contents: "read" });
  assert.equal(deploy.needs, "build");
  assert.deepEqual(deploy.permissions, { pages: "write", "id-token": "write" });

  const checkout = build.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout?.with["persist-credentials"], false);
  const download = build.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"));
  assert.equal(download?.if, "inputs.from_campaign");
  assert.deepEqual(download?.with, { name: "offing-campaign-state", path: "${{ runner.temp }}/campaign-state" });
  const upload = build.steps.find((step) => step.uses?.startsWith("actions/upload-pages-artifact@"));
  assert.equal(upload?.with.path, "${{ runner.temp }}/board-site");
  const install = build.steps.find((step) => step.name === "Install locked tools");
  assert.equal(install?.run, "npm ci --ignore-scripts --no-audit --no-fund");

  const step = build.steps.find((step) => step.name === "Build the board");
  assert.deepEqual(step.env, { FROM_CAMPAIGN: "${{ inputs.from_campaign }}", REPOSITORY: "${{ github.repository }}" });
  assert.equal(typeof step.run, "string");
  return step.run;
}

async function verifyDispatch() {
  const invoke = (args) => run(process.execPath, [cli, ...args], { cwd: work, timeout: 15_000, env: cleanEnv });
  await assert.rejects(invoke(["fleet"]), (error) => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /Usage: offing fleet <organization\|group>/);
    return true;
  });
  await verifyLedger(invoke, fixture, "compact");
  if (demo) {
    const board = await verifyLedger(invoke, demo, "twenty");
    const [summary] = JSON.parse(await read(join(board, "_data/summary.json")));
    assert.deepEqual(
      [summary.total, summary.merged, summary.awaitingReview],
      [20, 8, 3],
    );
  }
}

async function verifyLedger(invoke, file, name) {
  const { stdout } = await invoke(["campaign", "status", file, "--json"]);
  assert.deepEqual(JSON.parse(stdout), JSON.parse(await read(file)));
  const source = join(work, "export-" + name);
  await invoke(["campaign-board", file, "--out", source]);
  assert.equal((await readdir(source, { recursive: true })).some((path) => /\.(html|css)$/i.test(path)), false);
  await run(process.execPath, [
    join(tools, "@velella/mizzen/bin/mizzen.js"), "check", source, "--theme", join(tools, "@velella/lateen"),
  ], { cwd: work, timeout: 60_000, env: cleanEnv });
  return source;
}

async function assertBoard(site, base) {
  const page = await read(join(site, "index.html"));
  assert.match(page, /<span class="status-label">Awaiting review<\/span>/);
  assert.match(page, /class="stat-strip"/);
  assert.match(page, /Recorded batch activity/);
  assert.match(page, /2026-11-27 UTC/);
  assert.match(page, /example\/service/);
  assert.match(page, /@example\/operations/);
  assert.match(page, /Operations &lt;review&gt;/);
  assert.match(page, /Repository progress/);
  const stylesheet = /<link[^>]+href="([^"]+\.css)"/.exec(page)?.[1];
  assert.ok(stylesheet?.startsWith(base), `Expected a theme asset under ${base}, found ${stylesheet}`);
  if (base === "/") assert.ok(!stylesheet.startsWith("/example.github.io/"));
  const badge = await read(join(site, "campaign-progress.svg"));
  assert.match(badge, /aria-label="campaign: 1\/4 merged"/);
}

async function replayBuild(script, name, repository, fromCampaign, base) {
  const directory = join(work, `${name} operations`);
  const runner = join(work, `${name} runner`);
  const bin = join(directory, "node_modules/.bin");
  const scope = join(directory, "node_modules/@velella");
  await mkdir(bin, { recursive: true });
  await mkdir(scope, { recursive: true });
  await mkdir(join(runner, "campaign-state"), { recursive: true });
  await symlink(cli, join(bin, "offing"));
  await symlink(join(tools, ".bin/mizzen"), join(bin, "mizzen"));
  await symlink(join(tools, "@velella/lateen"), join(scope, "lateen"));
  const localState = join(directory, "state.json");
  if (fromCampaign) {
    await writeFile(localState, "{}\n");
    await copyFile(fixture, join(runner, "campaign-state/state.json"));
  } else {
    await copyFile(fixture, localState);
  }
  await run("bash", ["-c", script], {
    cwd: directory,
    env: { ...cleanEnv, RUNNER_TEMP: runner, FROM_CAMPAIGN: fromCampaign, REPOSITORY: repository },
    timeout: 60_000,
  });
  await assertBoard(join(runner, "board-site"), base);
}

try {
  await verifyDispatch();
  const script = await readBuildStep();
  await replayBuild(script, "manual", "example/operations", "", "/operations/");
  await replayBuild(script, "artifact", "example/example.github.io", "true", "/");
  console.log("acc-campaign-board: installed command dispatch, template manual and artifact builds, native render and badge passed");
} finally {
  await rm(work, { recursive: true, force: true });
}

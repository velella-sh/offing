import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";

import { runActionAutopilot } from "../src/action-autopilot.js";
import { createReplayDriver } from "../src/agent-drivers/replay.js";
import { verifyProof } from "../src/proof/check.js";
import { checkedProof } from "../src/proof/document.js";
import { runApprovedTest, type TestLogFilter } from "../src/test-runners/run.js";

const exec = promisify(execFile);
const installed = process.env.OFFING_AUTOPILOT_ACTION_BUNDLE;
const repository = "fixture/consumer";
const branch = "offing/autopilot/0";
const url = "https://example.invalid/fixture/consumer/pull/1";
const apiToken = "fixture-api-token";
const secret = "fixture-private-stdout";
const command = ["node", "tests/check.cjs"] as const;
const manifest = { name: "autopilot-consumer", scripts: { test: command.join(" ") } };
const migration = { "package.json": JSON.stringify(manifest) + "\n" };
const green = { ...migration, "tests/state": "green\n" };
const red = { ...migration, "tests/state": "red\n" };

const git = async (root: string, ...args: string[]) => (await exec("git", args, { cwd: root })).stdout.trim();
const commit = (root: string, name: string, message: string) =>
  git(
    root,
    "-c",
    `user.name=${name}`,
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-am",
    message,
  );

function result(state: string) {
  const failed = state === "red";
  const failure = failed ? '<failure message="fixture is still red"/>' : "";
  const reports = [`<testsuite><testcase name="fixture" file="tests/check.cjs">${failure}</testcase></testsuite>`];
  return { exitCode: failed ? 1 : 0, reports };
}

async function sourceTests(tree: string, deadline: number, filter?: TestLogFilter) {
  const status = result((await readFile(join(tree, "tests/state"), "utf8")).trim());
  return [
    await runApprovedTest(
      command,
      async (_argv, output) => {
        output.stdout(Buffer.from(secret.slice(0, 7)));
        output.stdout(Buffer.from(secret.slice(7)));
        return status;
      },
      1000,
      deadline,
      filter,
    ),
  ];
}

const check = `
const assert = require("node:assert/strict");
const fs = require("node:fs");
for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "OFFING_ACTION_AUTOPILOT_KEY", "FIXTURE_SECRET"])
  assert.equal(process.env[name], undefined);
assert.equal(process.getuid(), 65532);
assert.equal(fs.existsSync(".git"), false);
const { reports, exitCode } = (${result.toString()})(fs.readFileSync("tests/state", "utf8").trim());
fs.writeFileSync("junit.xml", reports[0]);
console.log(${JSON.stringify(secret)});
process.exitCode = exitCode;
`;

type Pull = {
  body: string;
  draft: boolean;
  state: "open" | "closed";
  title: string;
};

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString()) as Partial<Pull> & {
    query?: string;
    head?: string;
    base?: string;
  };
}

async function mockGitHub(t: TestContext) {
  const calls: string[] = [];
  const references = {
    number: 1,
    node_id: "PR_fixture",
    html_url: url,
    user: { login: "github-actions[bot]" },
    head: { ref: branch, repo: { full_name: repository } },
  };
  let pull: Pull | undefined;
  const handle = async (req: IncomingMessage) => {
    assert.equal(req.headers.authorization, `Bearer ${apiToken}`);
    const endpoint = new URL(req.url ?? "", "http://127.0.0.1");
    const request = `${req.method} ${endpoint.pathname}`;
    calls.push(request);
    if (request === `GET /repos/${repository}/pulls`) {
      assert.equal(endpoint.searchParams.get("head"), `fixture:${branch}`);
      return pull ? [{ ...pull, ...references }] : [];
    }
    if (request === `POST /repos/${repository}/pulls`) {
      assert.equal(pull, undefined, "re-runs must not create another pull request");
      const payload = await body(req);
      assert.equal(payload.head, branch);
      assert.equal(payload.base, "main");
      pull = { state: "open", draft: payload.draft ?? false, body: payload.body ?? "", title: payload.title ?? "" };
      return { ...pull, ...references };
    }
    assert.ok(pull);
    if (request === `PATCH /repos/${repository}/pulls/1`) {
      Object.assign(pull, await body(req));
      return { ...pull, ...references };
    }
    if (request === "POST /graphql") {
      const mutation = (await body(req)).query?.includes("convertPullRequestToDraft")
        ? "convertPullRequestToDraft"
        : "markPullRequestReadyForReview";
      pull.draft = mutation === "convertPullRequestToDraft";
      return { data: { [mutation]: { pullRequest: { isDraft: pull.draft } } } };
    }
    assert.equal(request, `POST /repos/${repository}/issues/1/comments`);
    return {};
  };
  const server = createServer((req, res) => {
    void handle(req).then(
      (response) => res.end(JSON.stringify(response)),
      (error: unknown) => {
        res.statusCode = 500;
        res.end(String(error));
      },
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { api: `http://127.0.0.1:${address.port}`, calls, pull: () => pull };
}

async function cleanAction(folder: string) {
  if (!installed) return undefined;
  const candidate = join(folder, "action");
  await mkdir(join(candidate, "dist"), { recursive: true });
  await cp(resolve("action.yml"), join(candidate, "action.yml"));
  await cp(dirname(resolve(installed)), join(candidate, "dist/action"), { recursive: true });
  await cp(resolve("schemas"), join(candidate, "schemas"), { recursive: true });
  return join(candidate, "dist/action/index.js");
}

async function consumerEnvironment(path: string) {
  const action = parse(await readFile(path, "utf8")) as {
    inputs: Record<string, { default?: string }>;
    runs: { steps: { id?: string; env?: Record<string, string> }[] };
  };
  const mappings = action.runs.steps.find(({ id }) => id === "scan")?.env;
  assert.ok(mappings);
  return (inputs: Record<string, string>) => {
    const env: NodeJS.ProcessEnv = {};
    for (const [variable, expression] of Object.entries(mappings)) {
      const field = /^\$\{\{ inputs\.([a-z-]+) \}\}$/u.exec(expression)?.[1];
      if (field && action.inputs[field]) env[variable] = inputs[field] ?? action.inputs[field].default;
    }
    return env;
  };
}

async function cleanup(root: string, folder: string) {
  const listing = await git(root, "worktree", "list", "--porcelain").catch(() => "");
  for (const line of listing.split("\n")) {
    if (!line.startsWith("worktree ") || !/\/offing-autopilot-[\w]+\/checkout$/u.test(line)) continue;
    const tree = line.slice("worktree ".length);
    await git(root, "worktree", "remove", "--force", tree);
    await rm(dirname(tree), { recursive: true, force: true });
  }
  await rm(folder, { recursive: true, force: true });
}

async function seedRepo(root: string, bare: string) {
  await mkdir(join(root, "tests"), { recursive: true });
  await mkdir(join(root, "replays"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ ...manifest, dependencies: { request: "2.88.2" } }) + "\n",
  );
  await writeFile(
    join(root, ".offing.json"),
    JSON.stringify({ autopilot: { tests: [command], secretEnv: ["FIXTURE_SECRET"] } }),
  );
  await writeFile(join(root, "tests/check.cjs"), check);
  await writeFile(join(root, "tests/state"), "baseline\n");
  for (const [name, turns] of Object.entries({
    green: [green],
    red: [red],
    budget: [red, { "tests/state": "green\n" }],
  })) {
    await writeFile(
      join(root, `replays/${name}.json`),
      JSON.stringify({ schemaVersion: "offing.agent-replay.v1", turns }),
    );
  }
  await git(root, "init", "--quiet", "--initial-branch=main");
  await git(root, "add", ".");
  await commit(root, "Fixture", "Seed trusted fixture");
  await git(root, "init", "--bare", bare);
  await git(root, "remote", "add", "origin", bare);
  await git(root, "push", "-q", "origin", "main");
}

async function fixture(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), "offing-action-replay-test-"));
  const root = join(folder, "consumer");
  const bare = join(folder, "origin.git");
  const event = join(folder, "event.json");
  t.after(() => cleanup(root, folder));
  await seedRepo(root, bare);
  const mock = await mockGitHub(t);
  const bundle = await cleanAction(folder);
  const consumer = await consumerEnvironment(bundle ? join(folder, "action/action.yml") : resolve("action.yml"));
  const payload = { repository: { fork: false, default_branch: "main", full_name: repository } };
  await writeFile(event, JSON.stringify(payload));
  let sequence = 0;
  async function run(variant = "green", extras: NodeJS.ProcessEnv = {}, reject?: RegExp) {
    const output = join(folder, `output-${++sequence}`);
    const summary = join(folder, `summary-${sequence}`);
    const inputs = consumer({
      autopilot: "true",
      agent: "replay",
      "autopilot-recording": `replays/${variant}.json`,
      "github-token": apiToken,
      ...Object.fromEntries(
        Object.entries(extras)
          .filter(([name, value]) => name.startsWith("INPUT_") && value !== undefined)
          .map(([name, value]) => [name.slice("INPUT_".length).toLowerCase(), value]),
      ),
    });
    const env = {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      OFFING_DATA_VERSION: "bundled",
      ...inputs,
      FIXTURE_SECRET: secret,
      RUNNER_TEMP: folder,
      GITHUB_WORKSPACE: root,
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: await git(root, "rev-parse", "HEAD"),
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: repository,
      GITHUB_API_URL: mock.api,
      GITHUB_GRAPHQL_URL: mock.api + "/graphql",
      GITHUB_SERVER_URL: "https://example.invalid",
      GITHUB_RUN_ID: "123",
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      ...Object.fromEntries(Object.entries(extras).filter(([name]) => !name.startsWith("INPUT_"))),
    };
    const operation = bundle
      ? exec(process.execPath, [bundle], { cwd: root, env, timeout: 120_000 }).catch((error: unknown) => {
          if (error && typeof error === "object" && "stdout" in error)
            throw new Error(String(error.stdout), { cause: error });
          throw error;
        })
      : runActionAutopilot(env, sourceTests, createReplayDriver);
    if (reject) await assert.rejects(operation, reject);
    else await operation;
    const outputs = (await readFile(output, "utf8").catch(() => "")).split("\n").filter(Boolean);
    outputs.reverse();
    const get = (name: string) => outputs.find((line) => line.startsWith(name + "="))?.slice(name.length + 1);
    return { get, summary: await readFile(summary, "utf8").catch(() => "") };
  }
  const remoteHead = () => git(root, "ls-remote", "origin", `refs/heads/${branch}`);
  return { root, bare, event, payload, mock, run, remoteHead };
}

async function checkProof(output: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["run"]>>, root: string) {
  const directory = output.get("autopilot-artifact-path");
  assert.ok(directory);
  const path = join(directory, "offing-proof.json");
  const raw = await readFile(path, "utf8");
  await verifyProof(path, root);
  const proof = await checkedProof(JSON.parse(raw));
  for (const name of await readdir(directory)) {
    assert.doesNotMatch(await readFile(join(directory, name), "utf8"), /fixture-(private-stdout|api-token)/u);
  }
  const exportPath = process.env.OFFING_AUTOPILOT_FIXTURE_EVIDENCE;
  if (exportPath) await cp(directory, join(exportPath, proof.outcome), { recursive: true, errorOnExist: true });
  return { raw, proof };
}

test("acc-autopilot-action rejects PR and fork events before the driver or publisher starts", async (t) => {
  const project = await fixture(t);
  for (const event of ["pull_request", "pull_request_target", "push"]) {
    await project.run(
      "green",
      { GITHUB_EVENT_NAME: event, INPUT_AGENT: "unsupported" },
      /requires an explicit workflow_dispatch or schedule/u,
    );
  }
  await writeFile(project.event, JSON.stringify({ repository: { ...project.payload.repository, fork: true } }));
  await project.run("green", { GITHUB_EVENT_NAME: "schedule", INPUT_AGENT: "unsupported" }, /non-fork repository/u);
  assert.deepEqual(project.mock.calls, []);
  assert.equal(await git(project.root, "branch", "--list", "offing/autopilot/*"), "");
});

test("acc-autopilot-action creates one green wave, updates it on schedule, and closes it when empty", async (t) => {
  const project = await fixture(t);
  const first = await project.run();
  assert.equal(first.get("autopilot-pr-urls"), JSON.stringify([url]));
  assert.equal(project.mock.pull()?.draft, false);
  const evidence = await checkProof(first, project.root);
  assert.match(project.mock.pull()?.body ?? "", /Workflow proof and test logs/u);
  assert.ok(project.mock.pull()?.body.includes(evidence.raw));
  assert.equal(evidence.proof.outcome, "done");
  assert.match(await project.remoteHead(), new RegExp(evidence.proof.range.head, "u"));
  await project.run("green", { GITHUB_EVENT_NAME: "schedule" });
  assert.equal(project.mock.calls.filter((line) => line.startsWith("POST") && line.endsWith("/pulls")).length, 1);
  await writeFile(join(project.root, "package.json"), migration["package.json"]);
  await commit(project.root, "Fixture", "Resolve the selected lifecycle finding");
  await git(project.root, "push", "origin", "main");
  const empty = await project.run();
  assert.equal(project.mock.pull()?.state, "closed");
  assert.match(empty.summary, /Pull request — closed #1/u);
  assert.equal(await git(project.root, "status", "--porcelain"), "");
});

test("acc-autopilot-action skips red by default, publishes a draft on opt-in and promotes only verified edits", async (t) => {
  const project = await fixture(t);
  const skipped = await project.run("red", {}, /recording-exhausted/u);
  assert.match(skipped.summary, /Red wave skipped/u);
  assert.equal(skipped.get("autopilot-pr-urls"), "[]");
  assert.equal(project.mock.pull(), undefined);
  const draft = await project.run("red", { "INPUT_AUTOPILOT-OPEN-RED": "true" }, /recording-exhausted/u);
  assert.equal(project.mock.pull()?.draft, true);
  assert.equal(draft.get("autopilot-pr-urls"), JSON.stringify([url]));
  const { proof } = await checkProof(draft, project.root);
  assert.equal(proof.verify.verdict, "failed");
  assert.match(project.mock.pull()?.body ?? "", /fixture is still red/u);
  await project.run();
  assert.equal(project.mock.pull()?.draft, false);
  await project.run("red", { "INPUT_AUTOPILOT-OPEN-RED": "true" }, /recording-exhausted/u);
  assert.equal(project.mock.pull()?.draft, true);
});

test("acc-autopilot-action reports the applied turn cap and keeps a later human commit", async (t) => {
  const project = await fixture(t);
  const capped = await project.run("budget", { "INPUT_AUTOPILOT-TURNS": "1" }, /run.turns/u);
  assert.match(capped.summary, /Budget used — \d+ ms, 1 turns, 0 tokens, 0 cost cents/u);
  assert.match(capped.summary, /Run limit — 300000 ms, 1 turns/u);
  await project.run();
  const temp = await mkdtemp(join(tmpdir(), "offing-human-commit-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await git(temp, "clone", "-q", "--branch", branch, project.bare, ".");
  await writeFile(join(temp, "tests/state"), "human edit\n");
  await commit(temp, "Human", "Review edits");
  await git(temp, "push", "origin", branch);
  const prior = await project.remoteHead();
  const protectedRun = await project.run();
  assert.match(protectedRun.summary, /Pull request — protected/u);
  assert.equal(await project.remoteHead(), prior);
  assert.ok(project.mock.calls.includes(`POST /repos/${repository}/issues/1/comments`));
});

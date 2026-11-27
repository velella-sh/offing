import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

import { parse as parseYaml } from "yaml";

import { publishFixPullRequest } from "../src/action-fix-pr.js";
import type { FixPullRequestOutcome, FixPullRequestTarget } from "../src/action-fix-pr.js";
import { builtInDetectors } from "../src/detectors/index.js";
import type { ScanResult } from "../src/domain.js";
import { scanRepository } from "../src/engine/index.js";
import { VERIFY_RESULT_ARTIFACT } from "../src/verify-result.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function scratch(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

const WORKFLOW = "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n";

/** A repository with one finding the fixes branch can repair, plus a bare `origin` so the push stays local. */
async function repositoryWithFinding(): Promise<{ root: string; remote: string }> {
  const root = await scratch("offing-fix-pr-");
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await writeFile(join(root, ".github", "workflows", "ci.yml"), WORKFLOW);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "demo", engines: { node: "24" } }));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "offing@example.com"]);
  git(root, ["config", "user.name", "Offing test"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "init"]);

  const remote = join(await scratch("offing-fix-pr-remote-"), "remote.git");
  execFileSync("git", ["init", "--bare", "-q", remote]);
  git(root, ["remote", "add", "origin", remote]);
  return { root, remote };
}

interface PullRequestState {
  number: number;
  state: "open" | "closed";
  merged_at?: string | null;
}

interface RecordedCall {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

/** Answers the pulls API in memory and records every request, so the tests never open a socket. */
function stubGitHub(initial: PullRequestState[] = []): { calls: RecordedCall[]; restore: () => void } {
  const calls: RecordedCall[] = [];
  let pulls = initial.map((pull) => ({
    ...pull,
    head: { ref: "offing/fixes" },
    html_url: `https://github.com/o/r/pull/${pull.number}`,
  }));
  let next = 7;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>);
    calls.push({ method, path: `${url.pathname}${url.search}`, ...(body === undefined ? {} : { body }) });
    if (method === "GET") return Response.json(pulls);
    if (method === "POST" && url.pathname.endsWith("/pulls")) {
      const pull = {
        number: next,
        state: "open" as const,
        head: { ref: "offing/fixes" },
        html_url: `https://github.com/o/r/pull/${next}`,
      };
      next += 1;
      pulls = [pull, ...pulls];
      return Response.json(pull);
    }
    if (method === "POST") return Response.json({});
    if (method === "PATCH") {
      const number = Number(url.pathname.split("/").pop());
      const changes = (body ?? {}) as Partial<Pick<(typeof pulls)[number], "state">>;
      pulls = pulls.map((pull) => (pull.number === number ? { ...pull, ...changes } : pull));
      return Response.json({});
    }
    throw new Error(`unexpected ${method} ${url}`);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

function target(root: string): FixPullRequestTarget {
  return { root, repository: "o/r", token: "t", apiUrl: "https://api.github.com", baseBranch: "main" };
}

test("the first run opens one pull request with every fix and a second run updates the same one", async () => {
  const { root, remote } = await repositoryWithFinding();
  const before = await scanRepository(root, builtInDetectors);
  assert.equal(before.findings.length, 1);
  const evidence = before.findings[0]!.sources[0]!.url;
  const github = stubGitHub();
  try {
    const artifacts = await scratch("offing-fix-artifacts-");
    const options = { ...target(root), labels: ["offing", "lifecycle"], artifactRoot: artifacts };
    const first = await publishFixPullRequest(before, options);
    assert.equal(first.status, "opened");
    assert.equal(first.number, 7);
    assert.equal(first.fixes, 1);
    assert.match(
      execFileSync("git", ["--git-dir", remote, "show-ref", "refs/heads/offing/fixes"], { encoding: "utf8" }),
      /refs\/heads\/offing\/fixes/,
    );

    assert.ok(first.artifactPath);
    const result = JSON.parse(await readFile(join(first.artifactPath, VERIFY_RESULT_ARTIFACT), "utf8"));
    assert.equal(result.schemaVersion, "offing.verify-result.v1");
    assert.equal(result.counts.resolved, 1);
    assert.match(await readFile(join(first.artifactPath, "offing-fix.patch"), "utf8"), /actions\/checkout/);
    const created = github.calls.filter((call) => call.method === "POST" && call.path.endsWith("/pulls"));
    assert.equal(created.length, 1);
    assert.equal(created[0]!.path, "/repos/o/r/pulls");
    assert.equal(created[0]!.body?.head, "offing/fixes");
    assert.equal(created[0]!.body?.base, "main");
    const body = String(created[0]!.body?.body);
    assert.match(body, /\| .+ \| `\.github\/workflows\/ci\.yml:4` \| \[.+\]\(.+\) \|/);
    assert.ok(body.includes(evidence), "the body links the evidence the finding cites");

    // The next scheduled run checks the default branch out again, still without the fix.
    git(root, ["checkout", "-q", "main"]);
    const again: ScanResult = await scanRepository(root, builtInDetectors);
    const second: FixPullRequestOutcome = await publishFixPullRequest(again, options);
    assert.equal(second.status, "updated");
    assert.equal(second.number, first.number);
    assert.equal(
      github.calls.filter((call) => call.path.endsWith("/pulls") && call.method === "POST").length,
      1,
      "no second pull request",
    );
    assert.deepEqual(
      github.calls.filter((call) => call.path.endsWith("/labels")).map((call) => call.body),
      [{ labels: ["offing", "lifecycle"] }, { labels: ["offing", "lifecycle"] }],
    );
    assert.equal(github.calls.filter((call) => call.method === "PATCH").length, 1);
  } finally {
    github.restore();
  }
});

test("a run with nothing to fix opens no pull request and closes the one it left open", async () => {
  const { root } = await repositoryWithFinding();
  await rm(join(root, ".github", "workflows", "ci.yml"));
  const result = await scanRepository(root, builtInDetectors);
  assert.equal(result.findings.length, 0);

  const quiet = stubGitHub();
  try {
    const done = await publishFixPullRequest(result, target(root));
    assert.equal(done.status, "nothing");
    assert.deepEqual(
      quiet.calls.map((call) => call.method),
      ["GET"],
    );
  } finally {
    quiet.restore();
  }

  const github = stubGitHub([{ number: 9, state: "open" }]);
  try {
    const done = await publishFixPullRequest(result, target(root));
    assert.equal(done.status, "closed");
    assert.equal(done.number, 9);
    const closed = github.calls.find((call) => call.method === "PATCH");
    assert.equal(closed?.path, "/repos/o/r/pulls/9");
    assert.equal(closed?.body?.state, "closed");
  } finally {
    github.restore();
  }
});

test("a closed pull request is reopened when fixes come back", async () => {
  const { root } = await repositoryWithFinding();
  const result = await scanRepository(root, builtInDetectors);
  const github = stubGitHub([{ number: 9, state: "closed" }]);
  try {
    const done = await publishFixPullRequest(result, target(root));
    assert.equal(done.status, "updated");
    assert.equal(done.number, 9);
    const reopened = github.calls.find((call) => call.method === "PATCH");
    assert.equal(reopened?.body?.state, "open");
    assert.equal(github.calls.filter((call) => call.method === "POST").length, 0);
  } finally {
    github.restore();
  }
});

test("a merged pull request is not reopened; the next run opens a new one", async () => {
  const { root } = await repositoryWithFinding();
  const result = await scanRepository(root, builtInDetectors);
  const github = stubGitHub([{ number: 5, state: "closed", merged_at: "2026-10-01T00:00:00Z" }]);
  try {
    const done = await publishFixPullRequest(result, target(root));
    assert.equal(done.status, "opened");
    assert.equal(done.number, 7);
    assert.equal(github.calls.filter((call) => call.method === "PATCH").length, 0);
    assert.equal(github.calls.filter((call) => call.method === "POST").length, 1);
  } finally {
    github.restore();
  }
});

/** Runs the compiled Action entry point against a checkout with a fake step summary. */
async function runAction(root: string, inputs: Record<string, string>, status = 200) {
  const runner = await scratch("offing-fix-pr-runner-");
  const output = join(runner, "outputs.txt");
  const summary = join(runner, "summary.md");
  await Promise.all([writeFile(output, ""), writeFile(summary, "")]);
  const stub = join(runner, "api.mjs");
  await writeFile(
    stub,
    `
    globalThis.fetch = async (_url, options) => {
      if (${status} !== 200) return Response.json({}, { status: ${status} });
      if (options.method === "GET") return Response.json([]);
      return Response.json({ number: 7, html_url: "https://github.com/o/r/pull/7" });
    };
  `,
  );
  const action = process.env.OFFING_FIX_PR_ACTION || resolve("dist/src/action.js");
  const child = spawn(process.execPath, ["--import", pathToFileURL(stub).href, action], {
    env: {
      ...process.env,
      GITHUB_WORKSPACE: root,
      RUNNER_TEMP: runner,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      INPUT_ATTRIBUTION: "false",
      ...inputs,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  let stdout = "";
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  const code = await new Promise<number>((resolveCode, reject) => {
    child.once("error", reject);
    child.once("close", (status) => resolveCode(status ?? 1));
  });
  return { code, stdout, outputs: await readFile(output, "utf8"), summary: await readFile(summary, "utf8") };
}

test("the Action skips fix-pr on events other than schedule and workflow_dispatch", async () => {
  const { root } = await repositoryWithFinding();
  const run = await runAction(root, {
    "INPUT_FIX-PR": "true",
    "INPUT_FAIL-ON-SEVERITY": "none",
    GITHUB_EVENT_NAME: "push",
    GITHUB_EVENT_PATH: "",
    GITHUB_REPOSITORY: "o/r",
  });

  assert.equal(run.code, 0);
  assert.match(
    run.stdout,
    /::notice title=Offing fix pull request skipped::fix-pr runs on schedule and workflow_dispatch events/,
  );
  assert.equal(git(root, ["branch", "--list", "offing/fixes"]).trim(), "");
});

test("action.yml declares fix-pr off by default and passes it to the scan step", async () => {
  const action = parseYaml(await readFile(resolve("action.yml"), "utf8")) as {
    inputs: Record<string, { default?: string }>;
    runs: { steps: Array<{ env?: Record<string, string> }> };
  };
  assert.equal(action.inputs["fix-pr"]?.default, "false");
  assert.equal(action.runs.steps[0]?.env?.["INPUT_FIX-PR"], "${{ inputs.fix-pr }}");
});

const FIX_RUN = {
  "INPUT_FIX-PR": "true",
  "INPUT_FAIL-ON-SEVERITY": "none",
  "INPUT_GITHUB-TOKEN": "fixture",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_EVENT_PATH: "",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REF_NAME: "main",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_RUN_ID: "123",
};

test("the fix branch and the PR stay intact when any branch commit belongs to a contributor", async () => {
  const { root, remote } = await repositoryWithFinding();
  const before = await scanRepository(root, builtInDetectors);
  const github = stubGitHub([{ number: 9, state: "open" }]);
  try {
    git(root, ["checkout", "-q", "-b", "offing/fixes"]);
    git(root, ["commit", "--allow-empty", "-m", "Contributor work"]);
    git(root, ["push", "-q", "origin", "offing/fixes"]);
    const original = git(root, ["rev-parse", "HEAD"]);
    git(root, ["checkout", "-q", "main"]);
    const result = await publishFixPullRequest(before, target(root));
    assert.equal(result.status, "protected");
    assert.equal(git(remote, ["rev-parse", "offing/fixes"]), original);
    assert.equal(git(root, ["branch", "--show-current"]).trim(), "main");
    assert.deepEqual(
      github.calls.map(({ method }) => method),
      ["GET", "POST"],
    );
    assert.equal(github.calls.at(-1)?.path, "/repos/o/r/issues/9/comments");
  } finally {
    github.restore();
  }
});

test("the Action summarizes fork, read-only, protected branch, and no-change outcomes", async () => {
  const { root, remote } = await repositoryWithFinding();
  const forkEvent = join(await scratch("offing-fix-fork-"), "event.json");
  await writeFile(forkEvent, JSON.stringify({ repository: { fork: true, default_branch: "main" } }));
  const fork = await runAction(root, { ...FIX_RUN, GITHUB_EVENT_PATH: forkEvent });
  assert.equal(fork.code, 0);
  assert.match(fork.summary, /skipped for forks/);

  const readOnly = await runAction(root, FIX_RUN, 403);
  assert.equal(readOnly.code, 0);
  assert.match(readOnly.summary, /did not grant the writes/);
  assert.equal(git(root, ["branch", "--list", "offing/fixes"]).trim(), "");

  const first = await runAction(root, FIX_RUN);
  assert.equal(first.code, 0);
  assert.match(first.outputs, /fix-pr-number=7/);
  assert.match(first.outputs, /fix-pr-url=https:\/\/github.com\/o\/r\/pull\/7/);
  const artifactPath = first.outputs.match(/^fix-pr-artifact-path=(.+)$/m)?.[1];
  assert.ok(artifactPath);
  assert.match(await readFile(join(artifactPath, VERIFY_RESULT_ARTIFACT), "utf8"), /offing.verify-result.v1/);
  assert.match(await readFile(join(artifactPath, "offing-fix-plan.json"), "utf8"), /github-actions/);
  assert.match(await readFile(join(artifactPath, "offing-fix.patch"), "utf8"), /actions\/checkout/);
  assert.match(first.summary, /opened fix pull request #7/);
  const evidenceDirectory = process.env.OFFING_FIX_PR_EVIDENCE;
  if (evidenceDirectory) await cp(artifactPath, evidenceDirectory, { recursive: true });

  git(remote, ["config", "receive.denyNonFastForwards", "true"]);
  git(root, ["checkout", "-q", "main"]);
  git(root, ["commit", "--allow-empty", "-m", "Update default branch"]);
  const protectedBranch = await runAction(root, FIX_RUN);
  assert.equal(protectedBranch.code, 0);
  assert.match(protectedBranch.summary, /Branch protection rejected/);

  git(root, ["checkout", "-q", "main"]);
  await rm(join(root, ".github", "workflows", "ci.yml"));
  const clean = await runAction(root, FIX_RUN);
  assert.equal(clean.code, 0);
  assert.match(clean.summary, /no deterministic fixes/);
});

test("existing bot PRs update with checkout's original shallow history default", async () => {
  const { root, remote } = await repositoryWithFinding();
  git(root, ["push", "-q", "origin", "main"]);
  const github = stubGitHub();
  try {
    const before = await scanRepository(root, builtInDetectors);
    assert.equal((await publishFixPullRequest(before, target(root))).status, "opened");
    const shallow = join(await scratch("offing-fix-shallow-"), "repo");
    git(root, [
      "-c",
      "core.autocrlf=false",
      "clone",
      "-q",
      "--depth",
      "1",
      "--branch",
      "main",
      pathToFileURL(remote).href,
      shallow,
    ]);
    assert.equal(git(shallow, ["rev-parse", "--is-shallow-repository"]).trim(), "true");
    const scanned = await scanRepository(shallow, builtInDetectors);
    assert.equal((await publishFixPullRequest(scanned, target(shallow))).status, "updated");
    assert.equal(git(shallow, ["rev-parse", "--is-shallow-repository"]).trim(), "false");
  } finally {
    github.restore();
  }
});

test("a concurrent contributor push is rejected by the exact inspected lease", async () => {
  const { root, remote } = await repositoryWithFinding();
  const before = await scanRepository(root, builtInDetectors);
  const github = stubGitHub();
  try {
    await publishFixPullRequest(before, target(root));
    const contributor = join(await scratch("offing-fix-contributor-"), "repo");
    git(root, ["clone", "-q", "-b", "offing/fixes", remote, contributor]);
    git(contributor, [
      "-c",
      "user.name=Contributor",
      "-c",
      "user.email=contributor@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "Keep my work",
    ]);
    const humanHead = git(contributor, ["rev-parse", "HEAD"]);
    git(root, ["checkout", "-q", "main"]);
    const api = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      git(contributor, ["push", "-q", "origin", "offing/fixes"]);
      return api(...args);
    };
    await assert.rejects(() => publishFixPullRequest(before, target(root)), /stale info|failed to push/);
    assert.equal(git(remote, ["rev-parse", "offing/fixes"]), humanHead);
    assert.equal(github.calls.filter(({ method }) => method === "PATCH").length, 0);
  } finally {
    github.restore();
  }
});

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { fetchArchiveTree } from "../src/fleet/archive.js";
import { scanFleet } from "../src/fleet/index.js";
import { parseFleetPins } from "../src/fleet/pins.js";
import { githubFleetHost, githubFleetToken, gitlabBase } from "../src/fleet/remote.js";
import { renderRollupHtml, renderRollupText, rollup, rollupFiles, type FleetResult } from "../src/rollup.js";
import { scanWithBuiltIns } from "../src/scan-builtins.js";

const run = promisify(execFile);
const commit = "4".repeat(40);
const token = "private-test-token-do-not-report";
const privateText = "private-test-source-do-not-report";
const contents = JSON.stringify({ name: privateText, dependencies: { request: "2.88.2" } });
const binary = resolve(process.env.OFFING_FLEET_TEST_CLI ?? "dist/src/cli.js");
const pattern = /^[a-f0-9]{40}$/;
const fixtures = resolve("tests/fixtures/fleet");

test("cross-owner Fleet pins bypass discovery and keep the intended SHA after fetch failure", async () => {
  const pins = parseFleetPins([`github/one/project@${commit}`, `github/two/project@${"5".repeat(40)}`]);
  const fetched: string[] = [];
  const observed: string[] = [];
  const result = await scanFleet(
    {
      origin: "https://github.com",
      async listRepositories() {
        return assert.fail("Pinned input must bypass namespace discovery");
      },
      async readDefaultBranchHead() {
        return assert.fail("Pinned input must bypass branch resolution");
      },
      async fetchFilesAtCommit({ name }, sha, root) {
        fetched.push(`${name}@${sha}`);
        if (name === "two/project") throw new Error("Unavailable pin");
        await writeFile(join(root, "package.json"), contents);
        return 100;
      },
    },
    "",
    {
      pins,
      jobs: 1,
      asOf: "2026-11-27",
      async observeScan({ name }, sha, report) {
        observed.push(`${name}@${sha}`);
        assert.equal(report.scannedAt, "2026-11-27T00:00:00.000Z");
      },
    },
  );
  assert.deepEqual(
    fetched,
    pins.map(({ repository, commit }) => `${repository}@${commit}`),
  );
  assert.deepEqual(observed, [`one/project@${commit}`]);
  assert.deepEqual(
    result.repositoryStatus.map(({ name, commit, status }) => ({ name, commit, status })),
    [
      { name: "one/project", commit, status: "scanned" },
      { name: "two/project", commit: "5".repeat(40), status: "failed" },
    ],
  );
  for (const lines of [
    [],
    ["org/project"],
    [`github/org/project@HEAD`],
    [`github/org/project@${commit}`, `github/Org/Project@${commit}`],
  ]) {
    assert.throws(() => parseFleetPins(lines), /Pinned --repos/);
  }
});

test("namespace Fleet name filters still resolve the selected default branch normally", async () => {
  const fetched: string[] = [];
  const result = await scanFleet(
    {
      origin: "https://github.com",
      async listRepositories(namespace) {
        assert.equal(namespace, "example");
        return ["excluded", "selected"].map((leaf) => ({
          name: `example/${leaf}`,
          defaultBranch: "main",
          topics: [],
          disabled: false,
          archived: false,
          fork: false,
        }));
      },
      async readDefaultBranchHead({ name }) {
        assert.equal(name, "example/selected");
        return commit;
      },
      async fetchFilesAtCommit({ name }, sha, root) {
        fetched.push(`${name}@${sha}`);
        await writeFile(join(root, "package.json"), contents);
        return 12;
      },
    },
    "example",
    { repositories: ["selected"], noCache: true },
  );
  assert.deepEqual(fetched, [`example/selected@${commit}`]);
  assert.deepEqual(
    result.repositoryStatus.map(({ status }) => status),
    ["skipped", "scanned"],
  );
});

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(fixtures, `${name}.json`), "utf8")) as T;
}

async function workspace(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "offing-fleet-fixture-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function localHost(
  t: TestContext,
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((done) => {
    server.listen(0, "127.0.0.1", done);
  });
  t.after(
    () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

function answer(response: ServerResponse, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(200, { "content-type": "application/json", ...headers }).end(JSON.stringify(value));
}

function archive(files: Readonly<Record<string, string>>): Buffer<ArrayBuffer> {
  const parts: Buffer[] = [];
  for (const [file, value] of Object.entries(files)) {
    const data = Buffer.from(value);
    const head = Buffer.alloc(512);
    head.write(file, 0, 100);
    head.write(data.length.toString(8).padStart(11, "0"), 124, 11);
    head.write("0", 156);
    parts.push(head, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

function withoutGit(cache: string): NodeJS.ProcessEnv {
  // Remove both common spellings so Windows cannot retain an inherited PATH entry.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH"));
  return { ...env, PATH: "", OFFING_DATA_DIR: cache, GITLAB_TOKEN: token };
}

test("fleet scans pinned GitLab subgroup archives, resumes by SHA and redacts credentials and private data", async (t) => {
  const root = await workspace(t);
  const cache = join(root, "cache");
  const projects = await fixture<object[]>("gitlab-projects");
  let archives = 0;
  let sha = commit;
  let denied = false;
  const packed = archive({
    "example-pin/package.json": contents,
    "example-pin/ignored-private.txt": privateText,
    "example-pin/../../package.json": "never materialize traversal",
  });
  const origin = await localHost(t, (request, response) => {
    assert.equal(request.headers["private-token"], token);
    const url = new URL(request.url ?? "/", "http://local");
    if (denied) {
      response.writeHead(403).end(token);
      return;
    }
    if (url.pathname.endsWith("/projects")) {
      assert.equal(url.searchParams.get("include_subgroups"), "true");
      return answer(response, projects);
    }
    if (url.pathname.includes("example%2Ffailed")) {
      response.writeHead(403).end(privateText);
      return;
    }
    if (url.pathname.endsWith("/branches/main")) return answer(response, { commit: { id: sha } });
    if (url.pathname.endsWith("/archive.tar.gz")) {
      assert.equal(url.searchParams.get("sha"), sha);
      archives++;
      response.end(packed);
      return;
    }
    response.writeHead(404).end();
  });
  assert.throws(() => gitlabBase("https://user:secret@invalid.example"), /must not contain credentials/);
  assert.throws(() => gitlabBase("http://gitlab.example"), /needs an HTTPS origin/);
  assert.equal(gitlabBase(`${origin}/gitlab`).pathname, "/gitlab/");
  const cli = (args: string[]) =>
    run(process.execPath, [binary, "fleet", "example", "--gitlab-url", origin, ...args], {
      cwd: root,
      env: withoutGit(cache),
    });
  const initial = await cli(["--json", "--progress"]);
  const report = JSON.parse(initial.stdout);
  assert.equal(report.schemaVersion, "offing.fleet.v1");
  assert.deepEqual(
    report.repositoryStatus.map((row: { status: string }) => row.status),
    ["skipped", "failed", "scanned"],
  );
  assert.ok(report.findings > 0);
  assert.equal(archives, 1);
  assert.ok(initial.stderr.includes("example/sub/api: scanned"));
  const schema = JSON.parse(await readFile("schemas/fleet.v1.schema.json", "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  const privacy = new RegExp(`${token}|${privateText}`, "u");
  assert.doesNotMatch(initial.stdout + initial.stderr + renderRollupHtml(report) + renderRollupText(report), privacy);
  const cached = await readdir(join(cache, "fleet-v1"));
  assert.equal(cached.length, 1);
  for (const key of cached) assert.doesNotMatch(await readFile(join(cache, "fleet-v1", key), "utf8"), privacy);
  assert.notEqual(
    await readFile(join(root, "package.json"), "utf8").catch(() => "absent"),
    "never materialize traversal",
  );

  const second = JSON.parse((await cli(["--json", "--jobs", "1"])).stdout);
  assert.equal(archives, 1);
  assert.deepEqual(second.byRepository, report.byRepository);
  assert.equal(second.repositoryStatus[2].status, "cached");
  const reportPath = join(root, "fleet.json");
  await writeFile(reportPath, initial.stdout);
  const combined = await rollupFiles([reportPath]);
  assert.deepEqual(combined, report);
  const owners = join(root, "owners.json");
  await writeFile(owners, JSON.stringify({ "example/sub/api": "platform" }));
  const owned = await rollupFiles([reportPath], owners);
  assert.equal(owned.byOwner[0]?.name, "platform");
  assert.match(renderRollupHtml(owned), /platform/);
  const bad = join(root, "invalid-fleet.json");
  await writeFile(bad, JSON.stringify({ ...report, byRepository: [null] }));
  await assert.rejects(rollupFiles([bad]), /not an offing.scan.v1 or offing.fleet.v1 report/);

  const names = join(root, "repos.txt");
  await writeFile(names, "# selected\nexample/sub/api\n");
  const filtered = JSON.parse(
    (await cli(["--json", "--include", "example/**", "--exclude", "failed", "--topic", "backend", "--repos", names]))
      .stdout,
  );
  assert.equal(filtered.repositoryStatus[1].status, "skipped");
  assert.equal(filtered.repositoryStatus[2].status, "cached");
  await assert.rejects(cli(["--json", "--fail-on", "info"]), (error: unknown) => {
    assert.equal((error as { code: number }).code, 1);
    return true;
  });
  assert.match((await cli(["--html"])).stdout, /Fleet scan status/);
  await assert.rejects(cli(["--jobs", "0"]), /between 1 and 16/);
  await assert.rejects(cli(["--json", "--html"]), /Choose one fleet format/);
  sha = "5".repeat(40);
  await cli(["--format", "json"]);
  assert.equal(archives, 2);
  denied = true;
  await assert.rejects(cli(["--json"]), /GitLab denied access.*read_api and read_repository/);
});

test("fleet follows GitHub pagination, retries API limits, filters forks and compares one pinned Git checkout", async (t) => {
  const root = await workspace(t);
  const repoPath = join(root, "api.git");
  await mkdir(repoPath);
  const git = (...args: string[]) => run("git", ["-C", repoPath, ...args]);
  await git("init", "-q");
  await git("config", "uploadpack.allowFilter", "true");
  await git("config", "uploadpack.allowReachableSHA1InWant", "true");
  await writeFile(join(repoPath, "package.json"), contents);
  await mkdir(join(repoPath, ".github"));
  await writeFile(join(repoPath, ".github/CODEOWNERS"), "/package.json @example/dependencies\n");
  await writeFile(join(repoPath, "CODEOWNERS"), "* @example/lower-priority\n");
  await writeFile(join(repoPath, "not-detector.txt"), privateText);
  await git("add", ".");
  await git(
    "-c",
    "user.name=Offing",
    "-c",
    "user.email=offing@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  );
  const sha = (await git("rev-parse", "HEAD")).stdout.trim();
  const repositories = await fixture<object[]>("github-repositories");
  const rest = Array.from({ length: 47 }, (_, idx) => ({
    full_name: `example/demo-${idx}`,
    default_branch: "main",
    disabled: true,
    topics: [],
  }));
  let requests = 0;
  let gitRequests = 0;
  const origin = await localHost(t, (request, response) => {
    const url = new URL(request.url ?? "/", "http://local");
    if (url.pathname.startsWith("/example/api.git")) {
      gitRequests++;
      const backend = spawn("git", ["http-backend"], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: root,
          GIT_HTTP_EXPORT_ALL: "1",
          REQUEST_METHOD: request.method,
          PATH_INFO: url.pathname.replace(/^\/example/u, ""),
          QUERY_STRING: url.search.slice(1),
          CONTENT_TYPE: request.headers["content-type"],
          GIT_PROTOCOL: String(request.headers["git-protocol"] ?? ""),
          CONTENT_LENGTH: request.headers["content-length"],
        },
      });
      request.pipe(backend.stdin);
      let pending = Buffer.alloc(0);
      backend.stdout.on("data", (chunk: Buffer) => {
        if (response.headersSent) {
          response.write(chunk);
          return;
        }
        pending = Buffer.concat([pending, chunk]);
        const boundary = pending.indexOf("\r\n\r\n");
        if (boundary === -1) return;
        for (const header of pending.subarray(0, boundary).toString().split("\r\n")) {
          const index = header.indexOf(":");
          const key = header.slice(0, index);
          const value = header.slice(index + 1).trim();
          if (key === "Status") response.statusCode = Number.parseInt(value, 10);
          else if (index > 0) response.setHeader(key, value);
        }
        response.write(pending.subarray(boundary + 4));
      });
      backend.on("close", () => response.end());
      backend.on("error", () => response.writeHead(500).end());
      return;
    }
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    if (url.pathname.endsWith("/repos")) {
      if (requests++ === 0) {
        response.writeHead(429, { "retry-after": "0" }).end();
        return;
      }
      if (url.searchParams.get("page") === "1") {
        return answer(response, repositories, { link: '<https://untrusted.invalid>; rel="next"' });
      }
      return answer(response, rest);
    }
    if (url.pathname.endsWith("/branches/main")) return answer(response, { commit: { sha } });
    response.writeHead(404).end();
  });
  assert.equal(await githubFleetToken({ GITHUB_TOKEN: token, GH_TOKEN: "fallback" }), token);
  assert.equal(await githubFleetToken({ GH_TOKEN: "fallback" }), "fallback");
  const host = githubFleetHost(token, { api: origin, origin });
  const phases: string[] = [];
  const result = await scanFleet(host, "example", {
    noCache: true,
    onProgress: ({ status }) => {
      phases.push(status);
    },
  });
  assert.equal(requests, 3);
  assert.ok(gitRequests > 0);
  assert.equal(result.repositories, 50);
  assert.equal(phases.length, 50);
  const api = result.repositoryStatus.find(({ name }) => name === "example/api");
  assert.match(api?.commit ?? "", pattern);
  assert.equal(api?.status, "scanned");
  assert.equal(result.repositoryStatus.filter(({ status }) => status === "skipped").length, 49);
  assert.equal(result.repositoryStatus.find(({ name }) => name === "example/.github")?.status, "skipped");
  const local = await scanWithBuiltIns(repoPath, { noCache: true });
  const equivalent = rollup([{ repository: "example/api", report: local }]);
  assert.equal(result.findings, equivalent.findings);
  assert.deepEqual(result.byProduct, equivalent.byProduct);
  const forecast = await scanFleet(host, "example", { forecast: { gitlab: false, asOf: "2025-01-01" } });
  const pinned = forecast.repositoryStatus.find(({ name }) => name === "example/api");
  assert.equal(pinned?.commit, api?.commit);
  assert.deepEqual(pinned?.forecastEvidence?.findings[0]?.owners, ["@example/dependencies"]);
  assert.doesNotMatch(JSON.stringify(result), /forecastEvidence|dependencies|lower-priority/);
  await assert.rejects(scanFleet(host, "example/foreign"), /Provide a GitHub organization/);
});

test("fleet archive extraction rejects malformed bodies and preserves only regular declared paths", async (t) => {
  const root = await workspace(t);
  const selected = { patterns: ["package.json"], includes: (name: string) => name.endsWith("package.json") };
  await assert.rejects(fetchArchiveTree(new Response(null), root, selected), /no body/);
  await assert.rejects(fetchArchiveTree(new Response("invalid"), root, selected), /archive is invalid/);
  const bytes = archive({ "prefix/package.json": contents, "prefix/private.txt": privateText });
  assert.equal(await fetchArchiveTree(new Response(bytes), root, selected), bytes.length);
  assert.deepEqual(await readdir(root), ["package.json"]);
  assert.equal(await readFile(join(root, "package.json"), "utf8"), contents);
});

interface WorkflowStep {
  readonly id?: string;
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
}

async function organizationWorkflow() {
  return parse(await readFile(".github/workflows/org-scan.yml", "utf8")) as {
    jobs: Record<string, { steps: WorkflowStep[] }>;
    on: Record<string, { inputs: Record<string, { default: unknown }> }>;
  };
}

test("organization workflow pins its source and keeps the fleet report and both digests in one job", async () => {
  const document = await organizationWorkflow();
  assert.deepEqual(Object.keys(document.jobs), ["fleet"]);
  const steps = document.jobs.fleet?.steps ?? [];
  const source = steps.find(({ id }) => id === "source");
  assert.match(source?.run ?? "", /\^\[0-9a-f\]\{40\}\$/);
  assert.equal(source?.env?.OFFING_WORKFLOW_SHA, "${{ job.workflow_sha }}");
  assert.ok(steps.some(({ uses }) => uses === "$/.github/actions/setup"));
  assert.equal(
    steps.find(({ uses }) => uses?.includes("actions/checkout"))?.with?.ref,
    "${{ steps.source.outputs.sha }}",
  );
  const scan = steps.find(({ id }) => id === "scan")?.run ?? "";
  assert.match(scan, /cli\.js fleet .*--json.*"\$fleet_output"/);
  assert.match(scan, /forecast --fleet "\$fleet_output" --digest "\$RUNNER_TEMP\/offing-owner-digests"/);
  assert.match(scan, /rollup "\$fleet_output" --json > reports\/fleet\.json/);
  assert.equal(document.on.workflow_call?.inputs["forecast-digests"]?.default, false);
  assert.equal(document.on.workflow_dispatch?.inputs["forecast-digests"]?.default, false);
  const upload = steps.find(({ uses }) => uses?.includes("actions/upload-artifact"));
  assert.equal(upload?.with?.name, "offing-fleet");
  assert.equal(upload?.with?.path, "reports/fleet.json");
  assert.equal(upload?.with?.["retention-days"], 14);
  for (const { uses } of steps) {
    if (uses && !uses.startsWith("$/")) assert.match(uses, /^[^@]+@[0-9a-f]{40}$/);
  }
  const ownerUpload = steps.find((step) => step.with?.name === "offing-owner-digests");
  assert.equal(ownerUpload?.if, "${{ inputs.forecast-digests }}");
  assert.equal(ownerUpload?.with?.["retention-days"], 14);
  assert.equal(ownerUpload?.with?.path, "${{ runner.temp }}/offing-owner-digests/*.md");
  assert.ok(steps.some(({ run }) => run?.includes('type: "mrkdwn"') && run?.includes("echo") === false));
  assert.ok(steps.some(({ run }) => run?.includes("application/vnd.microsoft.card.adaptive")));
});

async function fixtureOrganization(t: TestContext): Promise<string> {
  const tar = archive({ "prefix/package.json": contents });
  return localHost(t, (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const { pathname } = new URL(request.url ?? "/", "http://local");
    if (pathname === "/orgs/example/repos") {
      return answer(
        response,
        ["api", "unavailable"].map((name) => ({
          full_name: `example/${name}`,
          default_branch: "main",
        })),
      );
    }
    if (pathname === "/repos/example/api/branches/main") return answer(response, { commit: { sha: commit } });
    if (pathname === `/repos/example/api/tarball/${commit}`) {
      response.end(tar);
      return;
    }
    response.writeHead(404).end();
  });
}

async function runOrganizationStep(t: TestContext) {
  const root = await workspace(t);
  const origin = await fixtureOrganization(t);
  await mkdir(join(root, "dist", "src"), { recursive: true });
  await mkdir(join(root, "bin"));
  await writeFile(
    join(root, "dist", "src", "cli.js"),
    `
    const fetchFixture = globalThis.fetch;
    globalThis.fetch = (resource, init) => {
      const url = new URL(resource);
      if (url.origin !== "https://api.github.com") throw new Error("Unexpected fixture request");
      return fetchFixture(new URL(url.pathname + url.search, ${JSON.stringify(origin)}), { ...init, redirect: "manual" });
    };
    process.env.PATH = "";
    void import(${JSON.stringify(pathToFileURL(binary).href)});
  `,
  );
  await writeFile(
    join(root, "bin", "curl"),
    `#!/bin/sh
while [ "$#" -gt 1 ]; do
  if [ "$1" = "-d" ]; then printf '%s' "$2" > "$PAYLOAD_FILE"; exit; fi
  shift
done
exit 1
`,
    { mode: 0o755 },
  );
  const steps = (await organizationWorkflow()).jobs.fleet?.steps ?? [];
  return {
    root,
    step: (name: string, env: NodeJS.ProcessEnv = {}) => {
      const script = steps.find((step) => step.id === name || step.name === name)?.run;
      assert.ok(script, `Missing workflow script ${name}`);
      return run("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
        cwd: root,
        env: {
          PATH: [join(root, "bin"), dirname(process.execPath), process.env.PATH].join(delimiter),
          HOME: root,
          OFFING_DATA_DIR: join(root, "data"),
          ...env,
        },
      });
    },
  };
}

test("organization workflow runs the installed CLI and renders Slack and Teams digests", {
  skip: process.env.OFFING_FLEET_WORKFLOW_TEST !== "1",
}, async (t) => {
  const { root, step } = await runOrganizationStep(t);
  const output = join(root, "output");
  const summary = join(root, "summary");
  const source = (ref: string, workflowSha = commit) =>
    step("source", { OFFING_REF: ref, OFFING_WORKFLOW_SHA: workflowSha, GITHUB_OUTPUT: output });
  await assert.rejects(source("", "main"), /Could not resolve the exact Offing workflow commit SHA/);
  await assert.rejects(source("a".repeat(40)), /Supply offing-ref as the exact Offing workflow commit SHA/);
  await source(commit);
  await source("");
  await step("scan", {
    ORGANIZATION: "example",
    GH_TOKEN: token,
    FAIL_ON: "info",
    MAX_JOBS: "2",
    FORECAST_DIGESTS: "false",
    RUNNER_TEMP: root,
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
  });
  assert.equal(await readFile(output, "utf8"), `sha=${commit}\nsha=${commit}\nstatus=1\n`);
  const report: unknown = JSON.parse(await readFile(join(root, "reports", "fleet.json"), "utf8"));
  const schema: unknown = JSON.parse(
    await readFile(resolve(dirname(binary), "../../schemas/fleet.v1.schema.json"), "utf8"),
  );
  assert.ok(schema && typeof schema === "object");
  const validate = new Ajv2020({ strict: false }).compile<FleetResult>(schema);
  assert.ok(validate(report), JSON.stringify(validate.errors));
  assert.deepEqual(
    report.repositoryStatus.map(({ name, status }) => [name, status]),
    [
      ["example/api", "scanned"],
      ["example/unavailable", "failed"],
    ],
  );
  const digest = await readFile(summary, "utf8");
  assert.equal(digest, await readFile(join(root, "digest.txt"), "utf8"));
  assert.match(digest, /example\/unavailable/);
  const payload = async (name: "Slack" | "Teams"): Promise<unknown> => {
    const file = join(root, name);
    await step(`Post to ${name}`, { PAYLOAD_FILE: file });
    await assert.rejects(readFile(file), { code: "ENOENT" });
    await step(`Post to ${name}`, {
      [`${name.toUpperCase()}_WEBHOOK_URL`]: "https://webhook.invalid",
      PAYLOAD_FILE: file,
    });
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return parsed;
  };
  const title = "Offing organization digest";
  assert.deepEqual(await payload("Slack"), {
    text: title,
    blocks: [
      { type: "header", text: { type: "plain_text", text: title, emoji: false } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: digest.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
        },
      },
    ],
  });
  assert.deepEqual(await payload("Teams"), {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: title, weight: "Bolder", size: "Medium" },
            { type: "TextBlock", text: digest, wrap: true },
          ],
        },
      },
    ],
  });
  await assert.rejects(step("Enforce the severity gate", { STATUS: "1" }), { code: 1 });
});

test("fleet forecast acceptance records exact CODEOWNERS and works from an offline file", async (t) => {
  const root = await workspace(t);
  const packages = {
    "example-pin/package.json": JSON.stringify({
      name: privateText,
      dependencies: { "fictional-widget-unknown-to-registry": "1.0.0" },
    }),
    "example-pin/.nvmrc": "18\n",
    "example-pin/notes.txt": privateText,
  };
  const owned = archive({
    ...packages,
    "example-pin/.gitlab/CODEOWNERS": "[Platform] @example/platform @example/runtime\n/.nvmrc\n",
    "example-pin/.github/CODEOWNERS": "* @example/wrong-host\n",
  });
  const unowned = archive(packages);
  let requests = 0;
  const origin = await localHost(t, (request, response) => {
    requests++;
    const url = new URL(request.url ?? "/", "http://local");
    if (url.pathname.endsWith("/projects")) {
      return answer(response, [
        { path_with_namespace: "example/app", default_branch: "main" },
        { path_with_namespace: "example/edge", default_branch: "main" },
        { path_with_namespace: "outside/scope", default_branch: "main" },
      ]);
    }
    assert.doesNotMatch(url.pathname, /outside/u);
    if (url.pathname.endsWith("/branches/main")) return answer(response, { commit: { id: commit } });
    assert.equal(url.searchParams.get("sha"), commit);
    const selected = url.pathname.includes("%2Fapp/") ? owned : unowned;
    response.end(selected);
  });
  const cli = (...args: string[]) =>
    run(process.execPath, [binary, ...args], { cwd: root, env: withoutGit(join(root, "data")) });
  const asOf = "2025-01-01";
  const live = ["--gitlab-url", origin, "--as-of", asOf];
  const snapshot = await cli("fleet", "example", "--json", "--forecast-input", ...live);
  await writeFile(join(root, "fleet.json"), snapshot.stdout);
  const captured: FleetResult = JSON.parse(snapshot.stdout);
  assert.equal(captured.forecastAsOf, asOf);
  assert.equal(captured.repositoryStatus.length, 2);
  assert.deepEqual(captured.repositoryStatus[0]?.forecastEvidence?.findings[0], {
    ruleId: "nodejs.runtime.eol-18",
    location: { path: ".nvmrc", line: 1 },
    deadline: "2025-04-30",
    owners: ["@example/platform", "@example/runtime"],
  });
  assert.doesNotMatch(snapshot.stdout, /private-test|wrong-host|notes\.txt|fictional-widget/u);
  const schema = JSON.parse(await readFile("schemas/fleet.v1.schema.json", "utf8"));
  const validate = new Ajv2020({ strict: false }).compile<FleetResult>(schema);
  assert.ok(validate(captured), JSON.stringify(validate.errors));
  const redacted = await cli("rollup", "fleet.json", "--json");
  assert.doesNotMatch(redacted.stdout, /forecastEvidence|forecastAsOf|\.nvmrc/u);
  await writeFile(join(root, "owners.json"), JSON.stringify({ "example/edge": "Edge owners" }));
  const online = await cli("forecast", "--fleet", "example", "--json", ...live);
  const recordedRequests = requests;
  const offline = (...args: string[]) => cli("forecast", "--fleet", "fleet.json", ...args);
  assert.equal((await offline("--json")).stdout, online.stdout);
  const forecast = JSON.parse(online.stdout);
  assert.equal(forecast.schemaVersion, "offing.fleet-forecast.v1");
  assert.equal(forecast.byRepository[0]?.buckets[1]?.items.length, 1);
  assert.deepEqual(
    forecast.byOwner.map((group: { name: string }) => group.name),
    ["@example/platform", "@example/runtime", "Edge owners", "unowned"],
  );
  assert.equal(forecast.coverage.share, 0.5);
  const saved = join(root, "prior.json");
  await writeFile(saved, online.stdout);
  const compared = JSON.parse((await offline("--json", "--previous", saved)).stdout);
  assert.deepEqual(compared.changes, { new: [], closer: [], fixed: [] });
  await assert.rejects(offline("--previous", saved, "--as-of", "2024-12-31"), /previous forecast cannot be newer/);
  assert.match((await offline("--by", "repository")).stdout, /example\/app/u);
  const card = await offline("--card", "--theme", "dark");
  assert.match(card.stdout, /Nearest deadline: 2025-04-30/u);
  assert.equal(card.stdout, (await offline("--card", "--theme", "dark")).stdout);
  await offline("--ics", "calendars");
  await offline("--ics", "calendars-repeat");
  for (const file of await readdir(join(root, "calendars"))) {
    const content = await readFile(join(root, "calendars", file));
    assert.deepEqual(content, await readFile(join(root, "calendars-repeat", file)));
  }
  await offline("--digest", "digests");
  const digests = await readdir(join(root, "digests"));
  const pathNamed = digests.find((name) => name.includes("example-platform"));
  assert.ok(pathNamed);
  assert.match(await readFile(join(root, "digests", pathNamed), "utf8"), /\.nvmrc/u);
  await assert.rejects(offline("--ics", "calendars"), /Choose a new, writable output directory/);
  await assert.rejects(offline("--card", "--by", "owner"), /--by accepts/);
  await assert.rejects(offline("--gitlab"), /Apply GitLab options/);
  await assert.rejects(offline("--json", "--card"), /Choose one of/);
  await assert.rejects(offline("--theme", "dark"), /--theme accepts/);
  await assert.rejects(offline("--today", asOf, "--as-of", asOf), /either --as-of or --today/);
  await assert.rejects(offline("--as-of", "2025-02-29"), /needs a date/);
  await assert.rejects(offline("--previous", "absent.json"), /Cannot read forecast JSON/);
  await assert.rejects(offline("--previous", "fleet.json"), /previous file must be/);
  await assert.rejects(offline("--owners", "fleet.json"), /mapping repository names/);
  await assert.rejects(cli("forecast", "--by", "owner"), /--fleet needs an organization/);
  await assert.rejects(offline("--ics"), /missing option value/);
  await assert.rejects(cli("forecast", "--fleet", "https://outside.invalid/"), /Give a GitHub organization/);
  await assert.rejects(cli("fleet", "example", "--forecast-input"), /requires JSON output/);
  await assert.rejects(cli("fleet", "example", "--as-of", asOf), /requires --forecast-input/);
  const aggregateFile = join(root, "aggregate.json");
  await writeFile(aggregateFile, redacted.stdout);
  await assert.rejects(cli("forecast", "--fleet", aggregateFile), /--forecast-input/);
  assert.equal(requests, recordedRequests);
  const canonical = {
    ...captured,
    repositoryStatus: captured.repositoryStatus.map((row) => ({ ...row, host: "https://gitlab.example" })),
  };
  assert.deepEqual(canonical, JSON.parse(await readFile("examples/forecast/fleet.json", "utf8")));
});

test("fleet --policy reports compliant, violating and rejected repositories without exposing policy or source content", async (t) => {
  const root = await workspace(t);
  const policyPath = join(root, "fleet-policy.json");
  await writeFile(
    policyPath,
    JSON.stringify({
      schemaVersion: "offing.fleet-policy.v1",
      allowLoosen: ["exceptions"],
      policy: { rules: [{ id: "private-policy-rule", severity: "info" }] },
    }),
  );
  const names = ["compliant", "violating", "unauthorized", "expired"];
  const origin = await localHost(t, (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://local").pathname);
    if (pathname.endsWith("/projects")) {
      return answer(
        response,
        names.map((name) => ({ path_with_namespace: `example/${name}`, default_branch: "main" })),
      );
    }
    if (pathname.endsWith("/branches/main")) return answer(response, { commit: { id: commit } });
    const files: Record<string, string> = {
      "checkout/package.json": pathname.includes("/compliant/") ? "{}" : contents,
      "checkout/ignored-private.txt": privateText,
    };
    if (pathname.includes("/unauthorized/")) {
      files["checkout/.offing.json"] = JSON.stringify({
        policy: { rules: [{ id: "private-policy-rule", severity: "critical" }] },
      });
    }
    if (pathname.includes("/expired/")) {
      files["checkout/.offing.json"] = JSON.stringify({
        policy: {
          rules: [{ id: "private-policy-rule", severity: "info" }],
          exceptions: [{ owner: token, path: "private/", reason: privateText, expires: "2000-01-01" }],
        },
      });
    }
    return response.writeHead(200).end(archive(files));
  });
  const scan = (...flags: string[]) =>
    run(
      process.execPath,
      [binary, "fleet", "example", "--gitlab-url", origin, "--policy", policyPath, "--json", ...flags],
      {
        env: withoutGit(root),
        timeout: 15_000,
      },
    ).catch((error: unknown) => {
      assert(
        error instanceof Error &&
          "code" in error &&
          error.code === 1 &&
          "stdout" in error &&
          typeof error.stdout === "string",
      );
      return { stdout: error.stdout };
    });
  const result = await scan();
  assert.doesNotMatch(result.stdout, new RegExp(`${privateText}|${token}|private-policy-rule|fleet-policy\\.json`));
  const parsed = JSON.parse(result.stdout);
  const statuses = Object.fromEntries(
    parsed.repositoryStatus.map((item: { name: string; compliance: { status: string; reason: string | null } }) => [
      item.name,
      [item.compliance.status, item.compliance.reason],
    ]),
  );
  assert.deepEqual(statuses, {
    "example/compliant": ["compliant", null],
    "example/violating": ["violation", "rule-threshold"],
    "example/unauthorized": ["invalid", "unauthorized-override"],
    "example/expired": ["invalid", "expired-exception"],
  });
  const schema = JSON.parse(await readFile("schemas/fleet.v1.schema.json", "utf8"));
  const isFleet = new Ajv2020().compile<FleetResult>(schema);
  assert(isFleet(parsed));
  assert.match(renderRollupText(parsed), /policy violation/);
  assert.match(renderRollupHtml(parsed), /<th>Policy<\/th>/);

  const recording = await scan("--forecast-input");
  const complete: FleetResult = JSON.parse(recording.stdout);
  assert(isFleet(complete));
  assert.ok(complete.repositoryStatus.some((repo) => repo.forecastEvidence?.findings.length));
  const file = join(root, "forecast-recording.json");
  await writeFile(file, recording.stdout);
  assert.deepEqual(await rollupFiles([file]), parsed);
});

test("fleet captures what-if readiness at a pinned commit and the forecast replays it without the host", async (t) => {
  const root = await workspace(t);
  let requests = 0;
  const lockfile = (range: string) =>
    JSON.stringify(
      {
        name: "fixture",
        lockfileVersion: 3,
        packages: { "node_modules/example": { version: "1.0.0", engines: { node: range } } },
      },
      null,
      2,
    );
  const origin = await localHost(t, (request, response) => {
    requests++;
    const url = new URL(request.url ?? "/", "http://local");
    if (url.pathname.endsWith("/projects")) {
      return answer(response, [
        { path_with_namespace: "example/ready", default_branch: "main" },
        { path_with_namespace: "example/blocked", default_branch: "main" },
        { path_with_namespace: "example/unknown", default_branch: "main", archived: true },
      ]);
    }
    if (url.pathname.endsWith("/branches/main")) return answer(response, { commit: { id: commit } });
    assert.equal(url.searchParams.get("sha"), commit);
    const constraint = url.pathname.includes("%2Fready/") ? ">=22" : "^18";
    response.end(archive({ "example-pin/package-lock.json": lockfile(constraint) }));
  });
  const cli = (...args: string[]) =>
    run(process.execPath, [binary, ...args], { cwd: root, env: withoutGit(join(root, "data")) });
  const flags = [
    "--gitlab-url",
    origin,
    "--what-if-target",
    "nodejs@22",
    "--what-if-target",
    "nodejs@999",
    "--as-of",
    "2026-11-27",
  ];
  await assert.rejects(cli("fleet", "example", ...flags), /--what-if-target requires JSON output/);
  const recorded = await cli("fleet", "example", "--json", ...flags);
  await writeFile(join(root, "fleet.json"), recorded.stdout);
  const count = requests;
  const result = await cli(
    "forecast",
    "--fleet",
    "fleet.json",
    "--target",
    "nodejs@22",
    "--target",
    "nodejs@999",
    "--json",
  );
  assert.equal(requests, count);
  const [report, unlisted] = JSON.parse(result.stdout).reports;
  assert.equal(report.ready[0].name, "example/ready");
  assert.equal(report.ready[0].commit, commit);
  assert.equal(report.blocked[0].name, "example/blocked");
  assert.match(report.blocked[0].reason, /excludes Node.js 22/);
  assert.equal(report.unknown[0].name, "example/unknown");
  assert.equal(report.unknown[0].commit, null);
  assert.deepEqual(unlisted.ready, []);
  assert(unlisted.unknown.some(({ name }: { name: string }) => name === "example/ready"));
});

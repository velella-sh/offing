import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { fetchArchiveTree } from "../src/fleet/archive.js";
import { scanFleet } from "../src/fleet/index.js";
import { githubFleetHost, githubFleetToken, gitlabBase } from "../src/fleet/remote.js";
import { renderRollupHtml, renderRollupText, rollup, rollupFiles } from "../src/rollup.js";
import { scanWithBuiltIns } from "../src/scan-builtins.js";

const run = promisify(execFile);
const commit = "4".repeat(40);
const token = "private-test-token-do-not-report";
const privateText = "private-test-source-do-not-report";
const contents = JSON.stringify({ name: privateText, dependencies: { request: "2.88.2" } });
const binary = resolve(process.env.OFFING_FLEET_TEST_CLI ?? "dist/src/cli.js");
const pattern = /^[a-f0-9]{40}$/;
const fixtures = resolve("tests/fixtures/fleet");

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
  const local = await scanWithBuiltIns(repoPath, { noCache: true });
  const equivalent = rollup([{ repository: "example/api", report: local }]);
  assert.equal(result.findings, equivalent.findings);
  assert.deepEqual(result.byProduct, equivalent.byProduct);
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

test("organization workflow pins its source and keeps the fleet report and both digests in one job", async () => {
  interface Step {
    readonly id?: string;
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Record<string, unknown>;
  }
  const document = parse(await readFile(".github/workflows/org-scan.yml", "utf8")) as {
    jobs: Record<string, { steps: Step[] }>;
  };
  assert.deepEqual(Object.keys(document.jobs), ["fleet"]);
  const steps = document.jobs.fleet?.steps ?? [];
  assert.match(steps.find(({ id }) => id === "source")?.run ?? "", /\^\[0-9a-f\]\{40\}\$/);
  assert.equal(
    steps.find(({ uses }) => uses?.includes("actions/checkout"))?.with?.ref,
    "${{ steps.source.outputs.sha }}",
  );
  assert.match(steps.find(({ id }) => id === "scan")?.run ?? "", /cli\.js fleet .*--json.*reports\/fleet\.json/);
  const upload = steps.find(({ uses }) => uses?.includes("actions/upload-artifact"));
  assert.equal(upload?.with?.name, "offing-fleet");
  assert.ok(steps.some(({ run }) => run?.includes('type: "mrkdwn"') && run?.includes("echo") === false));
  assert.ok(steps.some(({ run }) => run?.includes("application/vnd.microsoft.card.adaptive")));
});

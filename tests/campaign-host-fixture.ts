import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);

interface Review {
  id: number;
  actor: number;
  branch: string;
  base: string;
  head: string;
  body: string;
  status: "review" | "merged" | "closed";
}

/** Model the Forge REST records and a genuine local Git receive-pack endpoint. No request reaches an external host. */
export function fixtureForge(
  gitlab: boolean,
  repo: string,
  pin: string,
  token: string,
  actor: number,
  origin = "https://api.github.com/",
  readBranch?: (branch: string) => Promise<string | undefined>,
) {
  const branches = new Map<string, string>([["main", pin]]);
  const reviews: Review[] = [];
  const counts = { create: 0, close: 0, push: 0, limited: 0 };
  const flags = { protected: true, rateLimit: false, loseCreatedResponse: false };
  const requests: string[] = [];
  const prefix = gitlab ? `api/v4/projects/${encodeURIComponent(repo)}` : `repos/${repo}`;
  const pulls = gitlab ? "merge_requests" : "pulls";
  const shape = (review: Review) =>
    gitlab
      ? {
          iid: review.id,
          description: review.body,
          source_project_id: 7,
          target_project_id: 7,
          source_branch: review.branch,
          target_branch: review.base,
          sha: review.head,
          author: { id: review.actor },
          state: review.status === "review" ? "opened" : review.status,
          head_pipeline: { sha: review.head, status: "success" },
        }
      : {
          number: review.id,
          body: review.body,
          user: { id: review.actor },
          head: { ref: review.branch, sha: review.head, repo: { id: 7 } },
          base: { ref: review.base, repo: { id: 7 } },
          state: review.status === "review" ? "open" : "closed",
          merged: review.status === "merged",
        };
  const request = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    assert.ok(url.href.startsWith(origin), url.href);
    assert.equal(init?.redirect, "error");
    const authorization = new Headers(init?.headers);
    assert.equal(authorization.get(gitlab ? "private-token" : "authorization"), gitlab ? token : `Bearer ${token}`);
    const body = typeof init?.body === "string" ? init.body : "";
    assert.ok(!url.href.includes(token));
    assert.ok(!body.includes(token));
    const method = init?.method ?? "GET";
    const endpoint = decodeURI(url.pathname.slice(new URL(origin).pathname.length));
    requests.push(`${method} ${endpoint}`);
    const route = endpoint.slice(prefix.length).split("/").slice(1);
    const json = (value: unknown) => Response.json(value);
    if (endpoint === (gitlab ? "api/v4/user" : "user")) return json({ id: actor });
    assert.ok(endpoint.startsWith(prefix), endpoint);
    if (!route.length) {
      return json(
        gitlab
          ? { id: 7, path_with_namespace: repo, default_branch: "main", archived: false }
          : { id: 7, full_name: repo, default_branch: "main", archived: false },
      );
    }
    if (route[0] === "branches" || route[0] === "repository") {
      const name = decodeURIComponent(route.at(-1) ?? "");
      const commit = branches.get(name) ?? (await readBranch?.(name));
      if (!commit) return new Response(null, { status: 404 });
      return json({
        name,
        protected: name === "main" && flags.protected,
        commit: gitlab ? { id: commit } : { sha: commit },
      });
    }
    if (route[0] === "commits") {
      return json(
        route[2] === "check-runs"
          ? {
              total_count: 1,
              check_runs: [{ status: "completed", conclusion: "success", head_sha: route[1] }],
            }
          : { state: "pending", total_count: 0 },
      );
    }
    assert.equal(route[0], pulls);
    if (route.length === 1 && method === "GET") {
      const branch = gitlab ? url.searchParams.get("source_branch") : url.searchParams.get("head")?.split(":")[1];
      return json(reviews.filter((review) => review.branch === branch).map(shape));
    }
    if (route.length === 1 && method === "POST") {
      if (flags.rateLimit) {
        flags.rateLimit = false;
        counts.limited += 1;
        return new Response("discarded", { status: 429, headers: { "retry-after": "2" } });
      }
      const fields = JSON.parse(body);
      const branch = gitlab ? fields.source_branch : fields.head;
      const base = gitlab ? fields.target_branch : fields.base;
      const head = branches.get(branch) ?? (await readBranch?.(branch));
      assert.ok(head);
      assert.equal(base, "main");
      assert.equal(reviews.length, 0, "did not create a duplicate request");
      const review: Review = {
        id: 18,
        actor,
        branch,
        base,
        head,
        status: "review",
        body: gitlab ? fields.description : fields.body,
      };
      counts.create++;
      reviews.push(review);
      if (flags.loseCreatedResponse) {
        flags.loseCreatedResponse = false;
        throw new Error("Lost provider response");
      }
      return json(shape(review));
    }
    const review = reviews.find(({ id }) => id === Number(route[1]));
    assert.ok(review);
    if (route[2] === "approvals") return json({ approved: true });
    if (route[2] === "reviews") return json([{ user: { id: 9 }, state: "APPROVED" }]);
    if (method === "PATCH" || method === "PUT") {
      assert.deepEqual(JSON.parse(body), gitlab ? { state_event: "close" } : { state: "closed" });
      counts.close++;
      review.status = "closed";
    }
    return json(shape(review));
  }) as typeof fetch;
  return { request, flags, counts, requests, reviews, branches };
}

function gitBackend(request: IncomingMessage, response: ServerResponse, root: string) {
  const url = new URL(request.url ?? "/", "http://fixture.invalid");
  const backend = spawn("git", ["http-backend"], {
    env: {
      PATH: process.env.PATH,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: "1",
      REQUEST_METHOD: request.method,
      PATH_INFO: url.pathname.replace(/^\/forge\//u, "/"),
      QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: request.headers["content-type"],
      CONTENT_LENGTH: request.headers["content-length"],
      REMOTE_USER: "fixture",
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
      const name = header.slice(0, index);
      const value = header.slice(index + 1).trim();
      if (name === "Status") response.statusCode = Number.parseInt(value, 10);
      else if (index > 0) response.setHeader(name, value);
    }
    response.write(pending.subarray(boundary + 4));
  });
  backend.on("close", () => response.end());
  backend.on("error", () => response.writeHead(500).end());
}

export async function gitLoopback(
  t: TestContext,
  root: string,
  source: string,
  pin: string,
  token: string,
  actor: number,
  gitlab: boolean,
) {
  const repo = gitlab ? "group/migration" : "example/upgrade";
  const bare = join(root, "forge", repo + ".git");
  await mkdir(dirname(bare), { recursive: true });
  const git = async (...argv: string[]) => (await exec("git", ["-C", bare, ...argv])).stdout.trim();
  await exec("git", ["clone", "--bare", "--", source, bare]);
  await git("config", "http.receivepack", "true");
  const server = createServer();
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}/forge`;
  const api = gitlab ? origin + "/" : "https://api.github.com/";
  const forge = fixtureForge(gitlab, repo, pin, token, actor, api, (branch) =>
    git("rev-parse", "--verify", "refs/heads/" + branch).catch(() => undefined),
  );
  server.on("request", async (request, response) => {
    try {
      if (request.url?.startsWith("/forge/" + repo + ".git/")) {
        const user = gitlab ? "oauth2" : "x-access-token";
        const basic = Buffer.from(user + ":" + token).toString("base64");
        assert.equal(request.headers.authorization, "Basic " + basic);
        if (request.method === "POST") forge.counts.push++;
        gitBackend(request, response, join(root, "forge"));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headers.set(key, value);
      }
      const result = await forge.request(new URL(request.url ?? "/", origin), {
        headers,
        redirect: "error",
        ...(request.method && { method: request.method }),
        ...(chunks.length > 0 && { body: Buffer.concat(chunks).toString("utf8") }),
      });
      response.statusCode = result.status;
      for (const [name, value] of result.headers) response.setHeader(name, value);
      response.end(await result.text());
    } catch {
      response.writeHead(502).end("test response lost");
    }
  });
  return { git, origin, repo, ...forge };
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { readGitHubForecastFiles } from "../src/forecast-tool/remote/github.js";
import { parseGitHubForecastInput } from "../src/forecast-tool/remote/input.js";

const input = { kind: "url", value: "github/example/project@feature%2Fforecast" } as const;
const treeUrl = "https://api.github.com/repos/example/project/git/trees/feature%2Fforecast?recursive=1";
const raw = "https://raw.githubusercontent.com/example/project/feature%2Fforecast/";
const bytes = new TextEncoder();

function blob(path: string, contents: Uint8Array) {
  const size = contents.byteLength;
  const sha = createHash("sha1").update(`blob ${size}\0`).update(contents).digest("hex");
  return { path, size, sha, mode: "100644", type: "blob" };
}

function tree(entries: readonly unknown[]): Response {
  return Response.json({ truncated: false, tree: entries });
}

function fixtureFetch(respond: (url: string) => Response) {
  const requests: string[] = [];
  const fetchPublic: typeof fetch = async (value, init) => {
    assert.ok(typeof value === "string");
    assert.deepEqual(init, { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    requests.push(value);
    return respond(value);
  };
  return { requests, fetchPublic };
}

test("acc-forecast-link parses just the GitHub fragment input with default, slash and encoded refs", () => {
  assert.deepEqual(parseGitHubForecastInput("github/My-Team/.github"), {
    owner: "My-Team",
    repo: ".github",
    ref: "HEAD",
  });
  assert.deepEqual(parseGitHubForecastInput(input.value), {
    owner: "example",
    repo: "project",
    ref: "feature/forecast",
  });
  for (const ref of ["feature/forecast", "v1.2.3", "a".repeat(40)]) {
    assert.equal(parseGitHubForecastInput(`github/example/project@${ref}`).ref, ref);
  }
  for (const value of [
    "https://github.com/example/project",
    "#github/example/project",
    "gitlab/example/project",
    "GitHub/example/project",
    "github/example",
    "github/bad--owner/project",
    "github/-owner/project",
    "github/example/..",
    "github/example/.",
    "github/example/project/",
    "github/example/project\n",
    "github/example/project@",
    "github/example/project@@",
    "github/example/project@x?",
    "github/example/project@x.lock/ok",
    "github/example/project@x/.",
    "github/example/project@/x",
    "github/example/project@x%2f..%2fy",
    "github/example/project@x%00",
    "github/example/project@x%ZZ",
    `github/example/project@${"a".repeat(513)}`,
  ]) {
    assert.throws(() => parseGitHubForecastInput(value), /Use github\/<owner>\/<repo>/u, value);
  }
});

test("acc-forecast-link reads one tree and fetches only supported regular files from raw GitHub", async () => {
  const recorded: { tree: unknown; files: Record<string, string> } = JSON.parse(
    await readFile("tests/fixtures/forecast-link/github.json", "utf8"),
  );
  const { requests, fetchPublic } = fixtureFetch((url) => {
    if (url === treeUrl) return Response.json(recorded.tree);
    assert.ok(url.startsWith(raw), url);
    const path = decodeURIComponent(url.slice(raw.length));
    const contents = recorded.files[path];
    assert.notEqual(contents, undefined, path);
    return new Response(contents);
  });
  const files = await readGitHubForecastFiles(input, fetchPublic);
  const paths = Object.keys(recorded.files).sort();
  assert.deepEqual(
    files,
    paths.map((path) => ({ path, contents: recorded.files[path] })),
  );
  assert.equal(requests[0], treeUrl);
  assert.equal(requests.length, paths.length + 1);
  assert.ok(requests.includes(`${raw}packages/app%20group/package.json`));
});

test("acc-forecast-link caps repository file count and combined selected bytes", async () => {
  const empty = new Uint8Array();
  const million = new Uint8Array(1024 * 1024).fill(97);
  const many = Array.from({ length: 42 }, (_, i) => blob(`pkg-${i}/package.json`, empty));
  const large = Array.from({ length: 6 }, (_, i) => blob(`pkg-${i}/package.json`, million));
  for (const [entries, contents, max] of [
    [many, empty, 40],
    [large, million, 5],
  ] as const) {
    const { requests, fetchPublic } = fixtureFetch((url) => (url === treeUrl ? tree(entries) : new Response(contents)));
    const files = await readGitHubForecastFiles(input, fetchPublic);
    assert.equal(files.length, max);
    assert.equal(requests.length, max + 1);
  }
});

test("acc-forecast-link rejects untrusted, truncated and overlarge tree responses before reading files", async () => {
  const duplicate = blob("package.json", bytes.encode("{}"));
  for (const [response, message] of [
    [Response.json({ tree: [duplicate], truncated: true }), /truncated the repository tree/u],
    [tree([duplicate, duplicate]), /duplicate repository path/u],
    [new Response("not-json"), /invalid repository tree/u],
    [Response.json({ tree: [] }), /invalid repository tree/u],
    [new Response("", { headers: { "Content-Length": "8388609" } }), /repository tree exceeds 8388608 bytes/u],
    [new Response(null, { status: 302, headers: { Location: "https://external.invalid" } }), /HTTP 302/u],
  ] as const) {
    const { requests, fetchPublic } = fixtureFetch(() => response);
    await assert.rejects(readGitHubForecastFiles(input, fetchPublic), message);
    assert.deepEqual(requests, [treeUrl]);
  }
  const transport = fixtureFetch(() => {
    throw new TypeError("Redirect refused by the browser");
  });
  await assert.rejects(readGitHubForecastFiles(input, transport.fetchPublic), /Could not fetch the repository tree/u);
  assert.deepEqual(transport.requests, [treeUrl]);
});

test("acc-forecast-link checks the bytes as read and the Git blob before decoding", async () => {
  const valid = bytes.encode("{}");
  const file = blob("package.json", valid);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(valid);
      controller.enqueue(bytes.encode("more"));
    },
    cancel() {
      cancelled = true;
    },
  });
  for (const [data, listed, message] of [
    [new Response(stream), file, /package.json exceeds 2 bytes/u],
    [new Response("[]"), file, /GitHub file changed while reading package.json/u],
    [new Response(""), file, /GitHub file changed while reading package.json/u],
    [new Response(Uint8Array.of(255)), blob("package.json", Uint8Array.of(255)), /is not UTF-8 text/u],
  ] as const) {
    const { requests, fetchPublic } = fixtureFetch((url) => (url === treeUrl ? tree([listed]) : data));
    await assert.rejects(readGitHubForecastFiles(input, fetchPublic), message);
    assert.deepEqual(requests, [treeUrl, `${raw}package.json`]);
  }
  assert.equal(cancelled, true);
});

test("acc-forecast-link explains the remaining request budget and reset time without retrying", async () => {
  for (const [response, message] of [
    [
      new Response(null, { status: 403, headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1790000000" } }),
      /GitHub rate limit reached. Remaining requests: 0. Reset time: 2026-09-21T14:13:20.000Z/u,
    ],
    [
      new Response(null, { status: 429 }),
      /GitHub rate limit reached. Remaining requests: unavailable. Reset time: unavailable/u,
    ],
    [
      new Response(null, {
        status: 403,
        headers: { "Retry-After": "60", "X-RateLimit-Remaining": "17", "X-RateLimit-Reset": "invalid" },
      }),
      /GitHub rate limit reached. Remaining requests: 17. Reset time: unavailable. Retry after 60 seconds/u,
    ],
    [
      Response.json(
        { message: "You have exceeded a secondary rate limit." },
        {
          status: 403,
          headers: { "X-RateLimit-Remaining": "27" },
        },
      ),
      /GitHub rate limit reached. Remaining requests: 27. Reset time: unavailable/u,
    ],
    [new Response(null, { status: 403 }), /Could not fetch the repository tree from GitHub \(HTTP 403\)/u],
  ] as const) {
    const { requests, fetchPublic } = fixtureFetch(() => response);
    await assert.rejects(readGitHubForecastFiles(input, fetchPublic), message);
    assert.deepEqual(requests, [treeUrl]);
  }
});

test("acc-forecast-link preserves rate and size errors when cancelling response streams fails", async () => {
  const size = blob("package.json", bytes.encode("{}"));
  const source = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.encode("oversized"));
      },
      cancel() {
        throw new Error("Transport lost");
      },
    });
  const rate = fixtureFetch(() => new Response(source(), { status: 429 }));
  await assert.rejects(readGitHubForecastFiles(input, rate.fetchPublic), /GitHub rate limit reached/u);
  assert.deepEqual(rate.requests, [treeUrl]);
  const over = fixtureFetch((url) => (url === treeUrl ? tree([size]) : new Response(source())));
  await assert.rejects(readGitHubForecastFiles(input, over.fetchPublic), /package.json exceeds 2 bytes/u);
  const empty = fixtureFetch((url) =>
    url === treeUrl ? tree([blob("package.json", new Uint8Array())]) : new Response(null),
  );
  assert.deepEqual(await readGitHubForecastFiles(input, empty.fetchPublic), [{ path: "package.json", contents: "" }]);
});

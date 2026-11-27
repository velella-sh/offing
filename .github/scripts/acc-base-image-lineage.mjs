import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

const [bin] = process.argv.slice(2);
if (!bin) throw new Error("Usage: node acc-base-image-lineage.mjs <installed offing bin>");
const root = await mkdtemp(join(tmpdir(), "offing-lineage-smoke-"));
const fixture = new URL("../../tests/fixtures/lineage/", import.meta.url);
const digest = "sha256:" + "a".repeat(64);

function cli(args, env = process.env) {
  const result = spawnSync(bin, args, { env, encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout;
}

async function verifyMcp(path) {
  const expected = JSON.parse(cli(["lineage", path, "--json"]));
  const server = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: server.stdout });
  const messages = lines[Symbol.asyncIterator]();
  const timer = setTimeout(() => server.kill(), 15_000);
  const send = (method, params, id) => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params, id }) + "\n");
  const receive = async () => {
    const message = await messages.next();
    assert.equal(message.done, false);
    const response = JSON.parse(message.value);
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    return response.result;
  };
  try {
    send("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "offing-smoke", version: "1" } }, 1);
    assert.ok((await receive()).capabilities.tools);
    send("notifications/initialized");
    send("tools/list", {}, 2);
    assert.ok((await receive()).tools.some(({ name }) => name === "image_lineage"));
    send("tools/call", { name: "image_lineage", arguments: { repository_path: path } }, 3);
    const result = await receive();
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, expected);
  } finally {
    clearTimeout(timer);
    lines.close();
    server.stdin.end();
    server.kill();
  }
}

async function mockRegistry() {
  const path = join(root, "registry.mjs");
  await writeFile(path, `
    import assert from "node:assert/strict";
    globalThis.fetch = async (input, init) => {
      const url = new URL(input);
      assert.equal(url.origin, "https://hub.docker.com");
      assert.equal(url.pathname, "/v2/namespaces/library/repositories/node/tags");
      assert.equal(init.redirect, "error");
      return Response.json({next: null, results: [{name: "18", digest: "${digest}"}]});
    };
  `);
  const importFlag = "--import=" + pathToFileURL(path).href;
  return { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, importFlag].filter(Boolean).join(" ") };
}

try {
  await cp(fixture, root, { recursive: true });
  for (const [from, to] of [
    ["image.fixture", "Dockerfile"],
    ["app.image.fixture", "app.Dockerfile"],
    ["images/base.image.fixture", "images/base.Dockerfile"],
  ]) await rename(join(root, from), join(root, to));

  const report = JSON.parse(cli(["lineage", root, "--json"]));
  const installedRoot = resolve(dirname(await realpath(bin)), "../..");
  const schema = JSON.parse(await readFile(join(installedRoot, "schemas/lineage.v1.schema.json"), "utf8"));
  const validate = new Ajv2020().compile(schema);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  const main = report.chains.find(({ path }) => path === "Dockerfile");
  assert.deepEqual(main.links.at(-1).parents, [2, 3]);
  assert.equal(main.links.at(-1).baseOs, "no-data");
  const offline = report.chains.find(({ path, line }) => path === "compose.yaml" && line === 5);
  assert.equal(offline.links[0].status, "unknown");
  assert.match(cli(["lineage", root]), /COPY build/);
  assert.match(cli(["lineage", root, "--format", "mermaid"]), /^flowchart TD/);
  const resolved = JSON.parse(cli(["lineage", root, "--json", "--resolve-digests"], await mockRegistry()));
  assert.deepEqual(resolved.chains.find(({ path, line }) => path === "compose.yaml" && line === 5).links[0].matchingTags, ["18"]);
  const scan = JSON.parse(cli(["scan", root, "--json", "--only", "container", "--no-cache"]));
  assert.match(scan.findings.find(({ location }) => location.path === "app.Dockerfile").summary, /app\.Dockerfile:1.*images\/base\.Dockerfile:1/);
  const small = join(root, "mcp");
  await mkdir(small);
  await cp(join(root, "Dockerfile"), join(small, "Dockerfile"));
  await verifyMcp(small);
  console.log("acc-base-image-lineage: packaged schema, scan evidence, MCP parity, and opt-in digest lookup passed");
} finally {
  await rm(root, { recursive: true, force: true });
}

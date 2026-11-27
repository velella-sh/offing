import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const [tarball, installedCli, actionBundle] = process.argv.slice(2);
if (!tarball || !installedCli || !actionBundle) {
  throw new Error("Usage: node acc-sbom-scan.mjs <tarball> <installed offing bin> <Action bundle>");
}
const source = fileURLToPath(new URL("../..", import.meta.url));
const cwd = await mkdtemp(join(tmpdir(), "offing-sbom-consumer-"));
const bin = resolve(installedCli);
const common = { cwd, encoding: "utf8", timeout: 20_000 };
const rule = "npm.package.request.deprecated";

function requireFinding(report, pointer) {
  assert.equal(report.schemaVersion, "offing.scan.v1");
  const finding = report.findings.find(({ ruleId }) => ruleId === rule);
  assert.equal(finding?.location.jsonPointer, pointer);
}

async function checkMcp() {
  const server = spawn(bin, ["mcp"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: server.stdout });
  const messages = lines[Symbol.asyncIterator]();
  const timeout = setTimeout(() => server.kill(), 15_000);
  const send = (method, id, params) => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, id, params }) + "\n");
  const receive = async (id) => {
    for (;;) {
      const message = await messages.next();
      assert.ok(!message.done, `MCP server stopped before reply ${id}`);
      const reply = JSON.parse(message.value);
      if (reply.id !== id) continue;
      assert.equal(reply.error, undefined);
      return reply.result;
    }
  };
  try {
    send("initialize", 1, {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "offing-package-smoke", version: "1.0.0" },
    });
    assert.ok((await receive(1)).capabilities.tools);
    send("notifications/initialized");
    send("tools/call", 2, { name: "scan_sbom", arguments: { sbom_path: "image.cdx.json" } });
    const response = await receive(2);
    assert.notEqual(response.isError, true);
    requireFinding(response.structuredContent, "/components/0");
  } finally {
    clearTimeout(timeout);
    lines.close();
    server.stdin.end();
    server.kill();
  }
}

try {
  const cdx = await readFile(join(source, "examples/sbom/image.cdx.json"), "utf8");
  const spdx = await readFile(join(source, "examples/sbom/repository.spdx.json"), "utf8");
  await writeFile(join(cwd, "image.cdx.json"), cdx);
  await writeFile(join(cwd, "image.syft.json"), JSON.stringify({
    descriptor: { name: "syft" },
    artifacts: [{ name: "request", purl: "pkg:npm/request@2.88.2" }],
  }));
  const scan = (file, input) => JSON.parse(execFileSync(bin, ["scan", "--sbom", file, "--json"], { ...common, input }));
  requireFinding(scan("image.cdx.json"), "/components/0");
  requireFinding(scan("image.syft.json"), "/artifacts/0");
  requireFinding(scan("-", spdx), "/packages/0");
  await checkMcp();

  const outputs = join(cwd, "action-outputs");
  await writeFile(outputs, "");
  const action = spawnSync(process.execPath, [resolve(actionBundle)], {
    ...common,
    env: {
      GITHUB_WORKSPACE: cwd,
      RUNNER_TEMP: cwd,
      GITHUB_OUTPUT: outputs,
      INPUT_SBOM: "image.cdx.json",
      INPUT_SARIF: "true",
      "INPUT_FAIL-ON-SEVERITY": "info",
    },
  });
  assert.equal(action.status, 1, action.stdout + action.stderr);
  const output = await readFile(outputs, "utf8");
  const report = output.match(/^report-path=(.+)$/m)?.[1];
  const sarif = output.match(/^sarif-path=(.+)$/m)?.[1];
  assert.ok(report && sarif, output);
  requireFinding(JSON.parse(await readFile(report, "utf8")), "/components/0");
  execFileSync(process.execPath, [join(source, "docs/spec/sarif/conformance/check.mjs"), sarif], common);

  const digest = createHash("sha256").update(await readFile(tarball)).digest("hex");
  const version = execFileSync(bin, ["--version"], common).trim();
  const commit = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  const summary = [
    "### acc-sbom-scan",
    "",
    `- Tarball ${basename(tarball)} (SHA-256 ${digest})`,
    `- Installed Offing ${version}, commit ${commit}`,
    "- Installed CLI passed CycloneDX and Syft file scans and an SPDX scan over stdin.",
    "- Installed MCP scan_sbom and the bundled Action agreed on the component finding.",
    "- Action severity gate failed as expected and its SARIF passed the standalone lifecycle checker.",
    "",
  ].join("\n");
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
} finally {
  await rm(cwd, { recursive: true, force: true });
}

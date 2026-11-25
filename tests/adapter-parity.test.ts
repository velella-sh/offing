import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";

import { InMemoryTransport } from "@modelcontextprotocol/server";

import { runGitHubAction } from "../src/github-action.js";
import { readFramedMessages, startLanguageServer, writeFramedMessage } from "../src/lsp.js";
import type { MorePointer } from "../src/mcp/limit.js";
import { createOffingMcpServer } from "../src/mcp.js";
import { runScanRequest } from "../src/scan-request.js";
import { runCli } from "./cli-runner.js";

/*
 * One request, four interfaces. The CLI, the MCP server, the language server, and the GitHub Action are thin
 * adapters over `runScanRequest`, so scanning the same repository through each must return the same findings.
 */

const fixtureRoot = resolve("tests/fixtures/lsp");
let root: string;
let temporary: string;

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "offing-adapter-parity-"));
  root = join(temporary, "repository");
  await cp(fixtureRoot, root, { recursive: true });
});

after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

async function viaCore(): Promise<string[]> {
  const { result } = await runScanRequest({ root });
  return sorted(result.findings.map((finding) => finding.id));
}

async function viaCli(): Promise<string[]> {
  const { stdout } = await runCli(["scan", root, "--json", "--no-cache"]);
  return sorted((JSON.parse(stdout) as { findings: Array<{ id: string }> }).findings.map((finding) => finding.id));
}

async function viaAction(): Promise<string[]> {
  const outcome = await runGitHubAction({
    root,
    reportPath: join(temporary, "report.json"),
    failOnSeverity: "none",
  });
  return sorted(outcome.result.findings.map((finding) => finding.id));
}

/*
 * The MCP server is the one adapter that changes a document: an answer over the token cap is cut and ends with a
 * `more` pointer (decision 0040). The compact list still names every finding, so parity is read through it, and
 * `scan_repository` is held to the cap's contract: what it shows comes from that one list, and its pointer counts
 * exactly what it left out.
 */
async function viaMcp(): Promise<string[]> {
  const server = createOffingMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const answers = new Map<number, Record<string, unknown>>();
  clientTransport.onmessage = (message) => {
    const { id, result } = message as { id?: number; result?: Record<string, unknown> };
    if (id !== undefined) answers.set(id, result ?? {});
  };
  await clientTransport.start();
  await server.connect(serverTransport);
  const call = async (id: number, name: string) => {
    await clientTransport.send({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: { repository_path: root } },
    } as never);
    for (let waited = 0; !answers.has(id) && waited < 10_000; waited += 5) {
      await new Promise((done) => setTimeout(done, 5));
    }
    const result = answers.get(id);
    assert.ok(result, `${name} answered`);
    assert.notEqual(result.isError, true, `${name} failed`);
    return result.structuredContent;
  };
  try {
    const list = (await call(1, "list_deprecations")) as {
      deprecations: Array<{ id: string }>;
      more?: MorePointer;
    };
    assert.equal(list.more, undefined, "the compact list fits under the cap, so it names every finding");

    const scan = (await call(2, "scan_repository")) as { findings: Array<{ id: string }>; more?: MorePointer };
    assert.ok(scan, "scan_repository returned structured content");
    const shown = sorted(scan.findings.map((finding) => finding.id));
    const listed = sorted(list.deprecations.map((finding) => finding.id));
    if (scan.more === undefined) assert.deepEqual(shown, listed, "an answer inside the cap is the whole list");
    else {
      assert.deepEqual(
        shown,
        listed.filter((id) => shown.includes(id)),
        "a cut answer keeps findings from the same list",
      );
      assert.deepEqual(
        scan.more.omitted.find((entry) => entry.path === "findings"),
        { path: "findings", shown: shown.length, total: listed.length },
        "the pointer counts exactly the findings it left out",
      );
    }
    return listed;
  } finally {
    await server.close();
  }
}

async function viaLsp(): Promise<string[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages: Array<Record<string, unknown>> = [];
  const waiting = new Set<() => void>();
  readFramedMessages(output, (message) => {
    messages.push(message);
    for (const wake of [...waiting]) wake();
  });
  const server = startLanguageServer({
    input,
    output,
    debounceMs: 0,
    log: () => {},
  });
  const send = (message: Record<string, unknown>): void => writeFramedMessage(input, { jsonrpc: "2.0", ...message });
  send({
    id: 1,
    method: "initialize",
    params: {
      processId: null,
      rootUri: pathToFileURL(root).href,
      capabilities: {},
    },
  });
  send({ method: "initialized", params: {} });
  const paths = [join(".github", "workflows", "legacy.yml"), join(".github", "workflows", "other.yml")];
  const documents = await Promise.all(
    paths.map(async (path) => ({
      uri: pathToFileURL(join(root, path)).href,
      text: await readFile(join(root, path), "utf8"),
    })),
  );
  const ids = new Set<string>();
  try {
    for (const document of documents) {
      send({
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: document.uri,
            languageId: "yaml",
            version: 1,
            text: document.text,
          },
        },
      });
      const published = await new Promise<Array<{ data?: { findingId?: string } }>>((done, fail) => {
        const timer = setTimeout(() => fail(new Error("Timed out waiting for diagnostics.")), 10_000);
        const check = (): void => {
          const found = messages.find(
            (message) =>
              message.method === "textDocument/publishDiagnostics" &&
              (message.params as { uri?: string }).uri === document.uri,
          );
          if (!found) return;
          clearTimeout(timer);
          waiting.delete(check);
          done(
            (
              found.params as {
                diagnostics: Array<{ data?: { findingId?: string } }>;
              }
            ).diagnostics,
          );
        };
        waiting.add(check);
        check();
      });
      for (const diagnostic of published) if (diagnostic.data?.findingId) ids.add(diagnostic.data.findingId);
    }
  } finally {
    await server.dispose();
    input.end();
    output.end();
  }
  return sorted([...ids]);
}

test("the same repository returns the same findings through the core, CLI, MCP server, and GitHub Action", async () => {
  const expected = await viaCore();
  assert.ok(expected.length > 0, "the fixture has findings, so equality is meaningful");
  assert.deepEqual(await viaCli(), expected);
  assert.deepEqual(await viaMcp(), expected);
  assert.deepEqual(await viaAction(), expected);
});

test("the language server reports the same findings for the files the editor opened", async () => {
  // The editor scans open buffers one at a time; this fixture's findings all live in the two files it opens.
  assert.deepEqual(await viaLsp(), await viaCore());
});

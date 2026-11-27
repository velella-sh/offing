import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import { isIsoDate } from "@velella/ebb/registry";

import { staleDataWarning } from "../src/data-text.js";
import { MCP_TOOL_NAMES } from "../src/mcp.js";
import type { McpToolName } from "../src/mcp/tool-names.js";
import { copyFixtureTree } from "./fixture-copies.js";
import { connectMcpClient, type McpTestClient } from "./mcp-client.js";

/*
 * One recorded call per tool. Each file under tests/fixtures/mcp holds the request a client makes and the answer
 * the server gave. The test replays the request against a fresh server, offline, and holds the answer to the
 * recording. Record again with UPDATE_GOLDEN=1 after a deliberate change to an answer, then review the diff.
 */

const FIXTURES = resolve("tests/fixtures/mcp");
/** Stands for the path of the repository copy, in a recorded request and everywhere the answer repeats it. */
const REPOSITORY = "<repository>";
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ABSOLUTE_PATH = /^([A-Za-z]:)?[\\/]/;
/** Replaces, then removes, the warning that the lifecycle data is old. */
const STALE_DATA_WARNING = "<stale data warning>";
const OLD_DATA = /^The lifecycle data is (\d+) days old/;

const temporaryRoots: string[] = [];

interface Call {
  name: McpToolName;
  arguments: Record<string, unknown>;
}

interface Recorded {
  /** The calls the session made first; a tool answers only after the session observed what it asks about. */
  before?: Call[];
  request: Call;
  /** The structured content the server answered, with what changes between two runs taken out. */
  response: Record<string, unknown>;
}

/** With UPDATE_GOLDEN=1 each test writes what the server answers today instead of holding the server to the recording. */
const RECORD = process.env.UPDATE_GOLDEN === "1";

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

/** An array of unknown elements; `Array.isArray` alone would infer `any[]`. */
const isList = (value: unknown): value is unknown[] => Array.isArray(value);

/** A description of the lifecycle data: its version moves with every data release and its age with the calendar. */
const isDataDescription = (value: object): value is Record<string, unknown> =>
  "ageDays" in value && typeof value.ageDays === "number" && "stale" in value && typeof value.stale === "boolean";

/** Whether `text` is the warning a scan adds once the data is old. Its number of days is read back, so the wording
 * is the source's, and a reworded warning is compared like any other text. */
function isStaleDataWarning(text: string): boolean {
  const days = OLD_DATA.exec(text)?.[1];
  return days !== undefined && staleDataWarning({ ageDays: Number(days) }) === text;
}

/**
 * The answer with what differs between two runs taken out: the path of the repository copy, timestamps, the
 * description of the lifecycle data, and its warning that the data is old. Everything else is compared as it is.
 */
function stable(value: unknown, root: string): unknown {
  if (isList(value)) return value.map((item) => stable(item, root)).filter((item) => item !== STALE_DATA_WARNING);
  if (typeof value === "string") {
    if (TIMESTAMP.test(value)) return "<timestamp>";
    if (isStaleDataWarning(value)) return STALE_DATA_WARNING;
    return value.split(root).join(REPOSITORY);
  }
  if (value === null || typeof value !== "object") return value;
  if (isDataDescription(value)) return `<data: ${Object.keys(value).sort().join(", ")}>`;
  const stackContext = "schemaVersion" in value && value.schemaVersion === "offing.stack-context.v1";
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      stackContext && key === "asOf" && typeof item === "string" && isIsoDate(item)
        ? "<current day>"
        : stable(item, root),
    ]),
  );
}

/** Checks that a recorded call names a tool and carries no path of the machine the recording was written on. */
function checkCall(tool: McpToolName, call: Call, where: string): void {
  assert.ok((MCP_TOOL_NAMES as readonly string[]).includes(call.name), `${tool}.json: ${where} names no tool`);
  // An absolute path would not exist on the next machine.
  for (const [key, value] of Object.entries(call.arguments))
    assert.equal(
      typeof value === "string" && ABSOLUTE_PATH.test(value),
      false,
      `${tool}.json: "${where}.${key}" must be "${REPOSITORY}" or a path inside the repository`,
    );
}

async function readRecording(tool: McpToolName): Promise<Recorded> {
  const recording = JSON.parse(await readFile(resolve(FIXTURES, `${tool}.json`), "utf8")) as Recorded;
  checkCall(tool, recording.request, "request");
  assert.equal(recording.request.name, tool, `${tool}.json records a call to its own tool`);
  recording.before?.forEach((call) => checkCall(tool, call, "before"));
  return recording;
}

/** The recorded call as the client sends it: the placeholder becomes the path of the repository copy. */
function sent(call: Call, root: string): Record<string, unknown> {
  const arguments_ = Object.fromEntries(
    Object.entries(call.arguments).map(([key, value]) => [key, value === REPOSITORY ? root : value]),
  );
  return { name: call.name, arguments: arguments_ };
}

/** The structured content of a successful call, after checking that the text content is the same JSON. */
function answered(tool: string, result: Record<string, unknown>): Record<string, unknown> {
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
  assert.notEqual(result.isError, true, `${tool} failed: ${text}`);
  const structured = result.structuredContent as Record<string, unknown>;
  assert.deepEqual(JSON.parse(text), structured, `${tool}: the JSON text is the structured content`);
  return structured;
}

/** A fresh server with the calls the recording lists before its own, so the session is the one the answer needs. */
async function openSession({ before }: { before?: Call[] | undefined }, root: string): Promise<McpTestClient> {
  const client = await connectMcpClient();
  for (const call of before ?? []) answered(call.name, await client.request("tools/call", sent(call, root)));
  return client;
}

/** A validator for the output schema the server advertises for `tool`, with the formats the schemas use. */
async function advertisedValidator(client: McpTestClient, tool: McpToolName): Promise<ReturnType<Ajv2020["compile"]>> {
  const tools = (await client.request("tools/list")).tools as Array<{ name: string; outputSchema?: object }>;
  const schema = tools.find((entry) => entry.name === tool)?.outputSchema;
  assert.ok(schema, `${tool} advertises an output schema`);
  return new Ajv2020({ allErrors: true, strict: false })
    .addFormat("date-time", (value: string) => TIMESTAMP.test(value) && Number.isFinite(Date.parse(value)))
    .addFormat("date", isIsoDate)
    .addFormat("uri", (value: string) => URL.canParse(value))
    .compile(schema);
}

function writeRecording(tool: McpToolName, recording: Recorded): Promise<void> {
  return writeFile(resolve(FIXTURES, `${tool}.json`), `${JSON.stringify(recording, null, 2)}\n`);
}

for (const tool of MCP_TOOL_NAMES) {
  test(`${tool} answers its recorded request`, async () => {
    const { before, request, response } = await readRecording(tool);
    const root = await copyFixtureTree(resolve(FIXTURES, "repository"), temporaryRoots);
    const client = await openSession({ before }, root);
    try {
      const validate = await advertisedValidator(client, tool);
      const answer = answered(tool, await client.request("tools/call", sent(request, root)));
      assert.equal(validate(answer), true, `${tool}: ${JSON.stringify(validate.errors?.slice(0, 2))}`);
      if (RECORD) {
        const recorded = stable(answer, root) as Record<string, unknown>;
        await writeRecording(tool, { ...(before ? { before } : {}), request, response: recorded });
        return;
      }
      // The order of the fields is part of the answer: it is the order an agent reads them in.
      assert.deepEqual(Object.keys(answer), Object.keys(response), `${tool}: a field was added, removed, or moved`);
      assert.deepEqual(stable(answer, root), response, `${tool}: the answer differs from the recording`);
    } finally {
      await client.close();
    }
  });
}

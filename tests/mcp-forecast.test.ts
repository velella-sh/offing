import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

import { isIsoDate } from "@velella/ebb/registry";
import { Ajv2020 } from "ajv/dist/2020.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import type { RepositoryForecast } from "../src/forecast.js";
import { createOffingMcpServer } from "../src/mcp.js";
import { runCli } from "./cli-runner.js";

interface RpcResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

const temporaryRoots: string[] = [];

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "offing mcp-forecast-"));
  temporaryRoots.push(root);
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(root, ".github", "workflows", "ci.yml"),
    "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n",
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: { request: "2.88.2" } }, null, 2),
  );
  return root;
}

async function connect() {
  const server = createOffingMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (response: RpcResponse) => void>();
  let nextId = 1;
  clientTransport.onmessage = (message) => {
    const response = message as RpcResponse;
    if (typeof response.id === "number") pending.get(response.id)?.(response);
  };
  await clientTransport.start();
  await server.connect(serverTransport);
  const request = async (method: string, params?: Record<string, unknown>) => {
    const id = nextId;
    nextId += 1;
    const response = new Promise<RpcResponse>((resolve) => pending.set(id, resolve));
    await clientTransport.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) } as never);
    const received = await response;
    pending.delete(id);
    if (received.error) throw new Error(received.error.message ?? "MCP request failed");
    return received.result ?? {};
  };
  await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "offing-test", version: "1.0.0" },
  });
  await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" } as never);
  return {
    request,
    async close() {
      await clientTransport.close();
      await server.close();
    },
  };
}

async function cliForecast(root: string, months: number, asOf: string): Promise<RepositoryForecast> {
  const result = await runCli(["forecast", root, "--months", String(months), "--as-of", asOf, "--json"]);
  assert.equal(result.code, 0, "offing forecast --json must succeed");
  return JSON.parse(result.stdout) as RepositoryForecast;
}
async function validator() {
  const schema = JSON.parse(await readFile(resolve("schemas/forecast.v1.schema.json"), "utf8"));
  return new Ajv2020({ allErrors: true }).addFormat("date", isIsoDate).compile(schema);
}

test("forecast_repository returns the object offing forecast --json prints, valid against its published schema", async () => {
  const root = await fixtureRepository();
  const client = await connect();
  try {
    const call = await client.request("tools/call", {
      name: "forecast_repository",
      arguments: { repository_path: root, months: 12, as_of: "2026-10-29" },
    });
    assert.notEqual(call.isError, true);
    const forecast = call.structuredContent as unknown as RepositoryForecast;

    const validate = await validator();
    assert.ok(validate(forecast), JSON.stringify(validate.errors));

    assert.equal(forecast.schemaVersion, "ebb.forecast.v1");
    assert.equal(forecast.root, resolve(root));
    assert.equal(forecast.today, "2026-10-29");
    assert.equal(forecast.until, "2027-10-29");
    assert.equal(forecast.months, 12);
    const { noData, buckets, ...legacy } = forecast;
    assert.ok(validate(legacy), "the v1 schema still accepts documents that predate noData and buckets");
    assert.deepEqual(noData, []);

    // The buckets are the terminal report's grouping: three for a twelve-month window, and they sum to the total.
    assert.deepEqual(
      buckets.map(({ from, to, until, label }) => [from, to, until, label]),
      [
        [0, 3, "2027-01-29", "0-3 months"],
        [3, 6, "2027-04-29", "3-6 months"],
        [6, 12, "2027-10-29", "6-12 months"],
      ],
    );
    assert.equal(
      buckets.reduce((sum, { total }) => sum + total, 0),
      forecast.total,
    );
    for (const bucket of buckets) assert.equal(bucket.events.length, bucket.affecting);

    assert.deepEqual(
      forecast,
      await cliForecast(root, 12, "2026-10-29"),
      "the MCP tool must print what the CLI prints",
    );
  } finally {
    await client.close();
  }
});

test("forecast_repository is deterministic for a fixed as_of and keeps every event inside the window", async () => {
  const root = await fixtureRepository();
  const client = await connect();
  try {
    const args = { repository_path: root, months: 36, as_of: "2026-10-29" };
    const first = await client.request("tools/call", { name: "forecast_repository", arguments: args });
    const second = await client.request("tools/call", { name: "forecast_repository", arguments: args });
    assert.deepEqual(second.structuredContent, first.structuredContent, "the same fixed window renders the same bytes");

    const forecast = first.structuredContent as unknown as RepositoryForecast;
    const scan = await client.request("tools/call", { name: "scan_repository", arguments: { repository_path: root } });
    const findings = (scan.structuredContent as { findings: Array<{ id: string; location: { path: string } }> })
      .findings;
    const located = new Map(findings.map((finding) => [finding.id, finding.location.path]));

    let events = 0;
    let affecting = 0;
    for (const group of forecast.groups) {
      assert.ok(group.events.length > 0, `${group.month} must not be an empty group`);
      for (const event of group.events) {
        assert.equal(group.month, event.date.slice(0, 7), `${event.ruleId} is grouped under its own month`);
        assert.ok(event.date >= forecast.today && event.date <= forecast.until, `${event.ruleId} is inside the window`);
        for (const finding of event.findings) {
          assert.equal(located.get(finding.id), finding.path, `${finding.id} names the location its scan reported`);
        }
        events += 1;
        if (event.findings.length > 0) affecting += 1;
      }
    }
    assert.equal(forecast.total, events);
    assert.equal(forecast.affecting, affecting);

    // A longer horizon adds a fourth bucket, and every affecting event is in exactly one of them.
    assert.deepEqual(
      forecast.buckets.map(({ from, to }) => [from, to]),
      [
        [0, 3],
        [3, 6],
        [6, 12],
        [12, 36],
      ],
    );
    const key = ({ date, ruleId }: { date: string; ruleId: string }) => `${date} ${ruleId}`;
    const inGroups = forecast.groups.flatMap((group) => group.events).filter((event) => event.findings.length > 0);
    assert.deepEqual(
      forecast.buckets.flatMap((bucket) => bucket.events).map(key),
      inGroups.map(key),
      "the buckets list the affecting events once each, in date order",
    );
    assert.equal(
      forecast.buckets.reduce((sum, bucket) => sum + bucket.total, 0),
      forecast.total,
    );
  } finally {
    await client.close();
  }
});

test("forecast_repository defaults to twelve months and rejects a window outside its contract", async () => {
  const root = await fixtureRepository();
  const client = await connect();
  try {
    const defaults = await client.request("tools/call", {
      name: "forecast_repository",
      arguments: { repository_path: root },
    });
    assert.notEqual(defaults.isError, true);
    const forecast = defaults.structuredContent as unknown as RepositoryForecast;
    assert.equal(forecast.months, 12);
    assert.match(forecast.today, /^\d{4}-\d{2}-\d{2}$/, "without as_of the window starts today");

    for (const months of [0, 37, 1.5]) {
      const rejected = await client.request("tools/call", {
        name: "forecast_repository",
        arguments: { repository_path: root, months },
      });
      assert.equal(rejected.isError, true, `months ${months} is outside 1 to 36`);
      assert.match((rejected.content as Array<{ text: string }>)[0]!.text, /Input validation error/);
      assert.equal("structuredContent" in rejected, false);
    }
    for (const as_of of ["29-10-2026", "2026-02-29"]) {
      const badDate = await client.request("tools/call", {
        name: "forecast_repository",
        arguments: { repository_path: root, as_of },
      });
      assert.equal(badDate.isError, true);
      const [message] = badDate.content as Array<{ text: string }>;
      assert.match(message?.text ?? "", /as_of must be a date/);
    }
  } finally {
    await client.close();
  }
});

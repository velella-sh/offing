import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { promisify } from "node:util";

import { parse } from "yaml";

import { prepareForecast, readForecastMonths, selectForecastEvents } from "../src/github-action/forecast.js";
import { forecastOn, lifecycleEvent } from "./forecast-ics-fixture.js";

const run = promisify(execFile);
const date = "2026-11-16";
const clock = `import {mock} from 'node:test'; mock.timers.enable({apis:['Date'],now:Date.parse('${date}')});`;
const action = resolve("dist/src/action.js");
const replay = JSON.parse(await readFile("tests/fixtures/action/forecast-replay.json", "utf8")) as {
  event: {
    pull_request: {
      number: number;
      base: { repo: { full_name: string } };
      head: { repo: { full_name: string; fork: boolean } };
    };
  };
  responses: { method: string; path: string; status: number; body: unknown }[];
};

async function temporaryDirectory(t: TestContext, prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function twoCommits(t: TestContext) {
  const root = await temporaryDirectory(t, "offing-forecast-repo-");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git(
    "-c",
    "user.name=Offing",
    "-c",
    "user.email=offing@example.test",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "base",
  );
  const base = git("rev-parse", "HEAD");
  await writeFile(join(root, "package.json"), '{"engines":{"node":"22"}}\n');
  git("add", "package.json");
  git("-c", "user.name=Offing", "-c", "user.email=offing@example.test", "commit", "--quiet", "-m", "head");
  const head = git("rev-parse", "HEAD");
  // A merge checkout or dirty worktree can differ from the tested head SHA.
  await writeFile(join(root, "package.json"), "{}\n");
  return { root, base, head };
}

function pullRequest(base: string, head: string, fork = false) {
  const pr = replay.event.pull_request;
  return {
    pull_request: {
      ...pr,
      base: { ...pr.base, sha: base },
      head: { repo: fork ? { full_name: "contributor/project", fork } : pr.head.repo, sha: head },
    },
  };
}

async function recordAction(t: TestContext, root: string, env: NodeJS.ProcessEnv, event: object = {}) {
  const directory = await temporaryDirectory(t, "offing-forecast-runner-");
  const summary = join(directory, "summary.md");
  const output = join(directory, "output.txt");
  const payload = join(directory, "event.json");
  await writeFile(payload, JSON.stringify(event));
  const result = await run(
    process.execPath,
    ["--import", `data:text/javascript,${encodeURIComponent(clock)}`, action],
    {
      cwd: root,
      env: {
        ...process.env,
        GITHUB_WORKSPACE: root,
        GITHUB_REPOSITORY: "example/project",
        GITHUB_EVENT_PATH: payload,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        RUNNER_TEMP: directory,
        INPUT_FORECAST: "true",
        "INPUT_FAIL-ON-SEVERITY": "none",
        "INPUT_GITHUB-TOKEN": "fixture-token",
        ...env,
      },
    },
  );
  return { stdout: result.stdout, summary: await readFile(summary, "utf8"), output: await readFile(output, "utf8") };
}

async function commentReplay(t: TestContext) {
  const requests: { method: string | undefined; url: string | undefined; body: string }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const response = replay.responses[requests.length];
    requests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString("utf8") });
    res.writeHead(response?.status ?? 500, { "content-type": "application/json" });
    res.end(JSON.stringify(response?.body ?? {}));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { requests, api: { GITHUB_API_URL: `http://127.0.0.1:${address.port}` } };
}

test("the action renders the PR forecast, creates one comment, and updates it on the next run", async (t) => {
  const { root, base, head } = await twoCommits(t);
  const { api, requests } = await commentReplay(t);
  const event = pullRequest(base, head);
  const first = await recordAction(t, root, api, event);
  assert.match(first.summary, /\| Deadline \(UTC\) \| Event \| Severity \|/);
  assert.match(first.summary, /\| 2027-04-30 \| Node\\\.js 22 .* \| low \|/);
  const path = /^forecast-calendar-path=(.+)$/mu.exec(first.output)?.[1];
  assert.ok(path);
  assert.equal(basename(path), "offing-forecast.ics");
  const ics = await readFile(path, "utf8");
  assert.match(ics, /DTSTART;VALUE=DATE:20270430\r\n/);
  assert.equal(ics.match(/BEGIN:VEVENT/gu)?.length, 1);

  // The same marker also finds the existing comment after enabling the ordinary scan summary.
  const second = await recordAction(
    t,
    root,
    { ...api, "INPUT_PR-COMMENT": "true", "INPUT_FORECAST-MONTHS": "1" },
    event,
  );
  assert.match(second.summary, /introduces no new or earlier lifecycle deadlines/);
  assert.deepEqual(
    requests.map(({ method, url }) => [method, url]),
    replay.responses.map(({ method, path }) => [method, path]),
  );
  for (const [index, expected] of [
    [1, first.summary],
    [3, second.summary],
  ] as const) {
    const { body } = JSON.parse(requests[index]?.body ?? "{}");
    assert.match(body, /^<!-- offing-pr-comment -->/);
    assert.ok(body.endsWith(expected.slice(expected.indexOf("## Lifecycle forecast"))));
  }
});

test("forks still get the same forecast and calendar while skipping comment writes", async (t) => {
  const { root, base, head } = await twoCommits(t);
  const { api, requests } = await commentReplay(t);
  const output = await recordAction(t, root, api, pullRequest(base, head, true));
  assert.match(output.stdout, /Offing forecast comment skipped/);
  assert.match(output.summary, /Node\\\.js 22/);
  assert.match(output.output, /^forecast-calendar-path=/mu);
  assert.deepEqual(requests, []);
});

test("disabled forecast preserves the default and ignores the forecast horizon", async (t) => {
  const { root, base, head } = await twoCommits(t);
  const { api, requests } = await commentReplay(t);
  const env = { ...api, "INPUT_FORECAST-MONTHS": "typo" };
  const event = pullRequest(base, head);
  const result = await recordAction(t, root, { ...env, INPUT_FORECAST: "false" }, event);
  assert.doesNotMatch(result.summary, /Lifecycle forecast/);
  assert.doesNotMatch(result.output, /forecast-calendar-path/);
  assert.deepEqual(requests, []);
  await assert.rejects(recordAction(t, root, env, event), {
    code: 1,
    stdout: /forecast-months must be a whole number/,
  });
});

test("forecast-months accepts the inclusive horizon and rejects invalid values", () => {
  assert.equal(readForecastMonths(), 6);
  assert.equal(readForecastMonths("1"), 1);
  assert.equal(readForecastMonths("36"), 36);
  for (const invalid of ["0", "37", "1.5", "", "0x6", "infinite"]) assert.throws(() => readForecastMonths(invalid));
});

test("only newly affecting or earlier events survive the comparison", () => {
  const unchanged = lifecycleEvent({ ruleId: "unchanged" });
  const earlier = lifecycleEvent({ ruleId: "earlier" });
  const later = lifecycleEvent({ ruleId: "later", date: "2027-05-01" });
  const added = lifecycleEvent({ ruleId: "added" });
  const unrelated = lifecycleEvent({ ruleId: "unrelated", findings: [] });
  const base = forecastOn(
    date,
    unchanged,
    { ...earlier, date: "2027-05-01" },
    { ...later, date: unchanged.date },
    { ...added, findings: [] },
  );
  const head = forecastOn(date, earlier, added, unchanged, later, unrelated);
  const selected = selectForecastEvents(head, base);
  assert.deepEqual(
    selected.groups.flatMap(({ events }) => events),
    [earlier, added],
  );
  assert.equal(selected.affecting, 2);
});

test("an unavailable calendar leaves the summary available", async (t) => {
  const root = await temporaryDirectory(t, "offing-forecast-repo-");
  await writeFile(join(root, "package.json"), '{"engines":{"node":"22"}}\n');
  const result = await prepareForecast(root, join(root, "package.json"), date, 6);
  assert.match(result?.summary ?? "", /Node\\\.js 22/);
  assert.equal(result?.calendarPath, undefined);
});

test("a shallow checkout missing a PR commit leaves the ordinary scan available", async (t) => {
  const { root, head } = await twoCommits(t);
  const { api, requests } = await commentReplay(t);
  const output = await recordAction(t, root, api, pullRequest("0".repeat(40), head));
  assert.match(output.stdout, /Offing forecast skipped.*fetch-depth: 0/);
  assert.match(output.summary, /## Offing/);
  assert.doesNotMatch(output.summary, /Lifecycle forecast/);
  assert.doesNotMatch(output.output, /forecast-calendar-path/);
  assert.deepEqual(requests, []);
});

test("the action uploads one calendar artifact when its file was written", async () => {
  const actionYaml = parse(await readFile("action.yml", "utf8"));
  const uploads = actionYaml.runs.steps.filter(
    (step: { with?: { name?: string } }) => step.with?.name === "offing-forecast",
  );
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].uses, /^actions\/upload-artifact@/);
  assert.equal(uploads[0].if, "always() && steps.scan.outputs.forecast-calendar-path != ''");
  assert.equal(uploads[0].with.path, "${{ steps.scan.outputs.forecast-calendar-path }}");
  assert.equal(uploads[0].with["if-no-files-found"], "warn");
});

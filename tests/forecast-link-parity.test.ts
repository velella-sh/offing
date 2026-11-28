import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

import { validateRegistryV2 } from "@velella/ebb/registry";
import type { ForecastEvent } from "@velella/ebb/forecast";

import type { RepositoryForecast } from "../src/forecast-core.js";
import { forecastDataRelease, loadForecastData, type ForecastData } from "../src/forecast-tool/data.js";
import { toForecastRecords } from "../src/forecast-tool/records.js";
import { readGitHubForecastFiles } from "../src/forecast-tool/remote/github.js";
import { createRepositoryReport } from "../src/forecast-tool/report.js";

interface InputFile {
  path: string;
  contents: string;
}

interface PinnedRepository {
  repository: string;
  commit: string;
}

interface RecordedDeclaration extends PinnedRepository {
  path: string;
  text: string;
}

const fixtureDir = "tests/fixtures/forecast-link";
const today = "2026-09-01";
const cli = resolve("dist/src/cli.js");
const exec = promisify(execFile);

function eventKeys(events: Iterable<ForecastEvent>, project = "."): Set<string> {
  const keys = new Set<string>();
  for (const { ruleId, date, findings } of events) {
    for (const { path } of findings) keys.add(`${ruleId}|${date}|${posix.join(project, path)}`);
  }
  return keys;
}

async function materialize(t: TestContext, files: readonly InputFile[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "offing-forecast-parity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const { path, contents } of files) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, { flag: "wx" });
  }
  return root;
}

async function cliEvents(root: string, project = "."): Promise<Set<string>> {
  const directory = join(root, project);
  const { stdout } = await exec(
    process.execPath,
    [cli, "forecast", directory, "--json", "--as-of", today, "--months", "12"],
    {
      cwd: directory,
      env: { PATH: process.env.PATH, OFFING_DATA_VERSION: "bundled" },
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const forecast: RepositoryForecast = JSON.parse(stdout);
  return eventKeys(
    forecast.buckets.flatMap(({ events }) => events),
    project,
  );
}

async function selectedProjectEvents(root: string, files: readonly InputFile[]): Promise<Set<string>> {
  const directories = new Set(["."]);
  for (const { path } of files) {
    if (!path.startsWith(".github/workflows/")) directories.add(posix.dirname(path));
  }
  const events = new Set<string>();
  for (const project of directories) {
    for (const event of await cliEvents(root, project)) events.add(event);
  }
  return events;
}

function moduleEvents(files: readonly InputFile[], data: ForecastData, source: string): Set<string> {
  const { report, read, skipped } = createRepositoryReport(files, data, today, source);
  assert.deepEqual(skipped, [], "A parse failure is distinct from matching forecast results.");
  assert.equal(read.length, files.length);
  const { records } = toForecastRecords(report, data.version, { read, skipped, omitted: 0 });
  return eventKeys(records.filter((entry) => entry.kind === "finding"));
}

async function bundledData(): Promise<ForecastData> {
  const rules = (
    await Promise.all(
      ["npm", "nodejs", "python", "github-actions", "dotnet"].map(async (name) => {
        const body = await readFile(`node_modules/@velella/ebb/registry/${name}.json`, "utf8");
        return validateRegistryV2(body).rules;
      }),
    )
  ).flat();
  return { version: "bundled", rules, actionVersions: new Map() };
}

test("acc-forecast-link replays recorded runtime declaration disagreements and keeps standalone evidence", async (t) => {
  const recorded: Record<
    "engines" | "workflow" | "plugin" | "example" | "legacyLock" | "template",
    RecordedDeclaration
  > = JSON.parse(await readFile(join(fixtureDir, "parity-regressions.json"), "utf8"));
  const data = await bundledData();
  const scheduledNode = "nodejs.runtime.eol-22|2027-04-30|package.json";
  const laterPython = "python.runtime.eol-3.10-and-older|2026-10-01|";
  for (const [caseName, { repository, commit, path, text }] of Object.entries(recorded)) {
    const files = [{ path, contents: text }];
    const root = await materialize(t, files);
    const events = moduleEvents(files, data, `${repository}@${commit}`);
    assert.deepEqual(events, await selectedProjectEvents(root, files), caseName);
    if (caseName === "engines") {
      assert.equal(events.has(scheduledNode), false);
      const pin = [{ path, contents: '{"engines":{"node":"22.x"}}' }];
      const pinnedRoot = await materialize(t, pin);
      const pinned = moduleEvents(pin, data, "pinned Node control");
      assert.ok(pinned.has(scheduledNode));
      assert.deepEqual(pinned, await cliEvents(pinnedRoot));
    } else if (caseName === "workflow") {
      assert.equal(events.has(laterPython + path), false);
      const pin = [{ path, contents: text.replace("python-version: 3.9", "python-version: 3.10") }];
      const pinnedRoot = await materialize(t, pin);
      const pinned = moduleEvents(pin, data, "current Python control");
      assert.ok(pinned.has(laterPython + path));
      assert.deepEqual(pinned, await cliEvents(pinnedRoot));
    } else if (caseName === "plugin" || caseName === "example") {
      assert.ok(events.has(laterPython + path));
      assert.equal((await cliEvents(root)).has(laterPython + path), false);
    }
  }
});

test("acc-forecast-link compares the same supported files on all 20 pinned public repositories", {
  skip: process.env.OFFING_FORECAST_PARITY !== "1" && "Opt in to reading the 20 public GitHub pins.",
  timeout: 240_000,
}, async (t) => {
  const pins: PinnedRepository[] = JSON.parse(await readFile(join(fixtureDir, "parity-pins.json"), "utf8"));
  assert.equal(pins.length, 20);
  assert.equal(new Set(pins.map(({ repository }) => repository)).size, 20);
  const data = await loadForecastData((file) => readFile(join("dist/forecast-web", file)));
  assert.equal(data.version, forecastDataRelease.version);
  for (const { repository, commit } of pins) {
    assert.match(commit, /^[a-f\d]{40}$/);
    const value = `github/${repository}@${commit}`;
    await t.test(value, async (repoTest) => {
      const { files, skipped, omitted } = await readGitHubForecastFiles(
        { kind: "url", value },
        fetch,
        AbortSignal.timeout(30_000),
      );
      assert.ok(files.length > 0);
      assert.deepEqual(skipped, [], "Record gaps independently before declaring parity.");
      assert.equal(omitted, 0);
      const root = await materialize(repoTest, files);
      const expected = await selectedProjectEvents(root, files);
      const actual = moduleEvents(files, data, value);
      assert.deepEqual(
        {
          moduleOnly: [...actual].filter((key) => !expected.has(key)).sort(),
          cliOnly: [...expected].filter((key) => !actual.has(key)).sort(),
        },
        { moduleOnly: [], cliOnly: [] },
      );
    });
  }
});

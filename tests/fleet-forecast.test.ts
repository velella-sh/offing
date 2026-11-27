import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import { applyFallbackOwners } from "../src/fleet-forecast/capture.js";
import { parseForecastRecording } from "../src/fleet-forecast/input.js";
import {
  buildFleetForecast,
  changeKinds,
  compareFleetForecast,
  type ForecastObservation,
} from "../src/fleet-forecast/model.js";
import {
  renderFleetCalendars,
  renderFleetDigests,
  renderFleetForecastCard,
  renderFleetForecastText,
} from "../src/fleet-forecast/render.js";

const today = "2025-01-01";
const host = "https://github.com";
const commit = "0".repeat(40);

function observation(
  ruleId: string,
  deadline: string | null,
  owners: string[] = ["@example/team"],
): ForecastObservation {
  return { ruleId, deadline, owners, location: { path: `${ruleId}.yml`, line: 3 } };
}

function repo(name: string, findings: ForecastObservation[], noData: string[][] = []) {
  return { host, repository: `example/${name}`, evidence: { findings, noData } };
}

function captured() {
  return [
    repo(
      "core",
      [
        observation("near", "2025-01-01", ["@example/ops", "@example/team"]),
        observation("three", "2025-04-01"),
        observation("six", "2025-07-01", []),
        observation("twelve", "2026-01-01"),
        observation("beyond", "2026-01-02"),
      ],
      [[], ["@example/team"]],
    ),
    repo("edge", [observation("edge", "2025-04-01", [])]),
    repo("empty", []),
    { host, repository: "example/skipped" },
  ];
}

test("forecast covers cutoff boundaries, exact locations, fallback and multi-owner attribution once per owner", async () => {
  const repositories = applyFallbackOwners(captured(), { "example/edge": "Edge owners" });
  const forecast = buildFleetForecast(repositories, today);
  assert.deepEqual(forecast.unavailable, [{ host, repository: "example/skipped" }]);
  assert.deepEqual(forecast.coverage, { classified: 6, noData: 2, share: 0.25 });
  assert.deepEqual(
    forecast.byRepository[0]?.buckets.map(({ items }) => items.map(({ ruleId }) => ruleId)),
    [["near", "three"], ["six"], ["twelve"]],
  );
  assert.deepEqual(
    forecast.byOwner.map(({ name, coverage }) => [name, coverage.classified, coverage.noData]),
    [
      ["@example/ops", 1, 0],
      ["@example/team", 4, 1],
      ["Edge owners", 1, 0],
      ["unowned", 1, 1],
    ],
  );
  assert.deepEqual(forecast.byRepository[1]?.buckets[0]?.items[0]?.location, { path: "edge.yml", line: 3 });
  assert.equal(forecast.byRepository[2]?.coverage.share, null);
  assert.throws(() => buildFleetForecast(repositories, "2025-02-29"), /date/);
  const schema: object = JSON.parse(await readFile("schemas/fleet-forecast.v1.schema.json", "utf8"));
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
  assert.ok(validate(forecast), JSON.stringify(validate.errors));
  assert.match(renderFleetForecastText(forecast, "repository"), /example\/core \(https:\/\/github.com\)/);
  assert.match(renderFleetForecastText(forecast, "owner"), /unowned\n {2}1 of 2/);
});

test("compares windows without claiming an expired, later or unscanned finding was fixed", () => {
  const previous = buildFleetForecast(
    [
      repo("app", [
        observation("same", "2025-09-01"),
        observation("moved", "2025-05-24"),
        observation("fixed", "2025-08-30", ["@gone"]),
        observation("expired", today),
        observation("later", "2025-12-01"),
        observation("undated", "2025-12-04"),
      ]),
      repo("unavailable", [observation("unknown", "2025-07-01")]),
    ],
    today,
  );
  const observed = [
    repo("app", [
      observation("same", "2025-09-01"),
      observation("moved", "2025-02-01"),
      observation("added", "2025-04-01"),
      observation("later", "2027-01-01"),
      observation("undated", null),
    ]),
    { host, repository: "example/unavailable" },
  ];
  const current = buildFleetForecast(observed, "2025-01-15");
  const changes = compareFleetForecast(previous, current, observed);
  assert.deepEqual(
    changeKinds.map((kind) => changes[kind].map(({ ruleId }) => ruleId)),
    [["added"], ["moved"], ["fixed"]],
  );
  assert.match(renderFleetForecastText({ ...current, changes }, "owner"), /fixed: 1/);
  assert.ok([...renderFleetDigests({ ...current, changes }).values()].some((text) => text.includes("## Fixed")));
});

test("cards and owner calendars are byte-reproducible in both themes for shuffled repositories", () => {
  const repositories = applyFallbackOwners(captured(), {});
  const left = buildFleetForecast(repositories, today);
  const right = buildFleetForecast([...repositories].reverse(), today);
  for (const theme of ["light", "dark"] as const) {
    const card = renderFleetForecastCard(left, theme);
    assert.equal(card, renderFleetForecastCard(right, theme));
    assert.match(card, /2 owners · 4 repositories/);
    assert.match(card, /Nearest deadline: 2025-01-01/);
  }
  assert.notEqual(renderFleetForecastCard(left, "light"), renderFleetForecastCard(left, "dark"));
  const calendars = renderFleetCalendars(left);
  assert.deepEqual(calendars, renderFleetCalendars(right));
  assert.deepEqual(
    [...calendars.keys()].every((name) => /^owner-[a-z0-9-]+-[a-f0-9]{16}\.ics$/.test(name)),
    true,
  );
  const current = [...calendars].find(([file]) => file.includes("example-team"))?.[1] ?? "";
  assert.equal([...current.matchAll(/BEGIN:VEVENT/g)].length, 3);
  assert.match(current, /DTSTAMP:20250101T000000Z\r\n/);
  assert.match(current, /DTSTART;VALUE=DATE:20250401\r\n/);
  const digest = [...renderFleetDigests(left).values()].find((text) => text.includes("example/team"));
  assert.match(digest ?? "", /&#64;example\/team/);
});

test("accepts pinned evidence only, rejects old aggregates, inconsistent rows, duplicate repositories and unsafe paths", () => {
  const row = { host, name: "example/app", commit, status: "scanned", forecastEvidence: { findings: [], noData: [] } };
  const raw = { schemaVersion: "offing.fleet.v1", forecastAsOf: today, repositoryStatus: [row] };
  assert.deepEqual(parseForecastRecording(raw).repositories, [repo("app", [])]);
  assert.throws(() => parseForecastRecording({ ...raw, forecastAsOf: undefined }), /--forecast-input/);
  assert.throws(() => parseForecastRecording({ ...raw, repositoryStatus: [row, row] }), /Duplicate/);
  assert.throws(() => parseForecastRecording({ ...raw, repositoryStatus: [{ ...row, commit: null }] }), /Missing/);
  assert.throws(
    () =>
      parseForecastRecording({
        ...raw,
        repositoryStatus: [
          {
            ...row,
            forecastEvidence: {
              ...row.forecastEvidence,
              findings: [
                {
                  ...observation("rule", today),
                  location: { path: "../secret" },
                },
              ],
            },
          },
        ],
      }),
    /forecast evidence/,
  );
});

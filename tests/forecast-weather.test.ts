import assert from "node:assert/strict";
import { test } from "node:test";

import type { ForecastEvent } from "@velella/ebb/forecast";
import type { RepositoryForecast } from "../src/forecast.js";
import { renderForecastText } from "../src/forecast.js";

function event(date: string, severity: ForecastEvent["severity"], affectsRepository = true): ForecastEvent {
  return {
    date,
    severity,
    ruleId: "test.rule",
    title: "Test lifecycle event",
    ecosystem: "test",
    source: "",
    findings: affectsRepository ? [{ id: "test.finding", path: "manifest", line: 5 }] : [],
  };
}

function report(events: ForecastEvent[]): string {
  const forecast: RepositoryForecast = {
    schemaVersion: "ebb.forecast.v1",
    root: "/repo",
    today: "2026-10-25",
    until: "2027-10-25",
    months: 12,
    groups: [{ month: "2026-10", events }],
    affecting: events.filter((item) => item.findings.length > 0).length,
    total: events.length,
    noData: [],
  };
  return renderForecastText(forecast);
}

test("weather considers only repository events in the nearest bucket", () => {
  assert.match(report([event("2027-01-25", "critical", false), event("2027-01-26", "high")]), /^Weather: clear\n/);
  assert.match(report([event("2027-01-25", "medium")]), /^Weather: cloudy\n/);
  assert.match(report([event("2027-01-25", "high")]), /^Weather: storm\n/);
  assert.match(report([event("2027-01-25", "critical")]), /^Weather: storm\n/);
});

test("terminal locations keep line numbers when available and escape control characters", () => {
  const withLocation = event("2027-01-25", "low");
  withLocation.findings.push({ id: "another", path: "path\n\u001b[31m" });
  assert.match(report([withLocation]), / {4}manifest:5\n {4}path\\u000a\\u001b\[31m\n/);
});

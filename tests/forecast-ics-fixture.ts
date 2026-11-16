import type { Forecast, ForecastEvent } from "@velella/ebb/forecast";

export function lifecycleEvent(overrides: Partial<ForecastEvent> = {}): ForecastEvent {
  return {
    date: "2027-04-30",
    ruleId: "demo.eol",
    ecosystem: "demo",
    title: "Demo reaches end of life",
    severity: "low",
    source: "https://example.com/lifecycle",
    findings: [{ id: "demo:config", path: "config.json", line: 3 }],
    ...overrides,
  };
}

export function forecastOn(today: string, ...events: ForecastEvent[]): Forecast {
  return {
    schemaVersion: "ebb.forecast.v1",
    root: "/repo",
    today,
    until: "2027-10-25",
    months: 12,
    groups: events.map((event) => ({ month: event.date.slice(0, 7), events: [event] })),
    affecting: events.filter((event) => event.findings.length > 0).length,
    total: events.length,
  };
}

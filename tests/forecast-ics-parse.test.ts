import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";

import ICAL from "ical.js";

import { renderForecastIcs } from "../src/forecast-ics.js";
import { forecastOn, lifecycleEvent } from "./forecast-ics-fixture.js";

test("an ICS parser reads dated events and only alarms on or after the reference day", () => {
  const event = lifecycleEvent();
  const other = lifecycleEvent({ date: "2027-05-31" });
  const unrelated = lifecycleEvent({ ruleId: "elsewhere", findings: [] });

  for (const { today, expected } of [
    {
      today: "2027-01-30",
      expected: [
        ["-P90D", "-P30D"],
        ["-P90D", "-P30D"],
      ],
    },
    { today: "2027-03-31", expected: [["-P30D"], ["-P30D"]] },
    { today: "2027-06-01", expected: [[], []] },
  ]) {
    const calendar = new ICAL.Component(ICAL.parse(renderForecastIcs(forecastOn(today, event, other, unrelated))));
    const events = calendar.getAllSubcomponents("vevent");
    assert.deepEqual(
      events.map((component) => new ICAL.Event(component).startDate.toString()),
      ["2027-04-30", "2027-05-31"],
    );
    assert.ok(events.every((component) => new ICAL.Event(component).startDate.isDate));
    assert.deepEqual(
      events.map((component) =>
        component.getAllSubcomponents("valarm").map((alarm) => {
          assert.equal(alarm.getFirstPropertyValue("action"), "DISPLAY");
          assert.equal(alarm.getFirstPropertyValue("description"), event.title);
          return String(alarm.getFirstPropertyValue("trigger"));
        }),
      ),
      expected,
    );
  }
});

test("folds by UTF-8 bytes and preserves text after unfolding and unescaping", () => {
  const path = "src/" + "پوشه📅".repeat(20) + ",one;two\\nthree\r\nEND:VEVENT";
  const title = "پایان پشتیبانی, نسخه; بعدی";
  const event = lifecycleEvent({
    title,
    source: "https://example.com/lifecycle?q=a,b;c",
    findings: [
      { id: "demo:unicode", path, line: 3 },
      { id: "demo:other", path: "package.json" },
      { id: "demo:duplicate", path: "package.json" },
      { id: "demo:control", path: "control\u0000.json" },
    ],
  });
  const ics = renderForecastIcs(forecastOn("2026-10-25", event), [
    { id: "demo:unicode", replacement: "Use 2.0, or use 3.0" },
    { id: "demo:other", replacement: "Use 2.0, or use 3.0" },
  ]);
  assert.match(ics, /\r\n /);
  assert.doesNotMatch(ics.replaceAll("\r\n", ""), /[\r\n]/);
  for (const line of ics.split("\r\n")) {
    assert.ok(Buffer.byteLength(line) <= 75, line);
    assert.match(line, /^\P{Cs}*$/u);
  }

  const calendar = new ICAL.Component(ICAL.parse(ics));
  const [component] = calendar.getAllSubcomponents("vevent");
  assert.ok(component);
  assert.equal(component.getFirstPropertyValue("summary"), title);
  assert.equal(
    component.getFirstPropertyValue("description"),
    [
      "Affected files:",
      path.replace("\r\n", "\n") + ":3",
      "package.json",
      "control\ufffd.json",
      "Replacement: Use 2.0, or use 3.0",
      "Source: " + event.source,
    ].join("\n"),
  );
});

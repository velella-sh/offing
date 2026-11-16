import { addDays } from "@velella/ebb/forecast";
import type { Forecast, ForecastEvent } from "@velella/ebb/forecast";

import type { Finding } from "./domain.js";

function escapeText(text: string): string {
  return text.replace(/\r\n|[\\,;]|\p{Cc}/gu, (character) => {
    switch (character) {
      case "\\":
      case ",":
      case ";":
        return "\\" + character;
      case "\r\n":
      case "\r":
      case "\n":
        return "\\n";
      case "\t":
        return character;
      default:
        return "\ufffd";
    }
  });
}

const utf8 = new TextEncoder();

function foldLine(line: string): string {
  let folded = "";
  let bytes = 0;
  for (const character of line) {
    const length = utf8.encode(character).byteLength;
    if (bytes + length > 75) {
      folded += "\r\n ";
      bytes = 1;
    }
    folded += character;
    bytes += length;
  }
  return folded;
}

function calendarDate(date: string): string {
  return date.replaceAll("-", "");
}

function eventDescription(event: ForecastEvent, replacements: ReadonlyMap<string, string>): string {
  const locations = new Set(event.findings.map(({ path, line }) => (line === undefined ? path : path + ":" + line)));
  const suggestions = new Set<string>();
  for (const { id } of event.findings) {
    const replacement = replacements.get(id);
    if (replacement) suggestions.add(replacement);
  }
  const lines = ["Affected files:", ...locations];
  for (const replacement of suggestions) lines.push("Replacement: " + replacement);
  if (event.source) lines.push("Source: " + event.source);
  return escapeText(lines.join("\n"));
}

function eventLines(event: ForecastEvent, today: string, replacements: ReadonlyMap<string, string>): string[] {
  const title = escapeText(event.title);
  const lines = [
    "BEGIN:VEVENT",
    "UID:" + escapeText(event.ruleId + "-" + event.date + "@offing"),
    "DTSTAMP:" + calendarDate(today) + "T000000Z",
    "DTSTART;VALUE=DATE:" + calendarDate(event.date),
    "SUMMARY:" + title,
    "DESCRIPTION:" + eventDescription(event, replacements),
  ];
  for (const days of [90, 30]) {
    if (addDays(event.date, -days) < today) continue;
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P" + days + "D", "DESCRIPTION:" + title, "END:VALARM");
  }
  lines.push("END:VEVENT");
  return lines;
}

// RFC 5545 §3.4 requires a component even when the calendar has no events.
const emptyCalendarComponent = [
  "BEGIN:VTIMEZONE",
  "TZID:Etc/UTC",
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:+0000",
  "TZOFFSETTO:+0000",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** Export only the lifecycle dates affecting the scanned repository. */
export function renderForecastIcs(
  forecast: Forecast,
  findings: readonly Pick<Finding, "id" | "replacement">[] = [],
): string {
  const replacements = new Map<string, string>();
  for (const finding of findings) {
    if (finding.replacement) replacements.set(finding.id, finding.replacement);
  }
  const events = forecast.groups
    .flatMap((group) => group.events)
    .filter((event) => event.findings.length > 0)
    .flatMap((event) => eventLines(event, forecast.today, replacements));
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Velella//Offing Forecast//EN",
    ...(events.length === 0 ? emptyCalendarComponent : events),
    "END:VCALENDAR",
    "",
  ]
    .map(foldLine)
    .join("\r\n");
}

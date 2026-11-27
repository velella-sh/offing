import { createHash } from "node:crypto";

import { locationText, singleLine } from "../forecast-core.js";
import { renderDeadlineCalendar, type CalendarDeadline } from "../forecast-ics.js";
import { escapeMarkdown } from "../reporters/shared.js";
import type { FleetForecast, ForecastCoverage, ForecastGroup, ForecastItem } from "./model.js";
import { changeKinds, horizons, repositoryKey, unowned } from "./model.js";

export type FleetForecastGrouping = "owner" | "repository";
export type CardTheme = "light" | "dark";

function coverageText(coverage: ForecastCoverage): string {
  const percentage = coverage.share === null ? "n/a" : `${(coverage.share * 100).toFixed(1)}%`;
  return `${coverage.noData} of ${coverage.classified + coverage.noData} references have no data (${percentage})`;
}

function describeItem(item: ForecastItem): string {
  return `${item.deadline}  ${singleLine(item.ruleId)}  ${singleLine(item.repository)}/${locationText(item.location)}`;
}

function groupText(group: ForecastGroup, host?: string): string[] {
  return [
    "",
    host ? `${singleLine(group.name)} (${singleLine(host)})` : singleLine(group.name),
    `  ${coverageText(group.coverage)}`,
    ...group.buckets.flatMap(({ months, items }, index) => [
      `  ${horizons[index - 1] ?? 0}–${months} months: ${items.length}`,
      ...items.map((item) => `    ${describeItem(item)}`),
    ]),
  ];
}

export function renderFleetForecastText(forecast: FleetForecast, by: FleetForecastGrouping): string {
  const groups =
    by === "owner"
      ? forecast.byOwner.flatMap((group) => groupText(group))
      : forecast.byRepository.flatMap((group) => groupText(group, group.host));
  const lines = [
    `Offing fleet forecast as of ${forecast.today} (by ${by})`,
    `${forecast.repositoryCount} repositories in scope, ${forecast.unavailable.length} without scan evidence`,
    coverageText(forecast.coverage),
    ...groups,
  ];
  if (forecast.changes) {
    for (const label of changeKinds) {
      const items = forecast.changes[label];
      lines.push("", `${label}: ${items.length}`, ...items.map((item) => `  ${describeItem(item)}`));
    }
  }
  return lines.join("\n");
}

export function renderFleetForecastCard(forecast: FleetForecast, theme: CardTheme): string {
  const palette =
    theme === "dark"
      ? { bg: "#111827", fg: "#F9FAFB", muted: "#CBD5E1", accent: "#93C5FD" }
      : { bg: "#F8FAFC", fg: "#172554", muted: "#334155", accent: "#1D4ED8" };
  const counts = new Map<number, Set<string>>(horizons.map((months) => [months, new Set()]));
  let nearest: string | undefined;
  for (const group of forecast.byRepository) {
    for (const { months, items } of group.buckets) {
      if (items.length > 0) counts.get(months)?.add(repositoryKey(group.host, group.name));
      for (const { deadline } of items) if (nearest === undefined || deadline < nearest) nearest = deadline;
    }
  }
  const teams = forecast.byOwner.filter(({ name }) => name !== unowned).length;
  const subtitle = `${teams} owners · ${forecast.repositoryCount} repositories · as of ${forecast.today}`;
  const nearestText = `Nearest deadline: ${nearest ?? "none in the forecast"}`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 232" role="img" aria-labelledby="title description">',
    '  <title id="title">Offing fleet forecast</title>',
    `  <desc id="description">${subtitle}. ${nearestText}.</desc>`,
    `  <rect width="640" height="232" rx="18" fill="${palette.bg}"/>`,
    `  <g font-family="system-ui,sans-serif" fill="${palette.fg}">`,
    '    <text x="32" y="49" font-size="28" font-weight="700">Offing fleet forecast</text>',
    `    <text x="32" y="77" font-size="14" fill="${palette.muted}">${subtitle}</text>`,
    ...horizons.flatMap((months, index) => {
      const x = 32 + index * 198;
      return [
        `    <text x="${x}" y="132" font-size="36" font-weight="700" fill="${palette.accent}">${counts.get(months)?.size ?? 0}</text>`,
        `    <text x="${x}" y="158" font-size="14" fill="${palette.muted}">repos · ${horizons[index - 1] ?? 0}–${months} months</text>`,
      ];
    }),
    `    <text x="32" y="198" font-size="16" font-weight="600">${nearestText}</text>`,
    "  </g>",
    "</svg>",
  ].join("\n");
}

function ownerId(owner: string): string {
  return createHash("sha256").update(owner).digest("hex");
}

function ownerFile(owner: string, suffix: "ics" | "md"): string {
  const slug =
    owner
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 40) || "owner";
  return `owner-${slug}-${ownerId(owner).slice(0, 16)}.${suffix}`;
}

function calendarDeadlines(group: ForecastGroup): CalendarDeadline[] {
  const byDate = new Map<string, ForecastItem[]>();
  for (const { items } of group.buckets) {
    for (const item of items) {
      const sameDay = byDate.get(item.deadline);
      if (sameDay) sameDay.push(item);
      else byDate.set(item.deadline, [item]);
    }
  }
  return [...byDate].map(([date, items]) => ({
    uid: `${date}-${ownerId(group.name)}@offing`,
    date,
    title: `Offing lifecycle deadline (${items.length} findings)`,
    description: [`Owner: ${group.name}`, ...items.map(describeItem)].join("\n"),
  }));
}

export function renderFleetCalendars(forecast: FleetForecast): Map<string, string> {
  return new Map(
    forecast.byOwner.map((group) => [
      ownerFile(group.name, "ics"),
      renderDeadlineCalendar(forecast.today, calendarDeadlines(group)),
    ]),
  );
}

function markdown(value: string): string {
  return escapeMarkdown(singleLine(value)).replaceAll("@", "&#64;");
}

function digestText(forecast: FleetForecast, owner: string): string {
  const group = forecast.byOwner.find(({ name }) => name === owner);
  const lines = [`# Offing fleet forecast — ${markdown(owner)}`, "", `As of ${forecast.today}.`];
  if (group) {
    lines.push("", coverageText(group.coverage));
    for (const { months, items } of group.buckets) {
      if (items.length === 0) continue;
      lines.push("", `## By the ${months}-month cutoff`, ...items.map((item) => `- ${markdown(describeItem(item))}`));
    }
  }
  if (forecast.changes) {
    for (const label of changeKinds) {
      const relevant = forecast.changes[label].filter((item) => item.owners.includes(owner));
      if (relevant.length === 0) continue;
      lines.push(
        "",
        `## ${label[0]?.toUpperCase() ?? ""}${label.slice(1)}`,
        ...relevant.map((item) => `- ${markdown(describeItem(item))}`),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderFleetDigests(forecast: FleetForecast): Map<string, string> {
  const owners = new Set(forecast.byOwner.map(({ name }) => name));
  for (const item of forecast.changes?.fixed ?? []) for (const owner of item.owners) owners.add(owner);
  return new Map([...owners].sort().map((owner) => [ownerFile(owner, "md"), digestText(forecast, owner)]));
}

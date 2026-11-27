import { escapeMermaidLabel } from "../mermaid.js";
import type { UpgradeBlocker, UpgradeGraph, UpgradeTarget } from "./types.js";

function headline(target: UpgradeTarget, graph: UpgradeGraph): string {
  const runtime = target.runtime + "@" + target.version;
  if (graph.total === 0) return "No confirmed blockers for " + runtime;
  const noun = graph.total === 1 ? " blocker for " : " blockers for ";
  return graph.total + noun + runtime;
}

function groups(graph: UpgradeGraph): { title: string; blockers: UpgradeBlocker[] }[] {
  const roots = graph.roots.map(({ dependency, unlocks, blockers }) => ({
    title: dependency + " (" + unlocks + (unlocks === 1 ? " blocker)" : " blockers)"),
    blockers,
  }));
  if (graph.ungrouped.length > 0) roots.push({ title: "No recorded dependency path", blockers: graph.ungrouped });
  return roots;
}

function blockerLabel(entry: UpgradeBlocker): string {
  return (entry.chain ?? [entry.subject]).join(" → ") + " · first supporting release: " + entry.firstSupported;
}

export function renderBlockerTree(target: UpgradeTarget, graph: UpgradeGraph): string[] {
  const output = ["  " + headline(target, graph)];
  for (const group of groups(graph)) {
    output.push("    " + group.title);
    for (const entry of group.blockers) output.push("      " + blockerLabel(entry));
  }
  return output;
}

export function renderBlockerMermaid(target: UpgradeTarget, graph: UpgradeGraph): string {
  const root = (id: string, label: string) => id + '["' + escapeMermaidLabel(label) + '"]';
  const lines = ["flowchart TD", "  " + root("target", headline(target, graph))];
  for (const [index, group] of groups(graph).entries()) {
    const branch = "root" + index;
    lines.push("  target --> " + root(branch, group.title));
    for (const [item, entry] of group.blockers.entries()) {
      lines.push("  " + branch + " --> " + root(branch + "blocker" + item, blockerLabel(entry)));
    }
  }
  return lines.join("\n");
}

function xml(value: string): string {
  return value
    .replace(/[\p{Cc}\ud800-\udfff\ufffe\uffff]/gu, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderBlockerSvg(target: UpgradeTarget, graph: UpgradeGraph, dark: boolean): string {
  const rows = renderBlockerTree(target, graph);
  const width = 1000;
  const height = 46 + rows.length * 28;
  const colors = dark
    ? { background: "#151d29", body: "#edf3fa", accent: "#a4c5ff" }
    : {
        background: "#f7faff",
        body: "#17243a",
        accent: "#284f91",
      };
  const text = rows.map((row, index) => {
    const label = row.trimStart();
    const indent = (row.length - label.length) * 14;
    const fill = index === 0 ? colors.accent : colors.body;
    const displayed = label.length > 94 ? label.slice(0, 91) + "…" : label;
    return (
      '<text x="' +
      indent +
      '" y="' +
      (44 + index * 28) +
      '" fill="' +
      fill +
      '"><title>' +
      xml(label) +
      "</title>" +
      xml(displayed) +
      "</text>"
    );
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title" viewBox="0 0 ' +
      width +
      " " +
      height +
      '">',
    '  <title id="title">' + xml(headline(target, graph)) + "</title>",
    '  <rect width="100%" height="100%" rx="14" fill="' + colors.background + '"/>',
    '  <g font-family="monospace" font-size="15">',
    ...text.map((row) => "    " + row),
    "  </g>",
    "</svg>",
  ].join("\n");
}

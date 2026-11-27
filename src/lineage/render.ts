import { escapeMermaidLabel } from "../mermaid.js";
import type { ImageChain, ImageLineage, LineageLink } from "./index.js";

function inline(value: string): string {
  return value.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, " ");
}

function location(link: { path: string; line: number; repository?: string }): string {
  return `${link.repository ? `${inline(link.repository)}/` : ""}${inline(link.path)}:${link.line}`;
}

function linkLabel(link: LineageLink): string {
  const reference = inline(link.reference);
  const resolved = link.resolvedReference ? ` → ${inline(link.resolvedReference)}` : "";
  return `${link.relationship.toUpperCase()} ${reference}${resolved} (${location(link)})`;
}

function details(link: LineageLink): string {
  const status = [link.status, link.deadline, link.reason].filter(Boolean).join(", ");
  const tags = link.matchingTags?.length ? `; matching tags: ${link.matchingTags.join(", ")}` : "";
  const producer = link.producer ? `; build: ${location(link.producer)}` : "";
  const os = link.baseOs === "no-data" ? "; base OS: no-data" : "";
  const incomplete = link.tagLookupIncomplete ? "; tag listing incomplete" : "";
  return `[${status}${os}${tags}${incomplete}${producer}]`;
}

/** The full evidence leading to one actionable link, including every route to a shared stage. */
export function chainEvidence(chain: ImageChain, target: number): string {
  const edges = new Set<string>();
  const visited = new Set<number>();
  function visit(index: number): void {
    if (visited.has(index)) return;
    visited.add(index);
    const link = chain.links[index];
    if (!link) return;
    if (link.parents.length === 0) edges.add(`${inline(chain.image)} → ${linkLabel(link)}`);
    if (link.producer) edges.add(`${inline(link.reference)} build declaration at ${location(link.producer)}`);
    for (const parent of link.parents) {
      visit(parent);
      const previous = chain.links[parent];
      if (previous) edges.add(`${linkLabel(previous)} → ${linkLabel(link)}`);
    }
  }
  visit(target);
  return `Image lineage: ${[...edges].join("; ")}.`;
}

function childrenOf(chain: ImageChain): Map<number, number[]> {
  const edges = new Map<number, number[]>();
  for (const [index, link] of chain.links.entries()) {
    for (const parent of link.parents) {
      const targets = edges.get(parent);
      if (targets) targets.push(index);
      else edges.set(parent, [index]);
    }
  }
  return edges;
}

function renderChain(chain: ImageChain): string[] {
  const lines = [`${inline(chain.image)} (${location(chain)})`];
  const children = childrenOf(chain);
  const visited = new Set<number>();
  function tree(index: number, indentation: string): void {
    const link = chain.links[index];
    if (!link) return;
    if (visited.has(index)) {
      lines.push(`${indentation}↳ ${linkLabel(link)} (shared stage)`);
      return;
    }
    visited.add(index);
    lines.push(`${indentation}└─ ${linkLabel(link)} ${details(link)}`);
    for (const child of children.get(index) ?? []) tree(child, `${indentation}   `);
  }
  tree(0, "  ");
  if (chain.truncated) lines.push("  … lineage incomplete (cycle or link limit)");
  return lines;
}

export function renderLineageText(result: ImageLineage): string {
  return result.chains.map((chain) => renderChain(chain).join("\n")).join("\n\n") || "No image declarations found.";
}

export function renderLineageMermaid(result: ImageLineage): string {
  const lines = ["flowchart TD"];
  for (const [chainIndex, chain] of result.chains.entries()) {
    const root = `chain${chainIndex}`;
    lines.push(`  ${root}["${escapeMermaidLabel(`${inline(chain.image)} (${location(chain)})`)}"]`);
    for (const [index, link] of chain.links.entries()) {
      const node = `${root}_${index}`;
      const label = escapeMermaidLabel(`${linkLabel(link)} ${details(link)}`);
      lines.push(`  ${node}["${label}"]`);
      for (const parent of link.parents.length > 0 ? link.parents : [-1]) {
        lines.push(`  ${parent === -1 ? root : `${root}_${parent}`} --> ${node}`);
      }
    }
    if (chain.truncated) lines.push(`  ${root} --> ${root}_partial["Lineage incomplete"]`);
  }
  return lines.join("\n");
}

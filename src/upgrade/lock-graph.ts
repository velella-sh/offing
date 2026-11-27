import type { DependencyGraph } from "../detectors/npm/lockfiles/shared.js";
import { shortestDependencyPath } from "../detectors/npm/dependency-graph.js";

export type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function object(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface LockedGraph {
  edges: DependencyGraph;
  roots: string[];
  labels: ReadonlyMap<string, string>;
}

export function lockedChain(graph: LockedGraph, id: string): string[] | undefined {
  const chain = shortestDependencyPath(graph.edges, graph.roots, id);
  return chain?.map((node) => graph.labels.get(node) ?? node);
}

export function sections(entry: RecordValue, names: readonly string[]): string[] {
  return [...new Set(names.flatMap((name) => Object.keys(object(entry[name]))))];
}

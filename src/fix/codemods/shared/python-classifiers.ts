import type { Finding } from "../../../domain.js";
import { parsedClassifierLists, pythonClassifierVersion } from "../../../detectors/python/classifiers.js";
import type { ClassifierEntry } from "../../../detectors/python/classifiers.js";
import type { Refuse } from "../../types.js";
import { applyEdits } from "./edits.js";
import type { Edit } from "./edits.js";

const SUMMARY = /^Trove classifier (\d+\.\d+) includes Python /;

export function isClassifierFinding(finding: Finding): boolean {
  return SUMMARY.test(finding.summary);
}

function removeClassifier(text: string, entry: ClassifierEntry): Edit[] {
  const startOfLine = text.lastIndexOf("\n", entry.start - 1) + 1;
  const end = text.indexOf("\n", entry.end);
  const suffix = text.slice(entry.end, end);
  if (!text.slice(startOfLine, entry.start).trim()) {
    if (/^\s*,?\s*$/.test(suffix)) return [{ start: startOfLine, end: end + 1, replacement: "" }];
    const comment = /^[ \t]*,?[ \t]+(?=#)/.exec(suffix);
    if (comment) return [{ start: entry.start, end: entry.end + comment[0].length, replacement: "" }];
  }
  const edits = [{ start: entry.start, end: entry.end, replacement: "" }];
  if (entry.comma !== undefined) edits.push({ start: entry.comma, end: entry.comma + 1, replacement: "" });
  return edits;
}

export function rewritePythonClassifiers(
  text: string,
  findings: readonly Finding[],
  refuse: Refuse | undefined,
): string {
  if (findings.length === 0) return text;
  const entries = parsedClassifierLists(text).flatMap((list) => list.entries);
  const selected = new Set<ClassifierEntry>();
  for (const finding of findings) {
    const version = SUMMARY.exec(finding.summary)?.[1];
    const candidates = entries.filter(
      (entry) => entry.line === finding.location.line && pythonClassifierVersion(entry.text) === version,
    );
    if (candidates.length === 0) refuse?.(finding, "The Trove classifier is not an unambiguous literal list entry.");
    for (const candidate of candidates) selected.add(candidate);
  }
  const updated = applyEdits(
    text,
    [...selected].flatMap((entry) => removeClassifier(text, entry)),
  );
  const retained = entries.filter((entry) => !selected.has(entry)).map(({ text }) => text);
  const actual = parsedClassifierLists(updated).flatMap((list) => list.entries.map(({ text }) => text));
  if (actual.length === retained.length && actual.every((value, index) => value === retained[index])) return updated;
  for (const finding of findings) {
    refuse?.(finding, "The edit would change other Trove classifiers.");
  }
  return text;
}

import { parse as parseToml } from "smol-toml";

import { readTomlLines, stringValue } from "../rust/toml-lines.js";
import type { Declaration, UnknownRecord } from "./types.js";
import { asRecord } from "./shared.js";

const CLASSIFIER = /^Programming Language :: Python :: (\d+\.\d+)$/;
const ITEM = /"(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*'/y;

export interface ClassifierEntry {
  text: string;
  start: number;
  end: number;
  comma?: number;
  line: number;
}

export interface ClassifierList {
  entries: ClassifierEntry[];
}

function skipTrivia(contents: string, start: number): number {
  let cursor = start;
  while (cursor < contents.length) {
    const next = contents.charAt(cursor);
    if (next === "#") {
      const newline = contents.indexOf("\n", cursor);
      cursor = newline < 0 ? contents.length : newline + 1;
    } else if (/\s/.test(next)) {
      cursor += 1;
    } else {
      break;
    }
  }
  return cursor;
}

function newlines(contents: string, start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end; index += 1) if (contents.charAt(index) === "\n") count += 1;
  return count;
}

function listAt(contents: string, offset: number, line: number): ClassifierList | undefined {
  const opening = /^[ \t]*classifiers[ \t]*=[ \t]*\[/.exec(contents.slice(offset));
  if (!opening) return undefined;
  const entries: ClassifierEntry[] = [];
  let cursor = offset + opening[0].length;
  let currentLine = line;
  while (cursor < contents.length) {
    const start = skipTrivia(contents, cursor);
    if (contents.charAt(start) === "]") return { entries };
    ITEM.lastIndex = start;
    const token = ITEM.exec(contents);
    const text = token ? stringValue(token[0]) : undefined;
    if (text === undefined) return undefined;
    const end = ITEM.lastIndex;
    const separator = skipTrivia(contents, end);
    const marker = contents.charAt(separator);
    if (marker !== "," && marker !== "]") return undefined;
    currentLine += newlines(contents, cursor, start);
    entries.push({ text, start, end, line: currentLine, ...(marker === "," ? { comma: separator } : {}) });
    if (marker === "]") return { entries };
    currentLine += newlines(contents, end, separator);
    cursor = separator + 1;
  }
  return undefined;
}

function classifierLists(contents: string, document: UnknownRecord): ClassifierList[] {
  const allowed = new Map([
    ["project", asRecord(document.project)?.classifiers],
    ["tool.poetry", asRecord(asRecord(document.tool)?.poetry)?.classifiers],
  ]);
  const positions: number[] = [0];
  for (const match of contents.matchAll(/\n/g)) positions.push(match.index + 1);
  const lists: ClassifierList[] = [];
  for (const { key, line, table, arrayTable } of readTomlLines(contents) ?? []) {
    const values = allowed.get(table);
    const offset = positions[line - 1];
    if (key !== "classifiers" || arrayTable || offset === undefined || !Array.isArray(values)) continue;
    const source = listAt(contents, offset, line);
    if (
      source &&
      values.length === source.entries.length &&
      values.every((value, index) => value === source.entries[index]?.text)
    )
      lists.push(source);
  }
  return lists;
}

export function pythonClassifierVersion(value: string): string | undefined {
  return CLASSIFIER.exec(value)?.[1];
}

export function classifierDeclarations(path: string, contents: string, document: UnknownRecord): Declaration[] {
  return classifierLists(contents, document).flatMap(({ entries }) =>
    entries.flatMap(({ text, line }) => {
      const value = pythonClassifierVersion(text);
      return value ? [{ path, line, value, kind: "Trove classifier", identity: value }] : [];
    }),
  );
}

export function parsedClassifierLists(contents: string): ClassifierList[] {
  try {
    return classifierLists(contents, parseToml(contents, { unsafeKeyBehaviour: "drop", maxDepth: 32 }));
  } catch {
    return [];
  }
}

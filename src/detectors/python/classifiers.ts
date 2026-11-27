import { parse as parseToml } from "smol-toml";

import { readTomlLines, stringValue } from "../rust/toml-lines.js";
import type { Declaration, UnknownRecord } from "./types.js";
import { asRecord } from "./shared.js";

const CLASSIFIER = /^Programming Language :: Python :: (\d+\.\d+)$/;
const ITEM = /\s*(?:#[^\r\n]*\s*)*(?:"(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*')\s*(?:#[^\r\n]*\s*)?(,|(?=\]))/y;
const VALUE = /"(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*'/;

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

function listAt(contents: string, offset: number, line: number): ClassifierList | undefined {
  const opening = /^[^\S\r\n]*classifiers\s*=\s*\[/.exec(contents.slice(offset));
  if (!opening) return undefined;
  const entries: ClassifierEntry[] = [];
  let cursor = offset + opening[0].length;
  let currentLine = line + (opening[0].match(/\n/g)?.length ?? 0);
  ITEM.lastIndex = cursor;
  for (let match = ITEM.exec(contents); match; match = ITEM.exec(contents)) {
    const relevant = match[0].replace(/^[\s]*(?:#[^\r\n]*\s*)*/, "");
    const value = VALUE.exec(relevant);
    if (!value) return undefined;
    const text = stringValue(value[0]);
    if (text === undefined) return undefined;
    const start = cursor + match[0].length - relevant.length;
    const end = start + value[0].length;
    const preceding = contents.slice(cursor, start);
    entries.push({
      text,
      start,
      end,
      ...(match[1] === "," ? { comma: ITEM.lastIndex - 1 } : {}),
      line: currentLine + (preceding.match(/\n/g)?.length ?? 0),
    });
    currentLine += match[0].match(/\n/g)?.length ?? 0;
    cursor = ITEM.lastIndex;
    if (match[1] !== ",") break;
  }
  return /^(?:\s|#[^\r\n]*)*\]/.test(contents.slice(cursor)) ? { entries } : undefined;
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

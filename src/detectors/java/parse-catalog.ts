import { stripComment } from "../rust/toml-lines.js";
import type { DependencyDeclaration } from "./jdk-version.js";
import { required } from "../../required.js";

/**
 * Pure, bounded parser for `gradle/libs.versions.toml` (Gradle version catalogs).
 *
 * Reads `[versions]`, `[libraries]`, and `[plugins]`, including single-line inline tables,
 * multi-line inline tables, and `[section.alias]` sub-tables, with 1-based line numbers.
 * The file is never evaluated; only literal string values are extracted.
 */

export const MAXIMUM_INPUT_BYTES = 1024 * 1024;
export const MAXIMUM_LINE_LENGTH = 4096;
export const MAXIMUM_DECLARATIONS = 5000;

export interface CatalogPluginDeclaration {
  kind: "catalog-plugin";
  alias: string;
  id: string;
  version: string;
  line: number;
}

export type CatalogDeclaration = DependencyDeclaration | CatalogPluginDeclaration;

export interface CatalogIndex {
  versions: ReadonlyMap<string, string>;
  libraries: ReadonlyMap<string, DependencyDeclaration>;
  plugins: ReadonlyMap<string, CatalogPluginDeclaration>;
}

interface RawEntry {
  section: "versions" | "libraries" | "plugins";
  alias: string;
  line: number;
  fields: Map<string, string>;
  scalar?: string;
}

/** Normalize a Gradle catalog alias so `my-lib_v1` and `my.lib.v1` resolve identically. */
export function normalizeCatalogAlias(alias: string): string {
  return alias.trim().toLowerCase().replace(/[-_]/g, ".");
}

function unquoteToml(raw: string): string | undefined {
  const text = raw.trim();
  if (text.length < 2) return undefined;
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  return undefined;
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote: string | undefined;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const ch = text.charAt(index);
    if (quote) {
      if (ch === "\\" && quote === '"') index++;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function parseInlineFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const part of splitTopLevel(body, ",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part
      .slice(0, eq)
      .trim()
      .replace(/^["']|["']$/g, "");
    const value = unquoteToml(part.slice(eq + 1));
    if (key && value !== undefined) fields.set(key, value);
  }
  return fields;
}

function braceDelta(text: string): number {
  let delta = 0;
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const ch = text.charAt(index);
    if (quote) {
      if (ch === "\\" && quote === '"') index++;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") delta++;
    else if (ch === "}") delta--;
  }
  return delta;
}

function sectionOf(header: string): { section: RawEntry["section"]; subAlias?: string } | undefined {
  const trimmed = header.trim();
  const dot = trimmed.indexOf(".");
  const root = (dot < 0 ? trimmed : trimmed.slice(0, dot)).trim().toLowerCase();
  if (root !== "versions" && root !== "libraries" && root !== "plugins") return undefined;
  const subAlias =
    dot < 0
      ? undefined
      : trimmed
          .slice(dot + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
  return subAlias ? { section: root, subAlias } : { section: root };
}

function addEntryFromAssignment(
  entries: RawEntry[],
  section: RawEntry["section"],
  alias: string,
  rhs: string,
  line: number,
): void {
  if (rhs.startsWith("{") && rhs.endsWith("}")) {
    entries.push({ section, alias, line, fields: parseInlineFields(rhs.slice(1, -1)) });
    return;
  }
  const scalar = unquoteToml(rhs);
  if (scalar !== undefined) entries.push({ section, alias, line, fields: new Map(), scalar });
}

interface ScanState {
  section?: RawEntry["section"] | undefined;
  subEntry?: RawEntry | undefined;
  pending?: { section: RawEntry["section"]; alias: string; line: number; buffer: string; depth: number } | undefined;
}

function finishPending(state: ScanState, entries: RawEntry[]): void {
  if (!state.pending) return;
  const body = state.pending.buffer.trim();
  if (body.startsWith("{") && body.endsWith("}")) {
    entries.push({
      section: state.pending.section,
      alias: state.pending.alias,
      line: state.pending.line,
      fields: parseInlineFields(body.slice(1, -1)),
    });
  }
  state.pending = undefined;
}

function processHeaderLine(state: ScanState, entries: RawEntry[], header: string, lineNumber: number): void {
  state.subEntry = undefined;
  const parsed = sectionOf(header);
  if (!parsed) {
    state.section = undefined;
    return;
  }
  state.section = parsed.section;
  if (parsed.subAlias) {
    state.subEntry = { section: parsed.section, alias: parsed.subAlias, line: lineNumber, fields: new Map() };
    entries.push(state.subEntry);
  }
}

function processKeyValueLine(state: ScanState, entries: RawEntry[], text: string, lineNumber: number): void {
  if (!state.section) return;
  const eq = text.indexOf("=");
  if (eq < 0) return;
  const key = text
    .slice(0, eq)
    .trim()
    .replace(/^["']|["']$/g, "");
  const rhs = text.slice(eq + 1).trim();
  if (!key || !rhs) return;

  if (state.subEntry) {
    const val = unquoteToml(rhs);
    if (val !== undefined) state.subEntry.fields.set(key, val);
    return;
  }
  if (rhs.startsWith("{")) {
    const depth = braceDelta(rhs);
    if (depth > 0) {
      state.pending = { section: state.section, alias: key, line: lineNumber, buffer: rhs, depth };
      return;
    }
  }
  addEntryFromAssignment(entries, state.section, key, rhs, lineNumber);
}

function collectRawEntries(rawLines: readonly string[]): RawEntry[] {
  const entries: RawEntry[] = [];
  const state: ScanState = {};
  for (let index = 0; index < rawLines.length; index++) {
    const rawLine = required(rawLines[index], "catalog line");
    if (rawLine.length > MAXIMUM_LINE_LENGTH) continue;
    const text = stripComment(rawLine).trim();
    if (!text) continue;

    if (state.pending) {
      state.pending.buffer += ` ${text}`;
      state.pending.depth += braceDelta(text);
      if (state.pending.depth <= 0) finishPending(state, entries);
      continue;
    }
    const headerMatch = /^\[\[?([^\]]+)\]\]?$/.exec(text);
    if (headerMatch) {
      processHeaderLine(state, entries, required(headerMatch[1], "section"), index + 1);
      continue;
    }
    processKeyValueLine(state, entries, text, index + 1);
  }
  return entries;
}

function resolveVersionField(
  fields: ReadonlyMap<string, string>,
  versions: ReadonlyMap<string, string>,
): string | undefined {
  const direct = fields.get("version") ?? fields.get("version.require") ?? fields.get("version.prefer");
  if (direct !== undefined) return direct;
  const ref = fields.get("version.ref");
  return ref === undefined ? undefined : versions.get(normalizeCatalogAlias(ref));
}

function buildVersionsMap(entries: readonly RawEntry[]): Map<string, string> {
  const versions = new Map<string, string>();
  for (const entry of entries) {
    if (entry.section !== "versions") continue;
    const value =
      entry.scalar ?? entry.fields.get("require") ?? entry.fields.get("prefer") ?? entry.fields.get("strictly");
    if (value) versions.set(normalizeCatalogAlias(entry.alias), value);
  }
  return versions;
}

function toLibrary(entry: RawEntry, versions: ReadonlyMap<string, string>): DependencyDeclaration | undefined {
  if (entry.scalar !== undefined) {
    const parts = entry.scalar.split(":");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return undefined;
    return { kind: "dependency", group: parts[0], artifact: parts[1], version: parts[2], line: entry.line };
  }
  let group = entry.fields.get("group");
  let artifact = entry.fields.get("name");
  const mod = entry.fields.get("module");
  if ((!group || !artifact) && mod) {
    const [modGroup, modName] = mod.split(":");
    if (modGroup && modName) {
      group = modGroup;
      artifact = modName;
    }
  }
  const version = resolveVersionField(entry.fields, versions);
  if (!group || !artifact || !version) return undefined;
  return { kind: "dependency", group, artifact, version, line: entry.line };
}

function toPlugin(entry: RawEntry, versions: ReadonlyMap<string, string>): CatalogPluginDeclaration | undefined {
  if (entry.scalar !== undefined) {
    const colon = entry.scalar.indexOf(":");
    if (colon <= 0) return undefined;
    const id = entry.scalar.slice(0, colon);
    const version = entry.scalar.slice(colon + 1);
    return id && version ? { kind: "catalog-plugin", alias: entry.alias, id, version, line: entry.line } : undefined;
  }
  const id = entry.fields.get("id");
  const version = resolveVersionField(entry.fields, versions);
  if (!id || !version) return undefined;
  return { kind: "catalog-plugin", alias: entry.alias, id, version, line: entry.line };
}

/** Parse a Gradle version catalog into a lookup index for `libs.*` resolution. */
export function parseCatalogIndex(contents: string): CatalogIndex {
  const empty: CatalogIndex = { versions: new Map(), libraries: new Map(), plugins: new Map() };
  if (Buffer.byteLength(contents, "utf8") > MAXIMUM_INPUT_BYTES || contents.includes("\0")) return empty;

  try {
    const entries = collectRawEntries(contents.split(/\r?\n/));
    const versions = buildVersionsMap(entries);
    const libraries = new Map<string, DependencyDeclaration>();
    const plugins = new Map<string, CatalogPluginDeclaration>();
    let total = 0;
    for (const entry of entries) {
      if (total >= MAXIMUM_DECLARATIONS) break;
      if (entry.section === "libraries") {
        const lib = toLibrary(entry, versions);
        if (lib) {
          libraries.set(normalizeCatalogAlias(entry.alias), lib);
          total++;
        }
      } else if (entry.section === "plugins") {
        const plugin = toPlugin(entry, versions);
        if (plugin) {
          plugins.set(normalizeCatalogAlias(entry.alias), plugin);
          total++;
        }
      }
    }
    return { versions, libraries, plugins };
  } catch {
    return empty;
  }
}

/** Parse a Gradle version catalog without file, network, or process I/O. */
export function parseCatalog(contents: string): CatalogDeclaration[] {
  const index = parseCatalogIndex(contents);
  const found: CatalogDeclaration[] = [...index.libraries.values(), ...index.plugins.values()];
  return found.sort((left, right) => left.line - right.line);
}

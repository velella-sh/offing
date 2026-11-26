/**
 * Pure, bounded parser for Android-related pins in Gradle `libs.versions.toml`.
 *
 * Reads literal pins from `[versions]` (`agp`, `kotlin`) and `[plugins]`
 * (`com.android.application`, `com.android.library`, `org.jetbrains.kotlin.android`),
 * including multi-line tables and `[plugins.alias]` sub-tables.
 *
 * Unsupported / skipped (returns nothing for that site, not an error):
 * - dynamic / ranged / named versions (`8.+`, `latest.release`, `[8.0,9.0)`);
 * - lookalike text inside comments or other string values;
 * - multi-line strings (`"""` / `'''`) or unterminated strings yield `[]`.
 */

import { MAXIMUM_DECLARATIONS, MAXIMUM_INPUT_BYTES, MAXIMUM_LINE_LENGTH, isLiteralVersion } from "./gradle-scan.js";
import { parseCatalogIndex } from "../java/parse-catalog.js";
import { required } from "../../required.js";

export { MAXIMUM_DECLARATIONS, MAXIMUM_INPUT_BYTES, MAXIMUM_LINE_LENGTH };

export type AndroidVersionCatalogKind = "agp" | "kotlin";

export interface AndroidVersionCatalogDeclaration {
  kind: AndroidVersionCatalogKind;
  value: string;
  line: number;
}

const ANDROID_PLUGIN_KINDS = new Map<string, AndroidVersionCatalogKind>([
  ["com.android.application", "agp"],
  ["com.android.library", "agp"],
  ["org.jetbrains.kotlin.android", "kotlin"],
]);

/**
 * Walk the file once: reject multi-line strings and unterminated one-line strings.
 * One-line `'…'` / `"…"` are allowed (including inside `[libraries]`).
 */
function stringsReadable(source: string): boolean {
  let index = 0;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 0x23) {
      const end = source.indexOf("\n", index);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('"""', index) || source.startsWith("'''", index)) return false;
    if (code === 0x22 || code === 0x27) {
      const quote = code;
      let position = index + 1;
      while (position < source.length) {
        const inner = source.charCodeAt(position);
        if (inner === 0x0a) return false;
        if (quote === 0x22 && inner === 0x5c) {
          position += 2;
          continue;
        }
        if (inner === quote) {
          index = position + 1;
          break;
        }
        position++;
      }
      if (position >= source.length || source.charCodeAt(position) === 0x0a) return false;
      continue;
    }
    index++;
  }
  return true;
}

/** Strip a `#` comment that is not inside a one-line string on this line. */
function stripComment(line: string): string | undefined {
  let index = 0;
  while (index < line.length) {
    const code = line.charCodeAt(index);
    if (code === 0x23) return line.slice(0, index);
    if (code === 0x22 || code === 0x27) {
      const quote = code;
      let position = index + 1;
      while (position < line.length) {
        const inner = line.charCodeAt(position);
        if (quote === 0x22 && inner === 0x5c) {
          position += 2;
          continue;
        }
        if (inner === quote) {
          index = position + 1;
          break;
        }
        position++;
      }
      if (position >= line.length) return undefined;
      continue;
    }
    index++;
  }
  return line;
}

const SECTION = /^\s*\[\[?([^\]]+)\]\]?\s*$/;
const ASSIGNMENT = /^\s*(agp|kotlin)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/;

function readVersionAssignment(line: string, lineNumber: number): AndroidVersionCatalogDeclaration | undefined {
  const match = ASSIGNMENT.exec(line);
  if (!match) return undefined;
  const value = required(match[2] ?? match[3], "version value");
  if (!value || value.includes("$") || !isLiteralVersion(value)) return undefined;
  return { kind: match[1] as AndroidVersionCatalogKind, value, line: lineNumber };
}

function collectVersionPins(contents: string): AndroidVersionCatalogDeclaration[] | undefined {
  const found: AndroidVersionCatalogDeclaration[] = [];
  let section = "";

  for (const [lineIndex, raw] of contents.split("\n").entries()) {
    if (raw.length > MAXIMUM_LINE_LENGTH) continue;
    const stripped = stripComment(raw.replace(/\r$/, ""));
    if (stripped === undefined) return undefined;
    const line = stripped.trim();
    if (!line) continue;

    const header = SECTION.exec(line);
    if (header) {
      section = required(header[1], "section name").trim();
      continue;
    }
    if (section !== "versions") continue;

    const declaration = readVersionAssignment(line, lineIndex + 1);
    if (!declaration) continue;
    if (found.length >= MAXIMUM_DECLARATIONS) break;
    found.push(declaration);
  }
  return found;
}

/** Parse `libs.versions.toml` without file, network, or process I/O. */
export function parseAndroidLibsVersionsToml(contents: string): AndroidVersionCatalogDeclaration[] {
  if (Buffer.byteLength(contents, "utf8") > MAXIMUM_INPUT_BYTES || contents.includes("\0")) return [];
  if (!stringsReadable(contents)) return [];

  const found = collectVersionPins(contents);
  if (found === undefined) return [];

  const catalog = parseCatalogIndex(contents);
  for (const plugin of catalog.plugins.values()) {
    if (found.length >= MAXIMUM_DECLARATIONS) break;
    const kind = ANDROID_PLUGIN_KINDS.get(plugin.id);
    if (!kind || plugin.version.includes("$") || !isLiteralVersion(plugin.version)) continue;
    found.push({ kind, value: plugin.version, line: plugin.line });
  }

  return found.sort((left, right) => left.line - right.line || left.kind.localeCompare(right.kind));
}

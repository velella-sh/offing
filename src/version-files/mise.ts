import { parse } from "smol-toml";

import { readTomlLines } from "../detectors/rust/toml-lines.js";
import type { DetectorUnclassifiedReference } from "../sdk.js";

export const MISE_FILES = ["mise.toml", ".mise.toml"] as const;
export const MISE_FILE_NAMES: ReadonlySet<string> = new Set(MISE_FILES);

/** Backend qualifiers are significant. A custom backend need not install the same product. */
const TOOL_PURLS = new Map([
  ["java", "pkg:generic/java"],
  ["node", "pkg:generic/nodejs"],
  ["nodejs", "pkg:generic/nodejs"],
  ["python", "pkg:generic/python"],
  ["ruby", "pkg:generic/ruby"],
  ["php", "pkg:generic/php"],
  ["elixir", "pkg:generic/elixir"],
  ["erlang", "pkg:generic/erlang"],
  ["deno", "pkg:generic/deno"],
  ["bun", "pkg:generic/bun"],
  ["terraform", "pkg:generic/terraform"],
]);

interface MisePin {
  tool: string;
  purl: string;
  value: string;
  line: number;
}

function versionOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && Object.hasOwn(value, "version")) {
    const version: unknown = Reflect.get(value, "version");
    if (typeof version === "string") return version;
  }
  return undefined;
}

function pinsForTool(raw: unknown, tool: string, line: number): MisePin[] {
  const purl = TOOL_PURLS.get(tool);
  if (purl === undefined) return [];
  return (Array.isArray(raw) ? raw : [raw]).flatMap((item) => {
    const value = versionOf(item);
    return value ? [{ tool, purl, value, line }] : [];
  });
}

/** Read literal versions and keep the source line of each tool assignment. */
export function parseMisePins(contents: string): MisePin[] {
  const lines = readTomlLines(contents);
  if (lines === undefined) return [];

  try {
    const { tools } = parse(contents, { unsafeKeyBehaviour: "drop", maxDepth: 32 });
    if (typeof tools !== "object" || tools === null || Array.isArray(tools)) return [];
    const pins: MisePin[] = [];
    for (const { key, table, line } of lines) {
      if (key === undefined || !/^(?:tools|"tools"|'tools')$/.test(table)) continue;
      const tool = /^["']/.test(key) ? Object.keys(parse(`${key} = 0`))[0] : key;
      if (tool === undefined || !Object.hasOwn(tools, tool)) continue;
      pins.push(...pinsForTool(Reflect.get(tools, tool), tool, line));
    }
    return pins;
  } catch {
    return [];
  }
}

export function noVersionData(
  path: string,
  line: number,
  component: string,
  reference: string,
): DetectorUnclassifiedReference {
  return {
    component,
    reference,
    reason: "no-data: this version declaration cannot be resolved offline",
    location: { path, line },
  };
}

/** Match only the tools a detector owns and report versions its existing matcher cannot use. */
export function miseDeclarations<T>(
  path: string,
  contents: string,
  parsers: ReadonlyMap<string, (pin: MisePin) => T[]>,
  unclassified: DetectorUnclassifiedReference[],
): T[] {
  return parseMisePins(contents).flatMap((pin) => {
    const parser = parsers.get(pin.purl);
    if (!parser) return [];
    const declarations = parser(pin);
    if (declarations.length === 0) unclassified.push(noVersionData(path, pin.line, pin.purl, pin.value));
    return declarations;
  });
}

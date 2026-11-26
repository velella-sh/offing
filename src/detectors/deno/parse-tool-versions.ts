import { parseToolVersionEntries } from "../../version-files/tool-versions.js";
import { exactVersionPin, MAXIMUM_INPUT_BYTES, MAXIMUM_LINE_LENGTH } from "./parse.js";
import type { DenoDeclaration } from "./parse.js";

/**
 * Pure, bounded parser for the Deno and Bun runtimes a project pins in `.tool-versions`.
 *
 * asdf lines name one tool and one or more versions: `deno 1.46.2` or `bun 1.0.29 0.8.1`. Comments and
 * unrelated tools are ignored. Floating values (`system`, `latest`), ranges, and malformed input return
 * nothing for that line rather than a partial result. The parser never evaluates contents and never runs
 * Deno, Bun, or asdf.
 */
export function parseToolVersions(contents: string): DenoDeclaration[] {
  const declarations: DenoDeclaration[] = [];
  for (const { tool, versions, line } of parseToolVersionEntries(contents, {
    maxBytes: MAXIMUM_INPUT_BYTES,
    maxLine: MAXIMUM_LINE_LENGTH,
  })) {
    const kind = tool === "deno" ? "deno-runtime" : tool === "bun" ? "bun-runtime" : undefined;
    if (!kind) continue;
    const pinned: string[] = [];
    for (const version of versions) {
      const exact = exactVersionPin(version);
      // One unsupported token makes the line ambiguous, so it yields nothing rather than a partial result.
      if (exact === undefined) {
        pinned.length = 0;
        break;
      }
      pinned.push(exact);
    }
    for (const version of pinned) declarations.push({ kind, value: version, line });
  }
  return declarations;
}

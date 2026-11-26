interface ToolVersionEntry {
  tool: string;
  versions: string[];
  /** Original text after the tool name, including any trailing comment. */
  tail: string;
  line: number;
}

interface ToolVersionsOptions {
  maxBytes?: number;
  maxLine?: number;
  legacyNewlines?: boolean;
  trimBeforeLimit?: boolean;
  spacedComments?: boolean;
}

/** Tokenize asdf entries. Callers keep their own rules for selecting and validating fallback versions. */
export function parseToolVersionEntries(contents: string, options: ToolVersionsOptions = {}): ToolVersionEntry[] {
  if (Buffer.byteLength(contents, "utf8") > (options.maxBytes ?? Infinity)) return [];
  const newline = options.legacyNewlines ? /\r\n|\n|\r/ : /\r?\n/;
  const comments = options.spacedComments ? /\s+#.*$/ : /#.*$/;
  const entries: ToolVersionEntry[] = [];
  for (const [index, raw] of contents.split(newline).entries()) {
    const text = raw.trim();
    if ((options.trimBeforeLimit ? text : raw).length > (options.maxLine ?? Infinity)) continue;
    if (text.startsWith("#")) continue;
    const [tool, ...versions] = text.replace(comments, "").trim().split(/\s+/);
    if (!tool) continue;
    const tail = /^\S+\s+(.+)$/.exec(text)?.[1] ?? "";
    entries.push({ tool, versions, tail, line: index + 1 });
  }
  return entries;
}

import { isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";

interface CondaEntry {
  raw: string;
  line: number;
}

interface CondaPython extends CondaEntry {
  version: string;
  operator: string;
}

/** Read direct Conda Python specs and pip requirements, with their YAML scalar lines. */
export function parseCondaEnvironment(contents: string): { python: CondaPython[]; pip: CondaEntry[] } {
  const python: CondaPython[] = [];
  const pip: CondaEntry[] = [];
  if (Buffer.byteLength(contents) > 1024 * 1024) return { python, pip };
  const lineCounter = new LineCounter();
  const document = parseDocument(contents, { lineCounter, prettyErrors: false });
  if (document.errors.length > 0 || !isMap(document.contents)) return { python, pip };
  const dependencies = document.contents.get("dependencies", true);
  if (!isSeq(dependencies)) return { python, pip };

  const entry = (node: unknown): CondaEntry | undefined =>
    isScalar(node) && typeof node.value === "string" && node.range
      ? { raw: node.value.trim(), line: lineCounter.linePos(node.range[0]).line }
      : undefined;

  for (const item of dependencies.items) {
    const pipItems = isMap(item) ? item.get("pip", true) : undefined;
    if (isSeq(pipItems)) {
      for (const requirement of pipItems.items) {
        const value = entry(requirement);
        if (value) pip.push(value);
      }
    }
    const value = entry(item);
    if (!value) continue;
    const match = /^(?:[\w-]+::)?python(?=\s|[<>=!~])\s*(>=|<=|>|<|==|=|~=|!=)?\s*(\S+)(?:\s+[\w.*-]+)?$/i.exec(
      value.raw.replace(/\s*,\s*/g, ","),
    );
    if (!match?.[2]) continue;
    const operator = match[1] ?? "";
    const version = operator === "=" ? match[2].replace(/=[^=,]+$/, "") : match[2];
    python.push({ ...value, version, operator });
  }
  return { python, pip };
}

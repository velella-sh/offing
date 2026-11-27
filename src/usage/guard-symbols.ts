import { lineLocator, loadQuery, parseSource } from "./tree-sitter.js";
import type { Node } from "./vendor/tree-sitter/tree-sitter.js";

export type GuardLanguage = "go" | "java" | "csharp";

interface Position {
  line: number;
  column: number;
}

export interface GuardImport {
  module: string;
  kind: "alias" | "namespace" | "type" | "static" | "static-wildcard" | "dot" | "blank";
  alias?: string;
  global?: boolean;
}

interface GuardInvocation {
  kind: "call" | "construct";
  name: string;
  /** Syntactic candidates only. This frontend does not perform type or scope resolution. */
  candidates: string[];
}

export interface GuardSymbols {
  imports: Array<GuardImport & Position>;
  invocations: Array<GuardInvocation & Position>;
}

interface SourceNames {
  aliases: Map<string, string | null>;
  namespace: string | undefined;
  staticModule: string | undefined;
}

const identifiers = new Set(["identifier", "field_identifier", "package_identifier", "type_identifier"]);
const dotted = new Set([
  "selector_expression",
  "scoped_identifier",
  "scoped_type_identifier",
  "field_access",
  "qualified_name",
  "member_access_expression",
]);

/** Reads an AST name without including comments, receivers that need type resolution, or type arguments. */
export function dottedName(node: Node | null, depth = 0): string | undefined {
  if (!node || depth > 64) return undefined;
  if (identifiers.has(node.type)) return node.text.replace(/^@/, "");
  if (node.type === "generic_type" || node.type === "generic_name") return dottedName(node.namedChild(0), depth + 1);
  if (node.type === "alias_qualified_name") {
    const part = dottedName(node.childForFieldName("name"), depth + 1);
    return part && node.childForFieldName("alias")?.text === "global" ? `global::${part}` : undefined;
  }
  if (!dotted.has(node.type)) return undefined;
  const parts = node.namedChildren.filter((child) => child?.type !== "comment");
  const [left, right] = parts;
  const head = dottedName(left ?? null, depth + 1);
  const tail = dottedName(right ?? null, depth + 1);
  return head && tail ? `${head}.${tail}` : undefined;
}

function singleModule(imports: readonly GuardImport[], ...kinds: GuardImport["kind"][]): string | undefined {
  const modules = new Set(imports.filter(({ kind }) => kinds.includes(kind)).map(({ module }) => module));
  return modules.size === 1 ? modules.values().next().value : undefined;
}

function sourceNames(imports: readonly GuardImport[]): SourceNames {
  const aliases = new Map<string, string | null>();
  for (const { alias, module } of imports) {
    if (!alias) continue;
    const previous = aliases.get(alias);
    aliases.set(alias, previous === undefined || previous === module ? module : null);
  }
  return {
    aliases,
    namespace: singleModule(imports, "namespace"),
    staticModule: singleModule(imports, "static-wildcard", "dot"),
  };
}

function candidates(
  language: GuardLanguage,
  names: SourceNames,
  name: string,
  kind: GuardInvocation["kind"],
): string[] {
  if (name.startsWith("global::")) return [name.slice("global::".length)];
  const parts = name.split(".");
  const first = parts[0] ?? name;
  const alias = names.aliases.get(first);
  if (alias === null) return [];
  if (alias) return [alias + name.slice(first.length)];
  if (parts.length === 1 && kind === "call" && names.staticModule) return [`${names.staticModule}.${name}`];
  if (language === "go") return [];
  if (names.namespace && parts.length === (kind === "construct" ? 1 : 2)) return [`${names.namespace}.${name}`];
  return parts.length > 1 ? [name] : [];
}

type CallName = (node: Node) => string | undefined;
type ReadImports = (node: Node) => GuardImport | undefined;

/** Parses one snippet and returns recognized declarations and invocations at their original locations. */
export async function analyzeGuardLanguage(
  language: GuardLanguage,
  source: string,
  readImport: ReadImports,
  readCall: CallName,
): Promise<GuardSymbols | undefined> {
  const tree = await parseSource(language, source);
  if (!tree) return undefined;
  try {
    const query = await loadQuery(language, language);
    const captures = query.captures(tree.rootNode);
    const locate = lineLocator(source);
    const imports = captures.flatMap(({ name, node }) => {
      const entry = name === "import" && !node.hasError ? readImport(node) : undefined;
      return entry ? [{ ...entry, ...locate(node.startIndex) }] : [];
    });
    const names = sourceNames(imports);
    const invocations: GuardSymbols["invocations"] = [];
    for (const { name, node } of captures) {
      if ((name !== "call" && name !== "construct") || node.hasError) continue;
      const written = readCall(node);
      if (written) {
        invocations.push({
          kind: name,
          name: written,
          candidates: candidates(language, names, written, name),
          ...locate(node.startIndex),
        });
      }
    }
    return { imports, invocations };
  } finally {
    tree.delete();
  }
}

import { analyzeGuardLanguage, dottedName, type GuardImport, type GuardSymbols } from "./guard-symbols.js";
import { goPackageName } from "./imports.js";
import type { Node } from "./vendor/tree-sitter/tree-sitter.js";

function goImport(node: Node): GuardImport | undefined {
  const literal = node.childForFieldName("path")?.text;
  if (!literal) return undefined;
  const module = literal.slice(1, -1);
  const alias = node.childForFieldName("name")?.text ?? goPackageName(module);
  if (alias === ".") return { module, kind: "dot" };
  if (alias === "_") return { module, kind: "blank" };
  return { module, kind: "alias", alias };
}

/** Reads Go import declarations and qualified or unqualified call names from one snippet. */
export function analyzeGoGuard(source: string): Promise<GuardSymbols | undefined> {
  return analyzeGuardLanguage("go", source, goImport, (node) => dottedName(node.childForFieldName("function")));
}

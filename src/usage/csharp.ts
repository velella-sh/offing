import { analyzeGuardLanguage, dottedName, type GuardImport, type GuardSymbols } from "./guard-symbols.js";
import type { Node } from "./vendor/tree-sitter/tree-sitter.js";

function csharpImport(node: Node): GuardImport | undefined {
  const module = dottedName(node.namedChild(node.namedChildCount - 1));
  if (!module) return undefined;
  const global = node.children.some((child) => child?.type === "global");
  const isStatic = node.children.some((child) => child?.type === "static");
  const alias = dottedName(node.childForFieldName("name"));
  return {
    module: module.replace(/^global::/, ""),
    kind: alias ? "alias" : isStatic ? "static-wildcard" : "namespace",
    ...(alias ? { alias } : {}),
    ...(global ? { global } : {}),
  };
}

function csharpCall(node: Node): string | undefined {
  const field = node.type === "object_creation_expression" ? "type" : "function";
  return dottedName(node.childForFieldName(field));
}

/** Reads C# using directives, member calls and constructions from one snippet. */
export function analyzeCsharpGuard(source: string): Promise<GuardSymbols | undefined> {
  return analyzeGuardLanguage("csharp", source, csharpImport, csharpCall);
}

import { analyzeGuardLanguage, dottedName, type GuardImport, type GuardSymbols } from "./guard-symbols.js";
import type { Node } from "./vendor/tree-sitter/tree-sitter.js";

function javaImport(node: Node): GuardImport | undefined {
  const module = dottedName(node.namedChild(0));
  if (!module) return undefined;
  const isStatic = node.children.some((child) => child?.type === "static");
  if (node.namedChildren.some((child) => child?.type === "asterisk")) {
    return { module, kind: isStatic ? "static-wildcard" : "namespace" };
  }
  return { module, kind: isStatic ? "static" : "type", alias: module.slice(module.lastIndexOf(".") + 1) };
}

function javaCall(node: Node): string | undefined {
  if (node.type === "object_creation_expression") return dottedName(node.childForFieldName("type"));
  const receiver = node.childForFieldName("object");
  const name = dottedName(node.childForFieldName("name"));
  if (!receiver) return name;
  const qualified = dottedName(receiver);
  return qualified && name ? `${qualified}.${name}` : undefined;
}

/** Reads Java imports, method calls and constructor calls from one snippet. */
export function analyzeJavaGuard(source: string): Promise<GuardSymbols | undefined> {
  return analyzeGuardLanguage("java", source, javaImport, javaCall);
}

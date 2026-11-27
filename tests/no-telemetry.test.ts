import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import ts from "typescript";

// These are the shipped network entry points for user-directed data, fleet, and Action operations.
// GitHub Action writes answer an explicit repository workflow; the CLI data update downloads the rule bundle.
const approved = new Map([
  ["action-commands.ts", ["fetch"]],
  ["action-fix-pr.ts", ["fetch"]],
  ["action-tracking-issue.ts", ["fetch"]],
  ["commands/data.ts", ["@velella/ebb/data-update", "node:http"]],
  ["fleet/http.ts", ["fetch"]],
  ["pr-comment.ts", ["fetch"]],
]);
const networkGlobals = /^(fetch|WebSocket|XMLHttpRequest|EventSource|sendBeacon|WebTransport)$/;
const networkModules =
  /^(?:(?:node:)?(?:http|https|http2|net|tls|dgram|dns)(?:\/promises)?|undici|node-fetch|axios|got|superagent|@velella\/ebb\/data-update)(?:\/|$)/;

function isRuntimeModule(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent)) return !parent.importClause?.isTypeOnly;
  if (ts.isExportDeclaration(parent)) return !parent.isTypeOnly;
  if (ts.isExternalModuleReference(parent)) return true;
  return (
    ts.isCallExpression(parent) &&
    (parent.expression.kind === ts.SyntaxKind.ImportKeyword || parent.expression.getText() === "require")
  );
}

function networkReferences(source: ts.SourceFile): string[] {
  const references: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isTypeQueryNode(node)) return;
    if (ts.isIdentifier(node) && networkGlobals.test(node.text)) references.push(node.text);
    if (ts.isStringLiteralLike(node) && networkModules.test(node.text) && isRuntimeModule(node)) {
      references.push(node.text);
    }
    if (ts.isStringLiteralLike(node) && ts.isElementAccessExpression(node.parent) && networkGlobals.test(node.text)) {
      references.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return references.sort();
}

test("shipped source has only the declared network entry points", async () => {
  const root = join(import.meta.dirname, "../../src");
  const files = ts.sys.readDirectory(root, [".ts", ".tsx", ".js", ".mjs", ".cjs"], ["**/vendor/**"], ["**/*"]);
  const entries = await Promise.all(
    files.map(async (file) => {
      const relative = file.slice(root.replaceAll("\\", "/").length + 1);
      const source = ts.createSourceFile(relative, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
      return [relative, networkReferences(source)] as const;
    }),
  );
  assert.deepEqual(new Map(entries.filter(([, references]) => references.length > 0)), approved);
});

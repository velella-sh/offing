// Repository contents are parsed, never evaluated. Run before the build so a clean checkout works.
import { readFileSync, existsSync } from "node:fs";
import { isBuiltin } from "node:module";
import { relative, resolve } from "node:path";

import ts from "typescript";

const root = resolve(process.argv[2] ?? ".");
const readJson = (name) => JSON.parse(readFileSync(resolve(root, name), "utf8"));
const manifest = readJson("package.json");
const config = readJson("dead-code.json");
const posix = (path) => path.replaceAll("\\", "/");
const localPath = (path) => posix(relative(root, path));
const expand = (patterns) =>
  ts.sys
    .readDirectory(root, [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"], config.ignore, patterns)
    .map((path) => resolve(path));
const sourcePath = (path) => resolve(root, path.replace(/^(?:\.\/)?dist\//u, "").replace(/\.(?:js|d\.ts)$/u, ".ts"));

function packageEntries(value) {
  if (typeof value === "string") return value.startsWith("./dist/") ? [sourcePath(value)] : [];
  return Object.values(value ?? {}).flatMap(packageEntries);
}

const publicEntries = packageEntries(manifest.exports);
const binaryEntries = Object.values(
  typeof manifest.bin === "string" ? { bin: manifest.bin } : (manifest.bin ?? {}),
).map(sourcePath);
const roots = new Set([...expand(config.entry), ...publicEntries, ...binaryEntries]);
const configFile = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
if (parsed.errors.length)
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (file) => file,
      getNewLine: () => "\n",
    }),
  );
const files = expand(config.project);
const program = ts.createProgram([...new Set([...files, ...roots])], parsed.options);
const checker = program.getTypeChecker();
const cache = ts.createModuleResolutionCache(root, (file) => file, parsed.options);
const problems = [];
const imports = new Map();
const edges = new Map();

function moduleName(node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  )
    return node.moduleSpecifier.text;
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression &&
    ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text;
  }
  if (
    ts.isCallExpression(node) &&
    node.arguments[0] &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText() === "require")
  ) {
    return node.arguments[0].text;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
    return node.argument.literal.text;
  }
  return undefined;
}

function specifiers(source) {
  const names = new Set();
  const visit = (node) => {
    const name = moduleName(node);
    if (name !== undefined) names.add(name);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

for (const file of files) {
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`Missing source file: ${file}`);
  const names = specifiers(source);
  imports.set(file, names);
  const targets = [];
  for (const name of names) {
    const target = ts.resolveModuleName(name, file, parsed.options, ts.sys, cache).resolvedModule?.resolvedFileName;
    if (target) targets.push(resolve(target));
  }
  edges.set(file, targets);
}

const reachable = new Set();
function reach(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  for (const target of edges.get(file) ?? []) reach(target);
}
for (const file of roots) reach(file);
for (const file of files) {
  if (!reachable.has(file) && !file.endsWith(".d.ts")) problems.push(`Unused file: ${localPath(file)}`);
}

// Canonical symbols keep aliases, public re-exports, namespace imports, and local uses together.
const canonical = (symbol) =>
  symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
const used = new Set();
function markPublic(file) {
  const source = program.getSourceFile(file);
  const symbol = source && checker.getSymbolAtLocation(source);
  if (symbol) for (const exported of checker.getExportsOfModule(symbol)) used.add(canonical(exported));
}
for (const file of roots) markPublic(file);

function declarationName(node) {
  return (
    node.parent?.name === node &&
    !ts.isShorthandPropertyAssignment(node.parent) &&
    !ts.isPropertyAccessExpression(node.parent)
  );
}

for (const file of files.filter((file) => reachable.has(file))) {
  const source = program.getSourceFile(file);
  const visit = (node) => {
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const name = node.propertyName ?? node.name;
      if (ts.isIdentifier(name))
        used.add(canonical(checker.getPropertyOfType(checker.getTypeAtLocation(node.parent), name.text)));
    }
    if (ts.isIdentifier(node) && !declarationName(node)) {
      const symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
      if (symbol && !ts.isImportSpecifier(node.parent) && !ts.isExportSpecifier(node.parent)) {
        used.add(canonical(symbol));
        const target = canonical(symbol);
        const namespaceEscapes = !ts.isPropertyAccessExpression(node.parent) || node.parent.expression !== node;
        if (target && target.flags & ts.SymbolFlags.Module && namespaceEscapes) {
          for (const exported of checker.getExportsOfModule(target)) used.add(canonical(exported));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
}
for (const file of files.filter((file) => reachable.has(file) && !roots.has(file))) {
  const source = program.getSourceFile(file);
  const symbol = checker.getSymbolAtLocation(source);
  if (!symbol || source.isDeclarationFile) continue;
  for (const exported of checker.getExportsOfModule(symbol)) {
    if (!used.has(canonical(exported))) problems.push(`Unused export: ${localPath(file)}: ${exported.name}`);
  }
}

const packageName = (specifier) =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
const dependencies = {
  ...manifest.dependencies,
  ...manifest.devDependencies,
  ...manifest.optionalDependencies,
  ...manifest.peerDependencies,
};
const referenced = new Set();
function recordImports(names) {
  for (const name of names) {
    if (!name.startsWith(".") && !name.startsWith("/") && !isBuiltin(name) && !name.startsWith("#")) {
      referenced.add(packageName(name));
    }
  }
}
for (const file of reachable) recordImports(imports.get(file) ?? []);
for (const file of expand(config.dependencyFiles)) {
  if (/\.(?:m?js|cjs)$/u.test(file)) {
    recordImports(
      specifiers(ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)),
    );
  }
}
const scripts = Object.values(manifest.scripts ?? {}).join("\n");
for (const [name, replacement] of Object.entries(manifest.overrides ?? {})) {
  if (replacement === `$${name}`) referenced.add(name);
}
function commandUsed(command) {
  const escaped = command.replace(/[.*+?^$\{\}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[\\s;&|/])${escaped}(?=$|[\\s;&|])`, "mu").test(scripts);
}
for (const name of Object.keys(dependencies)) {
  const packageFile = resolve(root, "node_modules", name, "package.json");
  if (!existsSync(packageFile)) continue;
  const installed = JSON.parse(readFileSync(packageFile, "utf8"));
  const binaries = typeof installed.bin === "string" ? [name.split("/").at(-1)] : Object.keys(installed.bin ?? {});
  if (binaries.some(commandUsed)) referenced.add(name);
}
// @types packages can be brought into the program implicitly, without an explicit source import.
for (const file of program.getSourceFiles()) {
  const match = /\/node_modules\/@types\/([^/]+)\//u.exec(posix(file.fileName));
  if (match && Object.hasOwn(dependencies, `@types/${match[1]}`)) referenced.add(`@types/${match[1]}`);
}
// Tools such as ESLint and Stryker load configured plugins by name instead of a JavaScript import.
for (const [name, paths] of Object.entries(config.dependencyReferences)) {
  if (!Object.hasOwn(dependencies, name)) throw new Error(`Stale dependency reference: ${name}`);
  if (!paths.length || !paths.some((path) => readFileSync(resolve(root, path), "utf8").includes(name))) {
    throw new Error(`Missing configured dependency reference: ${name}`);
  }
  referenced.add(name);
}
for (const name of Object.keys(dependencies)) {
  if (!referenced.has(name)) problems.push(`Unused dependency: ${name}`);
}
for (const name of referenced) {
  if (name !== manifest.name && !Object.hasOwn(dependencies, name)) problems.push(`Undeclared dependency: ${name}`);
}
for (const problem of problems.sort()) console.error(problem);
if (problems.length) process.exitCode = 1;
else console.log("No unused files, exports, or dependencies.");

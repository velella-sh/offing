import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";

const source = resolve("dist/src");
const output = resolve("dist/public-types");
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const publicEntries = [manifest.types, ...Object.values(manifest.exports).map((entry) => entry?.types)];
const moduleRoots = [...new Set(publicEntries.filter(Boolean))].map((entry) =>
  resolve(source, relative(output, entry)),
);

const program = ts.createProgram(moduleRoots, {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  types: [],
});

for (const root of moduleRoots) {
  if (!program.getSourceFile(root)) throw new Error(`Missing public declaration: ${root}`);
}

rmSync(output, { recursive: true, force: true });
for (const file of program.getSourceFiles()) {
  const path = relative(source, file.fileName);
  if (!file.isDeclarationFile || isAbsolute(path) || path.startsWith(`..${sep}`)) continue;
  const target = resolve(output, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(file.fileName, target);
}

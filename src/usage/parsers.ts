import type { SourceUsage, SourceUsageContract } from "../domain.js";
import { languageFor, type SourceFile } from "../source-files.js";
import type { GuardSymbols } from "./guard-symbols.js";
import { analyzeJavaScriptFile } from "./javascript.js";
import { analyzePythonFile } from "./python.js";

export async function parsedUsages(
  file: SourceFile,
  contents: string,
  contracts: readonly SourceUsageContract[],
): Promise<(Map<string, SourceUsage[]> & { analysisCapped?: boolean }) | undefined> {
  try {
    if (file.language === "python")
      return await analyzePythonFile({ path: file.path, language: "python", source: contents }, contracts);
    if (file.language === "javascript" || file.language === "typescript") {
      return await analyzeJavaScriptFile({ path: file.path, language: file.language, source: contents }, contracts);
    }
  } catch {
    // The parser could not run; the regex scanner covers the file.
  }
  return undefined;
}

/** Routes snippets to their lazily loaded Go, Java or C# syntax frontend. */
export async function analyzeGuardSymbols(path: string, source: string): Promise<GuardSymbols | undefined> {
  switch (languageFor(path)) {
    case "go":
      return (await import("./go.js")).analyzeGoGuard(source);
    case "java":
      return (await import("./java.js")).analyzeJavaGuard(source);
    case "csharp":
      return (await import("./csharp.js")).analyzeCsharpGuard(source);
    default:
      return undefined;
  }
}

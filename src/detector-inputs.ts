import type { DetectorInputs } from "./sdk.js";

const wildcardCache = new Map<string, RegExp>();

function wildcard(pattern: string): RegExp {
  const cached = wildcardCache.get(pattern);
  if (cached) return cached;
  const source = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const compiled = new RegExp(`^${source}$`, "i");
  wildcardCache.set(pattern, compiled);
  return compiled;
}

/** Lowercased extensions derived once per `inputs` object. Directory prefixes stay lazy — they can be huge. */
interface CompiledInputs {
  readonly namePatterns: readonly RegExp[];
  readonly extensions: readonly string[];
  directoryPrefixes?: readonly string[];
}

const compiledInputs = new WeakMap<DetectorInputs, CompiledInputs>();

function compileInputs(inputs: DetectorInputs): CompiledInputs {
  const cached = compiledInputs.get(inputs);
  if (cached) return cached;
  const compiled: CompiledInputs = {
    namePatterns: (inputs.fileNames ?? []).map(wildcard),
    extensions: [...(inputs.extensions ?? []), ...(inputs.sourceExtensions ?? [])].map((extension) =>
      extension.toLowerCase(),
    ),
  };
  compiledInputs.set(inputs, compiled);
  return compiled;
}

function directoryPrefixes(inputs: DetectorInputs, compiled: CompiledInputs): readonly string[] {
  if (compiled.directoryPrefixes) return compiled.directoryPrefixes;
  const prefixes = (inputs.directories ?? []).map((directory) => `${directory.replace(/\/+$/, "")}/`);
  compiled.directoryPrefixes = prefixes;
  return prefixes;
}

/**
 * Whether `path` (relative to the scanned root, forward slashes) is a file `inputs` declares. A path matches when
 * its base name is one of `fileNames`, ends with one of `extensions` or `sourceExtensions`, or lies under one of
 * `directories` at any depth. Names and extensions compare case-insensitively.
 */
export function declaresInput(inputs: DetectorInputs, path: string): boolean {
  const normalized = path.split("\\").join("/").replace(/^\.\//, "");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
  const compiled = compileInputs(inputs);
  // Names and extensions first: directory prefixes can be pathological (see coverage slash tests).
  if (compiled.namePatterns.some((pattern) => pattern.test(base))) return true;
  if (compiled.extensions.some((extension) => base.endsWith(extension))) return true;
  return directoryPrefixes(inputs, compiled).some(
    (prefix) => normalized.startsWith(prefix) || normalized.includes(`/${prefix}`),
  );
}

import { isIsoDate } from "@velella/ebb/registry";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ErrorObject, ValidateFunction } from "ajv";
import { printParseErrorCode, visit, type JSONPath } from "jsonc-parser";

import { CONFIG_FILE_NAME, findConfigFile } from "./config.js";
import { findPackageFile, parseBoundedJson, readBoundedFile } from "./package-files.js";

interface Position {
  line: number;
  column: number;
}

interface ConfigDiagnostic extends Position {
  code: "invalid-json" | "invalid-value" | "unknown-key" | "deprecated-key" | "unreadable-file" | "input-limit";
  severity: "error" | "warning";
  file: string;
  pointer: string;
  message: string;
  suggestion: string;
}

interface ConfigValidationResult {
  schemaVersion: "offing.config-validation.v1";
  file: string | null;
  valid: boolean;
  diagnostics: ConfigDiagnostic[];
}

type Issue = Omit<ConfigDiagnostic, "file" | "line" | "column">;

let schemaValidator: Promise<ValidateFunction<unknown>> | undefined;

async function compileSchema(): Promise<ValidateFunction<unknown>> {
  const { Ajv2020 } = await import("ajv/dist/2020.js");
  const path = await findPackageFile("schemas/config.v1.schema.json", import.meta.url);
  const schema: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error("The packaged Offing config schema must be an object.");
  }
  return new Ajv2020({ allErrors: true, allowUnionTypes: true, ownProperties: true })
    .addFormat("date", isIsoDate)
    .compile<unknown>(schema);
}

function pointerFor(path: JSONPath): string {
  return path.map((part) => `/${String(part).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

function diagnostic(file: string, issue: Issue, position: Position = { line: 1, column: 1 }): ConfigDiagnostic {
  return { file, ...position, ...issue };
}

function syntaxIssue(message: string): Issue {
  return {
    code: "invalid-json",
    severity: "error",
    pointer: "",
    message,
    suggestion: "Use strict JSON with double-quoted keys, commas between entries, and no trailing comma or comments.",
  };
}

function sourceLocations(text: string, file: string) {
  const values = new Map<string, Position>();
  const keys = new Map<string, Position>();
  const errors: ConfigDiagnostic[] = [];
  const recordValue = (_offset: number, _length: number, line: number, column: number, path: () => JSONPath) => {
    values.set(pointerFor(path()), { line: line + 1, column: column + 1 });
  };
  visit(
    text,
    {
      onObjectBegin: recordValue,
      onArrayBegin: recordValue,
      onLiteralValue: (_value, ...location) => recordValue(...location),
      onObjectProperty(key, _offset, _length, line, column, path) {
        keys.set(pointerFor([...path(), key]), { line: line + 1, column: column + 1 });
      },
      onError(code, _offset, _length, line, column) {
        errors.push(
          diagnostic(file, syntaxIssue(`Invalid JSON (${printParseErrorCode(code)}).`), {
            line: line + 1,
            column: column + 1,
          }),
        );
      },
    },
    { disallowComments: true },
  );
  return { values, keys, errors };
}

function expectedValue(error: ErrorObject): string {
  switch (error.keyword) {
    case "enum": {
      const values: unknown = error.params.allowedValues;
      const allowed = Array.isArray(values) ? values.map((value: unknown) => JSON.stringify(value)).join(", ") : "";
      return `Use one of: ${allowed}.`;
    }
    case "const":
      return `Use ${JSON.stringify(error.params.allowedValue)}.`;
    case "type":
      return `Use a value of type ${String(error.params.type).replaceAll(",", " or ")}.`;
    case "pattern":
      return "Use a string containing at least one non-whitespace character.";
    default:
      return "Use a value allowed by the Offing config schema.";
  }
}

function schemaDiagnostic(
  file: string,
  error: ErrorObject,
  locations: ReturnType<typeof sourceLocations>,
): ConfigDiagnostic {
  if (error.keyword === "additionalProperties") {
    const key = String(error.params.additionalProperty);
    const pointer = `${error.instancePath}${pointerFor([key])}`;
    return diagnostic(
      file,
      {
        pointer,
        code: "unknown-key",
        severity: "error",
        message: `Unknown key ${JSON.stringify(key)}.`,
        suggestion: "Remove the key or use a supported key such as failOn, ignore, dataVersion, or baseline.",
      },
      locations.keys.get(pointer),
    );
  }
  const pointer = error.instancePath;
  return diagnostic(
    file,
    {
      pointer,
      code: "invalid-value",
      severity: "error",
      message: `${pointer || "Configuration"} ${error.message ?? "does not match the config schema"}.`,
      suggestion: expectedValue(error),
    },
    locations.values.get(pointer),
  );
}

function deprecations(file: string, keys: Map<string, Position>): ConfigDiagnostic[] {
  return ["ignorePaths", "ignore-paths"].flatMap((key) => {
    const pointer = pointerFor([key]);
    const position = keys.get(pointer);
    if (!position) return [];
    return [
      diagnostic(
        file,
        {
          pointer,
          code: "deprecated-key",
          severity: "warning",
          message: `Key "${key}" is deprecated.`,
          suggestion: 'Use "ignore" and keep the effective value if both spellings are present.',
        },
        position,
      ),
    ];
  });
}

function limitDiagnostic(file: string, detail: string): ConfigDiagnostic {
  return diagnostic(file, {
    code: "input-limit",
    severity: "error",
    pointer: "",
    message: detail,
    suggestion: "Reduce the size or nesting of the configuration.",
  });
}

async function validateText(file: string, text: string): Promise<ConfigDiagnostic[]> {
  const parsed = parseBoundedJson(text);
  if (parsed?.skipped) return [limitDiagnostic(file, parsed.skipped.detail)];
  const locations = sourceLocations(text, file);
  if (!parsed) return locations.errors.length > 0 ? locations.errors : [diagnostic(file, syntaxIssue("Invalid JSON."))];
  const validate = await (schemaValidator ??= compileSchema());
  validate(parsed.value);
  return [
    ...(validate.errors ?? []).map((error) => schemaDiagnostic(file, error, locations)),
    ...deprecations(file, locations.keys),
  ].sort((left, right) => left.line - right.line || left.column - right.column);
}

function unreadable(file: string, detail: string): ConfigDiagnostic {
  return diagnostic(file, {
    code: "unreadable-file",
    severity: "error",
    pointer: "",
    message: detail,
    suggestion: "Pass the path to a readable Offing JSON config file.",
  });
}

async function inspectFile(file: string): Promise<ConfigDiagnostic[]> {
  let input: Awaited<ReturnType<typeof readBoundedFile>>;
  try {
    if (!(await stat(file)).isFile()) return [unreadable(file, "Config path is not a regular file.")];
    input = await readBoundedFile(file);
  } catch (error) {
    return [unreadable(file, error instanceof Error ? error.message : String(error))];
  }
  if (!input) return [unreadable(file, "Config file does not exist.")];
  if (input.skipped) return [limitDiagnostic(file, input.skipped.detail)];
  return validateText(file, input.contents);
}

async function explicitConfigPath(path: string): Promise<string> {
  const absolute = resolve(path);
  const info = await stat(absolute).catch(() => undefined);
  if (!info?.isDirectory()) return absolute;
  return (await findConfigFile(absolute)) ?? resolve(absolute, CONFIG_FILE_NAME);
}

/** Validate one explicit file/directory or discover the current project's config. */
export async function inspectConfig(path?: string): Promise<ConfigValidationResult> {
  return path === undefined ? inspectDiscoveredConfig(".") : inspectResolvedConfig(await explicitConfigPath(path));
}

/** Use the same discovery rules as the scan command, including when doctor is pointed at a project file. */
export async function inspectDiscoveredConfig(path: string): Promise<ConfigValidationResult> {
  const absolute = resolve(path);
  const info = await stat(absolute).catch(() => undefined);
  const start = info?.isFile() ? dirname(absolute) : absolute;
  return inspectResolvedConfig((await findConfigFile(start)) ?? null);
}

async function inspectResolvedConfig(file: string | null): Promise<ConfigValidationResult> {
  const diagnostics = file === null ? [] : await inspectFile(file);
  return {
    schemaVersion: "offing.config-validation.v1",
    file,
    valid: diagnostics.every((item) => item.severity !== "error"),
    diagnostics,
  };
}

export function renderConfigDiagnostic({
  file,
  line,
  column,
  message,
  severity,
  suggestion,
}: ConfigDiagnostic): string {
  return `${file}:${line}:${column}: ${severity}: ${message} ${suggestion}`;
}

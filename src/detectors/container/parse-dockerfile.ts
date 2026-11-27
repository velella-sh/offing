import { isInterpolated, parseImageReference } from "./parse-image.js";
import { required } from "../../required.js";

/**
 * Pure, bounded parser for the `FROM`, literal runtime install, and legacy syntax instructions Offing reads from
 * Dockerfile, *.Dockerfile, and Containerfile.
 *
 * Literal, well-formed image references are returned as `image` declarations. References
 * that need build arguments without literal defaults are returned as `dynamic`. `scratch`,
 * references to earlier stages, comments, and unsupported `RUN` commands produce nothing. The parser
 * never evaluates contents or executes tools.
 *
 * A `MAINTAINER` instruction and the space-separated `ENV key value` form are returned as `maintainer` and
 * `legacy-env` declarations, including when they appear inside an `ONBUILD` trigger. The parser keeps the
 * text as written so a fixer can decide whether it can be quoted safely.
 */

export const MAXIMUM_INPUT_BYTES = 1024 * 1024;
export const MAXIMUM_LINE_LENGTH = 4096;

export interface DockerfileImageDeclaration {
  kind: "image";
  value: string;
  line: number;
}

export interface DockerfileDynamicDeclaration {
  kind: "dynamic";
  value: string;
  line: number;
}

export type Runtime = "dotnet" | "golang" | "java" | "nodejs" | "php" | "python" | "ruby";

export interface DockerfileRuntimeDeclaration {
  kind: "runtime";
  runtime: Runtime;
  value: string;
  line: number;
}

export interface DockerfileMaintainerDeclaration {
  kind: "maintainer";
  value: string;
  line: number;
}

export interface DockerfileLegacyEnvDeclaration {
  kind: "legacy-env";
  key: string;
  value: string;
  line: number;
}

export type DockerfileDeclaration =
  | DockerfileImageDeclaration
  | DockerfileDynamicDeclaration
  | DockerfileRuntimeDeclaration
  | DockerfileMaintainerDeclaration
  | DockerfileLegacyEnvDeclaration;

interface LogicalLine {
  text: string;
  line: number;
  spans: Array<{ start: number; line: number }>;
}

interface HereDocument {
  delimiter: string;
  stripTabs: boolean;
}

/** Read common Dockerfile heredoc starts outside quoted operands. Their bodies are file data. */
function heredocStarts(text: string): HereDocument[] {
  if (!/^(?:RUN|COPY|ADD)\s/i.test(text)) return [];
  const tokens =
    /"(?:\\.|[^"\\])*"|'[^']*'|(?<![<\\])<<(?!<)(-?)\s*(?:"([A-Za-z0-9_.-]+)"|'([A-Za-z0-9_.-]+)'|([A-Za-z0-9_.-]+))(?=\s|$)/g;
  return [...text.matchAll(tokens)].flatMap((match) => {
    const delimiter = match[2] ?? match[3] ?? match[4];
    return delimiter ? [{ delimiter, stripTabs: match[1] === "-" }] : [];
  });
}

function logicalLines(contents: string): LogicalLine[] {
  const result: LogicalLine[] = [];
  let pending: LogicalLine | undefined;
  let heredocs: HereDocument[] = [];
  for (const [index, raw] of contents.split(/\r?\n/).entries()) {
    const heredoc = heredocs[0];
    if (heredoc !== undefined) {
      if ((heredoc.stripTabs ? raw.replace(/^\t+/, "") : raw) === heredoc.delimiter) heredocs.shift();
      continue;
    }
    if (raw.length > MAXIMUM_LINE_LENGTH) {
      pending = undefined;
      continue;
    }
    // Comment lines inside a continued instruction are dropped, as Docker does.
    if (raw.trimStart().startsWith("#")) continue;
    const continued = /\\\s*$/.test(raw);
    const piece = raw.replace(/\\\s*$/, "");
    if (pending) {
      pending.spans.push({ start: pending.text.length + 1, line: index + 1 });
      pending.text += ` ${piece.trim()}`;
    } else {
      pending = { text: piece.trim(), line: index + 1, spans: [{ start: 0, line: index + 1 }] };
    }
    if (!continued) {
      result.push(pending);
      heredocs = heredocStarts(pending.text);
      pending = undefined;
    }
  }
  // A dangling continuation at end of file is malformed: drop it.
  return result;
}

const ASDF_RUNTIMES: Readonly<Record<string, Runtime>> = {
  "dotnet-core": "dotnet",
  golang: "golang",
  java: "java",
  nodejs: "nodejs",
  php: "php",
  python: "python",
  ruby: "ruby",
};
const LITERAL_VERSION = /^v?\d+(?:\.\d+){0,3}(?:[-+][A-Za-z0-9][A-Za-z0-9._+-]*)?$/;
const RUN_INSTALL =
  /(?:^|&&)\s*(?:(nvm|pyenv)\s+install\s+([^\s;&|]+)|(sdk|asdf)\s+install\s+([^\s;&|]+)\s+([^\s;&|]+))/g;

function literalVersion(token: string): string | undefined {
  const quote = token[0];
  const value = quote === '"' || quote === "'" ? (token.endsWith(quote) ? token.slice(1, -1) : "") : token;
  return value.length <= 64 && LITERAL_VERSION.test(value) ? value : undefined;
}

function lineAt(logical: LogicalLine, offset: number): number {
  for (let index = logical.spans.length - 1; index >= 0; index -= 1) {
    const span = required(logical.spans[index], "logical line span");
    if (span.start <= offset) return span.line;
  }
  return logical.line;
}

function runtimePins(logical: LogicalLine): DockerfileRuntimeDeclaration[] {
  const run = /^RUN\s+([\s\S]+)$/i.exec(logical.text);
  if (!run?.[1] || run[1].trimStart().startsWith("[")) return [];

  const declarations: DockerfileRuntimeDeclaration[] = [];
  const shellOffset = logical.text.indexOf(run[1]);
  for (const match of run[1].matchAll(RUN_INSTALL)) {
    const manager = required(match[1] ?? match[3], "install manager");
    const candidate = match[4];
    const rawVersion = match[2] ?? match[5];
    const value = rawVersion === undefined ? undefined : literalVersion(rawVersion);
    const runtime =
      manager === "nvm"
        ? "nodejs"
        : manager === "pyenv"
          ? "python"
          : manager === "sdk" && candidate === "java"
            ? "java"
            : manager === "asdf" && candidate
              ? ASDF_RUNTIMES[candidate]
              : undefined;
    if (!runtime || !value) continue;
    const commandOffset = match[0].indexOf(manager);
    declarations.push({
      kind: "runtime",
      runtime,
      value,
      line: lineAt(logical, shellOffset + match.index + commandOffset),
    });
  }
  return declarations;
}

const LEGACY_INSTRUCTION = /^(?:ONBUILD\s+)?(MAINTAINER|ENV)\s+([\s\S]+)$/i;

/** The deprecated `MAINTAINER` text and the legacy `ENV key value` form, including inside an `ONBUILD` trigger. */
function legacyInstructions(
  logical: LogicalLine,
): Array<DockerfileMaintainerDeclaration | DockerfileLegacyEnvDeclaration> {
  const match = LEGACY_INSTRUCTION.exec(logical.text);
  if (!match) return [];
  const [, instruction, rest] = match;
  if (required(instruction, "instruction").toUpperCase() === "MAINTAINER") {
    const value = required(rest, "instruction text").trim();
    return value.length === 0 ? [] : [{ kind: "maintainer", value, line: logical.line }];
  }
  // Docker treats the form as legacy only when the first word is not a key=value assignment.
  const words = required(rest, "instruction text").trim().split(/\s+/);
  const key = words.shift();
  const value = words.join(" ");
  if (key === undefined || key.includes("=") || value.length === 0) return [];
  return [{ kind: "legacy-env", key, value, line: logical.line }];
}

export interface DockerfileStage {
  readonly name: string;
  readonly reference: string;
  readonly resolved: string;
  readonly line: number;
  readonly parent?: number;
  readonly copies: Array<{ reference: string; line: number; stage?: number }>;
  readonly sourceLabels: string[];
}

const ARG_NAME = "[A-Za-z_][A-Za-z0-9_]*";
const ARG = new RegExp(`^ARG\\s+(${ARG_NAME})(?:=(.*))?$`, "i");
const VARIABLE = new RegExp(`\\$(?:\\{(${ARG_NAME})\\}|(${ARG_NAME}))`, "g");

function expandArguments(value: string, defaults: ReadonlyMap<string, string>): string {
  return value.replace(VARIABLE, (token: string, braced?: string, bare?: string) => {
    return defaults.get(braced ?? bare ?? "") ?? token;
  });
}

function readArgument(text: string, defaults: Map<string, string>): void {
  const match = ARG.exec(text);
  if (!match?.[1] || match[2] === undefined) return;
  const value = match[2].replace(/^(["'])([^"']*)\1$/, "$2");
  if (!/^[^\s"'\\`]*$/.test(value)) return;
  defaults.set(match[1], expandArguments(value, defaults));
}

function startStage(
  logical: LogicalLine,
  defaults: ReadonlyMap<string, string>,
  names: ReadonlyMap<string, number>,
  index: number,
): DockerfileStage | undefined {
  const from = /^FROM\s+(?:--[^\s]+\s+)*(\S+)(?:\s+AS\s+([A-Za-z0-9_.-]+))?$/i.exec(logical.text);
  if (!from?.[1]) return undefined;
  const resolved = expandArguments(from[1], defaults);
  const parent = names.get(resolved.toLowerCase());
  return {
    name: from[2] ?? String(index),
    reference: from[1],
    resolved,
    line: logical.line,
    copies: [],
    sourceLabels: [],
    ...(parent === undefined ? {} : { parent }),
  };
}

function stageDetails(logical: LogicalLine, stage: DockerfileStage, names: ReadonlyMap<string, number>): void {
  const { text, line } = logical;
  const copy = /^COPY\s+(?:--[^\s]+\s+)*?--from=(\S+)\s+/i.exec(text)?.[1];
  if (copy !== undefined) {
    const dependency = names.get(copy.toLowerCase());
    stage.copies.push({ reference: copy, line, ...(dependency === undefined ? {} : { stage: dependency }) });
  }
  if (/^LABEL\s/i.test(text)) {
    for (const match of text.matchAll(/(?:^|\s)org\.opencontainers\.image\.source=(?:"([^"]+)"|'([^']+)'|([^\s]+))/g)) {
      const source = match[1] ?? match[2] ?? match[3];
      if (source && !isInterpolated(source)) stage.sourceLabels.push(source);
    }
  }
}

function addStageDeclaration(stage: DockerfileStage, declarations: DockerfileDeclaration[]): void {
  const { resolved: value, line } = stage;
  if (stage.parent !== undefined || value.toLowerCase() === "scratch") return;
  if (isInterpolated(value)) declarations.push({ kind: "dynamic", value: stage.reference, line });
  else if (parseImageReference(value)) declarations.push({ kind: "image", value, line });
}

/** Parse instructions and the exact stage dependencies using the same bounded logical lines. */
export function parseDockerfileBuild(
  contents: string,
  resolveDefaults = true,
): {
  declarations: DockerfileDeclaration[];
  stages: DockerfileStage[];
} {
  const declarations: DockerfileDeclaration[] = [];
  const stages: DockerfileStage[] = [];
  if (Buffer.byteLength(contents, "utf8") > MAXIMUM_INPUT_BYTES) return { declarations, stages };
  const defaults = new Map<string, string>();
  const names = new Map<string, number>();
  for (const logical of logicalLines(contents)) {
    declarations.push(...runtimePins(logical), ...legacyInstructions(logical));
    const current = stages.at(-1);
    if (resolveDefaults && current === undefined) readArgument(logical.text, defaults);
    const stage = startStage(logical, defaults, names, stages.length);
    if (stage === undefined) {
      if (current) stageDetails(logical, current, names);
      continue;
    }
    addStageDeclaration(stage, declarations);
    names.set(String(stages.length), stages.length);
    names.set(stage.name.toLowerCase(), stages.length);
    stages.push(stage);
  }
  return { declarations, stages };
}

/** Parse `FROM`, supported `RUN`, and deprecated syntax instructions without file, network, or process I/O. */
export function parseDockerfile(contents: string): DockerfileDeclaration[] {
  return parseDockerfileBuild(contents, false).declarations;
}

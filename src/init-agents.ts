import { isDeepStrictEqual } from "node:util";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { insertHook, removeHook, type HookJson } from "./agent-hooks/json-edit.js";
import { AgentFileError, renderDiff, withAgentSection } from "./agent-instructions.js";

export type AgentFileName = "AGENTS.md" | "CLAUDE.md";

export interface InitAgentsOptions {
  /** The repository root. */
  root: string;
  /** Which file to update; by default AGENTS.md, else an existing CLAUDE.md, else a new AGENTS.md. */
  file?: AgentFileName;
  /** Report what would change, including a diff, and write nothing. */
  dryRun?: boolean;
}

export interface InitAgentsResult {
  file: AgentFileName;
  change: "created" | "added" | "updated" | "unchanged";
  written: boolean;
  /** A unified diff of the change; empty when nothing changes. */
  diff: string;
}

async function read(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Refuses a file that is, or sits under, a link pointing outside the repository: the command must not write through it. */
async function assertInside(root: string, path: string): Promise<void> {
  let existing = path;
  for (;;) {
    try {
      await lstat(existing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) return;
      existing = parent;
    }
  }
  const target = await realpath(existing);
  const inside = relative(await realpath(root), target);
  if (inside.startsWith("..") || inside.split(sep)[0] === "..") {
    throw new AgentFileError(`${path} is a link to a file outside the repository, so it was not changed.`);
  }
}

export interface AgentFileOptions {
  dryRun?: boolean;
  /** Text placed before the section when the file does not exist yet, such as front matter a host requires. */
  createPrefix?: string;
}

/** Adds or refreshes the Offing section in one file under `root`, creating the file and its folders when needed. */
export async function updateAgentFile(
  root: string,
  file: string,
  options: AgentFileOptions = {},
): Promise<InitAgentsResult> {
  const path = join(root, file);
  await assertInside(root, path);
  const before = await read(path);
  const update = withAgentSection(before);
  const text =
    update.change === "created" && options.createPrefix ? `${options.createPrefix}${update.text}` : update.text;
  const diff = update.change === "unchanged" ? "" : renderDiff(file, before ?? "", text);
  if (update.change === "unchanged" || options.dryRun)
    return { file: file as AgentFileName, change: update.change, written: false, diff };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  return { file: file as AgentFileName, change: update.change, written: true, diff };
}

export const CLAUDE_CODE_SETTINGS_FILE = ".claude/settings.json";
export const CLAUDE_CODE_HOOK_MATCHER = "Write|Edit|MultiEdit";
export const CLAUDE_CODE_HOOK_COMMAND = "offing hook claude-code";

export interface InitClaudeHooksOptions {
  /** The repository root. */
  root: string;
  /** Report what would change, including a diff, and write nothing. */
  dryRun?: boolean;
  remove?: boolean;
}

export interface InitClaudeHooksResult {
  file: string;
  change: "created" | "updated" | "removed" | "unchanged";
  written: boolean;
  /** A unified diff of the change; empty when nothing changes. */
  diff: string;
}

type HookMerge = (document: unknown) => {
  readonly change: "added" | "unchanged";
  readonly settings?: Record<string, unknown>;
  readonly hooks?: Record<string, unknown>;
  readonly document?: Record<string, unknown>;
};

async function hookFileResult(
  options: InitClaudeHooksOptions,
  file: string,
  update: (before: string | undefined) => string | undefined,
  mode?: number,
): Promise<InitClaudeHooksResult> {
  const root = resolve(options.root);
  const info = await lstat(root).catch(() => undefined);
  if (!info?.isDirectory()) throw new AgentFileError(`${root} is not a directory.`);
  const path = join(root, file);
  await assertInside(root, path);
  const before = await read(path);
  const text = update(before);
  if (text === undefined || text === before) return { file, change: "unchanged", written: false, diff: "" };
  const change = options.remove ? "removed" : before === undefined ? "created" : "updated";
  const diff = renderDiff(file, before ?? "", text);
  if (!options.dryRun) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, { mode });
  }
  return { file, change, written: !options.dryRun, diff };
}

function parseHooksJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AgentFileError(`${file} is not valid JSON, so it was not changed.`);
  }
}

function initJsonHook(
  options: InitClaudeHooksOptions,
  file: string,
  spec: HookJson,
  merge: HookMerge,
  beforeWrite?: HookJson,
): Promise<InitClaudeHooksResult> {
  return hookFileResult(options, file, (before) => {
    if (before === undefined && options.remove) return undefined;
    const text = before ?? "{}\n";
    const result = merge(parseHooksJson(text, file));
    if (options.remove) return removeHook(beforeWrite ? removeHook(text, beforeWrite) : text, spec);
    const post =
      before === undefined
        ? `${JSON.stringify(result.settings ?? result.hooks ?? result.document, null, 2)}\n`
        : result.change === "unchanged"
          ? before
          : insertHook(before, spec);
    if (!beforeWrite) return post;
    const updated = withPreWriteHook(post, file, beforeWrite);
    return before === undefined ? `${JSON.stringify(parseHooksJson(updated, file), null, 2)}\n` : updated;
  });
}

function withPreWriteHook(text: string, file: string, spec: HookJson): string {
  const document = parseHooksJson(text, file);
  const hooks = isRecord(document) && isRecord(document.hooks) ? document.hooks : {};
  const entries = hooks[spec.event];
  if (entries !== undefined && !Array.isArray(entries)) {
    throw new AgentFileError(`${file} has a "hooks.${spec.event}" value that is not an array, so it was not changed.`);
  }
  if (entries?.some((entry) => isDeepStrictEqual(entry, spec.entry))) return text;
  return insertHook(text, spec);
}

/** Recognizes a hook this command wrote, however its launcher is spelled (`npx … offing`, a global bin, a path). */
const OFFING_HOOK_COMMAND = /\boffing(?:-deprecation)?\b.*\bhook\s+claude-code\b/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOffingPostToolUse(entries: readonly unknown[]): boolean {
  return entries.some((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) return false;
    return entry.hooks.some(
      (hook) => isRecord(hook) && typeof hook.command === "string" && OFFING_HOOK_COMMAND.test(hook.command),
    );
  });
}

const CLAUDE_HOOK_SPEC: HookJson = {
  event: "PostToolUse",
  entry: {
    matcher: CLAUDE_CODE_HOOK_MATCHER,
    hooks: [{ type: "command", command: CLAUDE_CODE_HOOK_COMMAND, timeout: 60 }],
  },
};

/** Merges the post-edit entry into a parsed settings document, keeping every existing key and hook in place. */
export function withClaudeCodePostToolUse(settings: unknown): {
  settings: Record<string, unknown>;
  change: "added" | "unchanged";
} {
  if (!isRecord(settings))
    throw new AgentFileError(`${CLAUDE_CODE_SETTINGS_FILE} does not hold a JSON object, so it was not changed.`);
  const hooksValue = settings.hooks;
  if (hooksValue !== undefined && !isRecord(hooksValue)) {
    throw new AgentFileError(
      `${CLAUDE_CODE_SETTINGS_FILE} has a "hooks" value that is not an object, so it was not changed.`,
    );
  }
  const hooks = (hooksValue ?? {}) as Record<string, unknown>;
  const postValue = hooks.PostToolUse;
  if (postValue !== undefined && !Array.isArray(postValue)) {
    throw new AgentFileError(
      `${CLAUDE_CODE_SETTINGS_FILE} has a "hooks.PostToolUse" value that is not an array, so it was not changed.`,
    );
  }
  const postToolUse = (postValue ?? []) as unknown[];
  if (hasOffingPostToolUse(postToolUse)) return { settings: structuredClone(settings), change: "unchanged" };
  const entry = CLAUDE_HOOK_SPEC.entry;
  return {
    settings: {
      ...structuredClone(settings),
      hooks: { ...hooks, PostToolUse: [...structuredClone(postToolUse), entry] },
    },
    change: "added",
  };
}

/** Writes or merges the Claude Code post-edit hook into `.claude/settings.json`, preserving the user's hooks. */
export async function initClaudeHooks(options: InitClaudeHooksOptions): Promise<InitClaudeHooksResult> {
  return initJsonHook(options, CLAUDE_CODE_SETTINGS_FILE, CLAUDE_HOOK_SPEC, withClaudeCodePostToolUse, {
    ...CLAUDE_HOOK_SPEC,
    event: "PreToolUse",
  });
}

export const CODEX_HOOKS_FILE = ".codex/hooks.json";
export const CODEX_HOOK_MATCHER = "apply_patch";
export const CODEX_HOOK_COMMAND = "offing hook codex";

export type InitCodexHooksOptions = InitClaudeHooksOptions;
export type InitCodexHooksResult = InitClaudeHooksResult;

/** Recognizes the hook this command wrote, however its launcher is spelled (`npx … offing`, a global bin, a path). */
const OFFING_CODEX_HOOK_COMMAND = /\boffing(?:-deprecation)?\b.*\bhook\s+codex\b/;

function hasOffingCodexPostToolUse(entries: readonly unknown[]): boolean {
  return entries.some((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) return false;
    return entry.hooks.some(
      (hook) => isRecord(hook) && typeof hook.command === "string" && OFFING_CODEX_HOOK_COMMAND.test(hook.command),
    );
  });
}

const CODEX_HOOK_SPEC: HookJson = {
  event: "PostToolUse",
  entry: {
    matcher: CODEX_HOOK_MATCHER,
    hooks: [{ type: "command", command: CODEX_HOOK_COMMAND, timeout: 60 }],
  },
};

/** Merges the post-edit entry into a parsed hooks document, keeping every existing key and hook in place. */
export function withCodexPostToolUse(hooks: unknown): {
  hooks: Record<string, unknown>;
  change: "added" | "unchanged";
} {
  if (!isRecord(hooks))
    throw new AgentFileError(`${CODEX_HOOKS_FILE} does not hold a JSON object, so it was not changed.`);
  const hooksValue = hooks.hooks;
  if (hooksValue !== undefined && !isRecord(hooksValue)) {
    throw new AgentFileError(`${CODEX_HOOKS_FILE} has a "hooks" value that is not an object, so it was not changed.`);
  }
  const events = (hooksValue ?? {}) as Record<string, unknown>;
  const postValue = events.PostToolUse;
  if (postValue !== undefined && !Array.isArray(postValue)) {
    throw new AgentFileError(
      `${CODEX_HOOKS_FILE} has a "hooks.PostToolUse" value that is not an array, so it was not changed.`,
    );
  }
  const postToolUse = (postValue ?? []) as unknown[];
  if (hasOffingCodexPostToolUse(postToolUse)) return { hooks: structuredClone(hooks), change: "unchanged" };
  const entry = CODEX_HOOK_SPEC.entry;
  return {
    hooks: { ...structuredClone(hooks), hooks: { ...events, PostToolUse: [...structuredClone(postToolUse), entry] } },
    change: "added",
  };
}

/**
 * Writes or merges the Codex post-edit hook into `.codex/hooks.json`, the project-level location Codex documents
 * (<https://learn.chatgpt.com/docs/hooks>), preserving the user's hooks. The home directory is never touched.
 */
export async function initCodexHooks(options: InitCodexHooksOptions): Promise<InitCodexHooksResult> {
  return initJsonHook(options, CODEX_HOOKS_FILE, CODEX_HOOK_SPEC, withCodexPostToolUse, {
    ...CODEX_HOOK_SPEC,
    event: "PreToolUse",
  });
}

export const CURSOR_HOOKS_FILE = ".cursor/hooks.json";
export const CURSOR_RULES_FILE = ".cursor/rules/offing.mdc";
export const CURSOR_HOOK_COMMAND = "offing hook cursor";
/** Front matter Cursor requires on a newly created project rule (matches `setup.ts`). */
export const CURSOR_RULE_PREFIX =
  "---\ndescription: Check a dependency with Offing before adding it\nalwaysApply: true\n---\n\n";

export type InitCursorHooksOptions = InitClaudeHooksOptions;

export interface InitCursorHooksResult {
  hooks: InitClaudeHooksResult;
  rule: Omit<InitAgentsResult, "file"> & { file: string };
}

/** Recognizes the Cursor hook this command wrote, however its launcher is spelled. */
const OFFING_CURSOR_HOOK_COMMAND = /\boffing(?:-deprecation)?\b.*\bhook\s+cursor\b/;

function hasOffingAfterFileEdit(entries: readonly unknown[]): boolean {
  return entries.some(
    (entry) => isRecord(entry) && typeof entry.command === "string" && OFFING_CURSOR_HOOK_COMMAND.test(entry.command),
  );
}

const CURSOR_HOOK_SPEC: HookJson = {
  event: "afterFileEdit",
  versioned: true,
  entry: { command: CURSOR_HOOK_COMMAND, timeout: 60 },
};

/**
 * Merges the `afterFileEdit` entry into a parsed Cursor hooks document, keeping every existing key and hook.
 * Cursor's project file is `.cursor/hooks.json` with top-level `version` and a flat command list per event
 * (<https://cursor.com/docs/hooks>, checked 2026-11-07).
 */
export function withCursorAfterFileEdit(document: unknown): {
  document: Record<string, unknown>;
  change: "added" | "unchanged";
} {
  if (!isRecord(document))
    throw new AgentFileError(`${CURSOR_HOOKS_FILE} does not hold a JSON object, so it was not changed.`);
  const hooksValue = document.hooks;
  if (hooksValue !== undefined && !isRecord(hooksValue)) {
    throw new AgentFileError(`${CURSOR_HOOKS_FILE} has a "hooks" value that is not an object, so it was not changed.`);
  }
  const events: Record<string, unknown> = hooksValue === undefined ? {} : hooksValue;
  const afterValue = events.afterFileEdit;
  if (afterValue !== undefined && !Array.isArray(afterValue)) {
    throw new AgentFileError(
      `${CURSOR_HOOKS_FILE} has a "hooks.afterFileEdit" value that is not an array, so it was not changed.`,
    );
  }
  const afterFileEdit: unknown[] = afterValue === undefined ? [] : afterValue.map((entry: unknown) => entry);
  if (hasOffingAfterFileEdit(afterFileEdit)) return { document: structuredClone(document), change: "unchanged" };
  const entry = CURSOR_HOOK_SPEC.entry;
  return {
    document: {
      ...structuredClone(document),
      version: typeof document.version === "number" ? document.version : 1,
      hooks: { ...events, afterFileEdit: [...afterFileEdit, entry] },
    },
    change: "added",
  };
}

/**
 * Writes or merges the Cursor post-edit hook into `.cursor/hooks.json` and keeps `.cursor/rules/offing.mdc`.
 * Cursor's `afterFileEdit` cannot return text to the agent, so the always-applied rule is the instruction path;
 * the hook itself only audits to stderr. The home directory is never touched.
 */
export async function initCursorHooks(options: InitCursorHooksOptions): Promise<InitCursorHooksResult> {
  const hooks = await initJsonHook(options, CURSOR_HOOKS_FILE, CURSOR_HOOK_SPEC, withCursorAfterFileEdit, {
    event: "preToolUse",
    entry: { ...CURSOR_HOOK_SPEC.entry, matcher: "Write|Edit|StrReplace" },
  });
  const rule = options.remove
    ? { file: CURSOR_RULES_FILE, change: "unchanged" as const, written: false, diff: "" }
    : await updateAgentFile(resolve(options.root), CURSOR_RULES_FILE, {
        createPrefix: CURSOR_RULE_PREFIX,
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      });
  return { hooks, rule };
}

export const GEMINI_SETTINGS_FILE = ".gemini/settings.json";
export const GEMINI_HOOK_MATCHER = "write_file|replace";
/** The same launcher as the other hosts: the project's own package first, the global `offing` bin as fallback. */
export const GEMINI_HOOK_COMMAND = "npx --no-install offing hook gemini";
/** Gemini CLI measures hook timeouts in milliseconds, so this is the documented default of one minute. */
export const GEMINI_HOOK_TIMEOUT_MS = 60_000;

export type InitGeminiHooksOptions = InitClaudeHooksOptions;
export type InitGeminiHooksResult = InitClaudeHooksResult;

/** Recognizes the Gemini CLI hook this command wrote, however its launcher is spelled. */
const OFFING_GEMINI_HOOK_COMMAND = /\boffing(?:-deprecation)?\b.*\bhook\s+gemini\b/;

function hasOffingGeminiAfterTool(entries: readonly unknown[]): boolean {
  return entries.some((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) return false;
    return entry.hooks.some(
      (hook) => isRecord(hook) && typeof hook.command === "string" && OFFING_GEMINI_HOOK_COMMAND.test(hook.command),
    );
  });
}

const GEMINI_HOOK_SPEC: HookJson = {
  event: "AfterTool",
  entry: {
    matcher: GEMINI_HOOK_MATCHER,
    hooks: [{ name: "offing", type: "command", command: GEMINI_HOOK_COMMAND, timeout: GEMINI_HOOK_TIMEOUT_MS }],
  },
};

/**
 * Merges the `AfterTool` entry into a parsed Gemini CLI settings document, keeping every existing setting and
 * hook. Gemini CLI reads the project file `.gemini/settings.json` with `hooks.<Event>` arrays of
 * `{ matcher, hooks }` entries, and matchers are regular expressions
 * (<https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md>, Gemini CLI 0.67.0, 2026-11-04).
 */
export function withGeminiAfterTool(settings: unknown): {
  settings: Record<string, unknown>;
  change: "added" | "unchanged";
} {
  if (!isRecord(settings))
    throw new AgentFileError(`${GEMINI_SETTINGS_FILE} does not hold a JSON object, so it was not changed.`);
  const hooksValue = settings.hooks;
  if (hooksValue !== undefined && !isRecord(hooksValue)) {
    throw new AgentFileError(
      `${GEMINI_SETTINGS_FILE} has a "hooks" value that is not an object, so it was not changed.`,
    );
  }
  const hooks: Record<string, unknown> = hooksValue === undefined ? {} : hooksValue;
  const afterValue = hooks.AfterTool;
  if (afterValue !== undefined && !Array.isArray(afterValue)) {
    throw new AgentFileError(
      `${GEMINI_SETTINGS_FILE} has a "hooks.AfterTool" value that is not an array, so it was not changed.`,
    );
  }
  const afterTool = (afterValue ?? []) as unknown[];
  if (hasOffingGeminiAfterTool(afterTool)) return { settings: structuredClone(settings), change: "unchanged" };
  const entry = GEMINI_HOOK_SPEC.entry;
  return {
    settings: {
      ...structuredClone(settings),
      hooks: { ...hooks, AfterTool: [...structuredClone(afterTool), entry] },
    },
    change: "added",
  };
}

/**
 * Writes or merges the Gemini CLI post-edit hook into `.gemini/settings.json`, preserving the user's settings
 * and hooks. The home directory is never touched.
 */
export async function initGeminiHooks(options: InitGeminiHooksOptions): Promise<InitGeminiHooksResult> {
  return initJsonHook(options, GEMINI_SETTINGS_FILE, GEMINI_HOOK_SPEC, withGeminiAfterTool);
}

export const COPILOT_HOOKS_FILE = ".github/hooks/offing.json";
export const COPILOT_HOOK_MATCHER = "create|edit";
/** The same launcher as the other hosts: the project's own package first, the global `offing` bin as fallback. */
export const COPILOT_HOOK_COMMAND = "npx --no-install offing hook copilot";
/** Copilot measures hook timeouts in seconds, so this is a minute, matching the other hosts. */
export const COPILOT_HOOK_TIMEOUT_SEC = 60;

export type InitCopilotHooksOptions = InitClaudeHooksOptions;
export type InitCopilotHooksResult = InitClaudeHooksResult;

/** Recognizes a Copilot hook this command wrote, however its launcher is spelled and whichever command field holds it. */
const OFFING_COPILOT_HOOK_COMMAND = /\boffing(?:-deprecation)?\b.*\bhook\s+copilot\b/;

function isOffingCopilotEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  return [entry.command, entry.bash, entry.powershell].some(
    (command) => typeof command === "string" && OFFING_COPILOT_HOOK_COMMAND.test(command),
  );
}

const COPILOT_HOOK_SPEC: HookJson = {
  event: "postToolUse",
  versioned: true,
  entry: {
    type: "command",
    matcher: COPILOT_HOOK_MATCHER,
    command: COPILOT_HOOK_COMMAND,
    timeoutSec: COPILOT_HOOK_TIMEOUT_SEC,
  },
};

/**
 * Merges the `postToolUse` entry into a parsed Copilot hooks document, keeping every existing key and hook.
 * Copilot reads every `.github/hooks/*.json` file with `version: 1` and `hooks.<event>` arrays of command
 * hooks, and matches `postToolUse` against the runtime tool name
 * (<https://docs.github.com/en/copilot/reference/hooks-reference>, Copilot CLI 1.0.107, 2026-11-07).
 */
export function withCopilotPostToolUse(document: unknown): {
  document: Record<string, unknown>;
  change: "added" | "unchanged";
} {
  if (!isRecord(document))
    throw new AgentFileError(`${COPILOT_HOOKS_FILE} does not hold a JSON object, so it was not changed.`);
  if (document.version !== undefined && document.version !== 1)
    throw new AgentFileError(`${COPILOT_HOOKS_FILE} has a "version" value other than 1, so it was not changed.`);
  const hooksValue = document.hooks;
  if (hooksValue !== undefined && !isRecord(hooksValue)) {
    throw new AgentFileError(`${COPILOT_HOOKS_FILE} has a "hooks" value that is not an object, so it was not changed.`);
  }
  const hooks: Record<string, unknown> = hooksValue === undefined ? {} : hooksValue;
  const postValue = hooks.postToolUse;
  if (postValue !== undefined && !Array.isArray(postValue)) {
    throw new AgentFileError(
      `${COPILOT_HOOKS_FILE} has a "hooks.postToolUse" value that is not an array, so it was not changed.`,
    );
  }
  const postToolUse = (postValue ?? []) as unknown[];
  if (postToolUse.some(isOffingCopilotEntry)) return { document: structuredClone(document), change: "unchanged" };
  const entry = COPILOT_HOOK_SPEC.entry;
  return {
    document: {
      ...structuredClone(document),
      version: document.version ?? 1,
      hooks: { ...hooks, postToolUse: [...structuredClone(postToolUse), entry] },
    },
    change: "added",
  };
}

/**
 * Writes or merges the Copilot post-edit hook into `.github/hooks/offing.json`, preserving the user's hooks.
 * The repo-level file is the one Copilot CLI and Copilot in the cloud both load; the instruction file that
 * `offing setup` writes stays untouched.
 */
export async function initCopilotHooks(options: InitCopilotHooksOptions): Promise<InitCopilotHooksResult> {
  return initJsonHook(options, COPILOT_HOOKS_FILE, COPILOT_HOOK_SPEC, withCopilotPostToolUse);
}

export const CLINE_HOOKS_FILE = ".clinerules/hooks/PostToolUse";
/** The same launcher as the other hosts: the project's own package first, the global `offing` bin as fallback. */
export const CLINE_HOOK_COMMAND = "npx --no-install offing hook cline";
/** Cline reads one executable file per event through its shebang, so the configuration is the script itself. */
export const CLINE_HOOK_SCRIPT = `#!/usr/bin/env bash\n# Offing checks the file Cline's PostToolUse payload names; it only prints and never edits files.\nexec ${CLINE_HOOK_COMMAND}\n`;

export type InitClineHooksOptions = InitClaudeHooksOptions;
export type InitClineHooksResult = InitClaudeHooksResult;

/**
 * Writes Cline's project-level `PostToolUse` file hook at `.clinerules/hooks/PostToolUse`, the workspace
 * location the VS Code extension documents
 * (<https://github.com/cline/cline/blob/main/.clinerules/hooks/README.md>, checked 2026-11-08 against Cline
 * 4.1.26, current stable, 2026-10-26). Cline keeps one file per event, not a list of entries, so a file Offing
 * did not write is left untouched.
 */
export async function initClineHooks(options: InitClineHooksOptions): Promise<InitClineHooksResult> {
  const noOp = "#!/usr/bin/env bash\n";
  return hookFileResult(
    options,
    CLINE_HOOKS_FILE,
    (before) => {
      if (options.remove) return before === CLINE_HOOK_SCRIPT ? noOp : before;
      if (before !== undefined && before !== noOp && before !== CLINE_HOOK_SCRIPT)
        throw new AgentFileError(
          `${CLINE_HOOKS_FILE} already holds a hook Offing did not write, so it was not changed. Add "${CLINE_HOOK_COMMAND}" to it yourself.`,
        );
      return CLINE_HOOK_SCRIPT;
    },
    0o755,
  );
}

export const DEVIN_HOOKS_FILE = ".devin/hooks.v1.json";
export const DEVIN_HOOK_MATCHER = "^(write|edit|apply_patch)$";
/** The same launcher as the other hosts: the project's own package first, the global `offing` bin as fallback. */
export const DEVIN_HOOK_COMMAND = "npx --no-install offing hook devin";
/** Devin measures hook timeouts in seconds, so this is a minute, matching the other hosts. */
export const DEVIN_HOOK_TIMEOUT_SEC = 60;

export type InitDevinHooksOptions = InitClaudeHooksOptions;
export type InitDevinHooksResult = InitClaudeHooksResult;

/** Recognizes the Devin Local hook this command wrote, however its launcher is spelled. */
const OFFING_DEVIN_HOOK_COMMAND = /\boffing(?:-deprecation)?\b.*\bhook\s+devin\b/;

function hasOffingDevinPostToolUse(entries: readonly unknown[]): boolean {
  return entries.some((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) return false;
    return entry.hooks.some(
      (hook) => isRecord(hook) && typeof hook.command === "string" && OFFING_DEVIN_HOOK_COMMAND.test(hook.command),
    );
  });
}

const DEVIN_HOOK_SPEC: HookJson = {
  event: "PostToolUse",
  wrapped: false,
  entry: {
    matcher: DEVIN_HOOK_MATCHER,
    hooks: [{ type: "command", command: DEVIN_HOOK_COMMAND, timeout: DEVIN_HOOK_TIMEOUT_SEC }],
  },
};

/**
 * Merges the `PostToolUse` entry into a parsed Devin hooks document. In `.devin/hooks.v1.json` the hooks object
 * is the entire file (no wrapper key), with `PostToolUse` arrays of `{ matcher, hooks }` entries
 * (<https://docs.devin.ai/cli/extensibility/hooks/overview.md>, checked 2026-11-08).
 */
export function withDevinPostToolUse(document: unknown): {
  document: Record<string, unknown>;
  change: "added" | "unchanged";
} {
  if (!isRecord(document))
    throw new AgentFileError(`${DEVIN_HOOKS_FILE} does not hold a JSON object, so it was not changed.`);
  const postValue = document.PostToolUse;
  if (postValue !== undefined && !Array.isArray(postValue)) {
    throw new AgentFileError(
      `${DEVIN_HOOKS_FILE} has a "PostToolUse" value that is not an array, so it was not changed.`,
    );
  }
  const postToolUse = (postValue ?? []) as unknown[];
  if (hasOffingDevinPostToolUse(postToolUse)) return { document: structuredClone(document), change: "unchanged" };
  const entry = DEVIN_HOOK_SPEC.entry;
  return {
    document: { ...structuredClone(document), PostToolUse: [...structuredClone(postToolUse), entry] },
    change: "added",
  };
}

/**
 * Writes or merges the Devin Local post-edit hook into `.devin/hooks.v1.json`, preserving the user's other
 * events and hooks. The home directory is never touched.
 */
export async function initDevinHooks(options: InitDevinHooksOptions): Promise<InitDevinHooksResult> {
  return initJsonHook(options, DEVIN_HOOKS_FILE, DEVIN_HOOK_SPEC, withDevinPostToolUse);
}

export async function initAgents(options: InitAgentsOptions): Promise<InitAgentsResult> {
  const root = resolve(options.root);
  const info = await lstat(root).catch(() => undefined);
  if (!info?.isDirectory()) throw new AgentFileError(`${root} is not a directory.`);

  let file: AgentFileName;
  if (options.file) file = options.file;
  else if ((await read(join(root, "AGENTS.md"))) !== undefined) file = "AGENTS.md";
  else if ((await read(join(root, "CLAUDE.md"))) !== undefined) file = "CLAUDE.md";
  else file = "AGENTS.md";

  return updateAgentFile(root, file, options.dryRun === undefined ? {} : { dryRun: options.dryRun });
}

import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { checkSnippet, MAX_SNIPPET_CONTENT_BYTES, snippetInputProblem } from "../check-snippet.js";
import type { Finding } from "../domain.js";
import { relativePosix } from "../paths.js";
import { codexFeedbackText } from "./codex.js";
import { failOpen } from "./index.js";
import { pendingPatches, previewPatch } from "./pending-patch.js";
import type { HookResponse } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function inside(root: string, target: string): boolean {
  const path = relativePosix(root, target);
  return path !== "" && path !== ".." && !path.startsWith("../") && !isAbsolute(path);
}

/** Validate the target and each existing ancestor before reading a pending edit's original. */
async function targetPath(root: string, file: unknown): Promise<string | undefined> {
  if (typeof file !== "string" || !file) return undefined;
  const target = resolve(root, file);
  if (!inside(root, target)) return undefined;
  for (let candidate = target; candidate !== root; candidate = dirname(candidate)) {
    const info = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (info) {
      const actual = await realpath(candidate);
      const actualRoot = await realpath(root);
      if (actual !== actualRoot && !inside(actualRoot, actual)) return undefined;
      break;
    }
  }
  return target;
}

async function originalContent(path: string): Promise<string | undefined> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_SNIPPET_CONTENT_BYTES) return undefined;
    const buffer = Buffer.alloc(info.size + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return bytesRead === info.size ? buffer.toString("utf8", 0, bytesRead) : undefined;
  } finally {
    await file.close();
  }
}

function replaceAllWithinLimit(text: string, old: string, replacement: string, first: number): string | undefined {
  let size = text.length;
  for (let at = first; at !== -1; at = text.indexOf(old, at + old.length)) {
    size += replacement.length - old.length;
    if (size > MAX_SNIPPET_CONTENT_BYTES) return undefined;
  }
  return text.replaceAll(old, () => replacement);
}

function previewEdit(original: string, input: Record<string, unknown>): string | undefined {
  let content: string | undefined = original;
  const edits: unknown[] = Array.isArray(input.edits) ? input.edits : [input];
  for (const edit of edits) {
    const change = record(edit);
    const old = change?.old_string;
    const replacement = change?.new_string;
    if (typeof old !== "string" || !old || typeof replacement !== "string") return undefined;
    const at = content.indexOf(old);
    if (at === -1) return undefined;
    content =
      change?.replace_all === true
        ? replaceAllWithinLimit(content, old, replacement, at)
        : content.slice(0, at) + replacement + content.slice(at + old.length);
    if (content === undefined) return undefined;
    if (Buffer.byteLength(content) > MAX_SNIPPET_CONTENT_BYTES) return undefined;
  }
  return content;
}

interface PendingFile {
  path: string;
  content: string;
}

async function patchFiles(root: string, command: string): Promise<PendingFile[]> {
  const files: PendingFile[] = [];
  for (const patch of pendingPatches(command)) {
    const target = await targetPath(root, patch.path);
    const destination = patch.moveTo ? await targetPath(root, patch.moveTo) : target;
    if (!target || !destination) continue;
    const original = patch.add ? "" : await originalContent(target).catch(() => undefined);
    if (original === undefined) continue;
    const content = previewPatch(patch, original);
    if (content !== undefined) files.push({ path: relativePosix(root, destination), content });
  }
  return files;
}

async function pendingFiles(
  root: string,
  host: string,
  tool: unknown,
  input: Record<string, unknown>,
): Promise<PendingFile[]> {
  if (host === "codex" && tool === "apply_patch" && typeof input.command === "string") {
    return patchFiles(root, input.command);
  }
  if (tool !== "Write" && tool !== "Edit" && tool !== "MultiEdit" && tool !== "StrReplace") return [];
  const target = await targetPath(root, input.file_path);
  if (!target) return [];
  const path = relativePosix(root, target);
  if (typeof input.content === "string") return [{ path, content: input.content }];
  const original = await originalContent(target);
  if (original === undefined) return [];
  const content = previewEdit(original, input);
  return content === undefined ? [] : [{ path, content }];
}

async function proposedFindings(host: string, payload: unknown, env: NodeJS.ProcessEnv): Promise<Finding[]> {
  const event = record(payload);
  const input = record(event?.tool_input);
  const fallback =
    host === "cursor" ? env.CURSOR_PROJECT_DIR : host === "codex" ? env.CODEX_PROJECT_DIR : env.CLAUDE_PROJECT_DIR;
  const workspaceRoots: unknown[] = Array.isArray(event?.workspace_roots) ? event.workspace_roots : [];
  const cwd = event?.cwd ?? workspaceRoots[0] ?? fallback;
  if (typeof cwd !== "string" || !isAbsolute(cwd) || !input) return [];
  const root = resolve(cwd);
  const findings: Finding[] = [];
  for (const { path, content } of await pendingFiles(root, host, event?.tool_name, input)) {
    if (snippetInputProblem(path, content)) continue;
    const result = await checkSnippet({ path, content });
    for (const { replacement, ...finding } of result.findings) {
      findings.push(replacement === null ? finding : { ...finding, replacement });
    }
  }
  return findings;
}

export async function preWriteResponse(
  host: string,
  payload: unknown,
  env: NodeJS.ProcessEnv,
  gate: (findings: readonly Finding[]) => Finding[],
): Promise<HookResponse> {
  const findings = gate(await proposedFindings(host, payload, env));
  if (!findings.length) return failOpen;
  const reason = codexFeedbackText(findings);
  if (host === "cursor") {
    return { ...failOpen, stdout: `${JSON.stringify({ permission: "deny", agent_message: reason })}\n` };
  }
  return { ...failOpen, stderr: `${reason}\n`, exitCode: 2 };
}

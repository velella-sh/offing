import { defineCodemod } from "./kit/define.js";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { patchFor } from "./codemods/shared/edits.js";
import type { Edit } from "./codemods/shared/edits.js";
import { isSetupRuntimeFinding, setupRuntimePlanner } from "./codemods/shared/setup-runtime.js";
import type { Finding, ScanResult } from "../domain.js";
import type { FilePatch, Refuse } from "./types.js";

/** `actions/checkout@v5 or later`: the only replacement wording that names an exact action and major version. */
const ACTION_REPLACEMENT = /^([a-z0-9._-]+\/[a-z0-9._/-]+)@v(\d+) or later$/i;
const USES_LINE = /^(\s*(?:-\s*)?uses\s*:\s*["']?)([^\s#"']+)(.*)$/;
const TAG_REF = /^v?(\d+)(?:\.\d+){0,2}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

interface ActionEdit {
  action: string;
  major: number;
}

interface Targets {
  lines: Map<number, ActionEdit>;
  findings: Finding[];
  runtimes: Finding[];
}

function collectTargets(result: ScanResult, refuse: Refuse | undefined): Map<string, Targets> {
  const targets = new Map<string, Targets>();
  for (const finding of result.findings) {
    const path = finding.location.path;
    if (!path.startsWith(".github/workflows/")) continue;
    const entry: Targets = targets.get(path) ?? { lines: new Map(), findings: [], runtimes: [] };
    if (isSetupRuntimeFinding(finding)) {
      entry.runtimes.push(finding);
      targets.set(path, entry);
      continue;
    }
    if (!isActionRule(finding.ruleId)) continue;
    if (finding.location.line === undefined) {
      refuse?.(finding, "The finding names no line to rewrite.");
      continue;
    }
    const edit = actionEdit(finding);
    if (!edit) {
      refuse?.(finding, "The rule's replacement does not name an action and a major version.");
      continue;
    }
    entry.lines.set(finding.location.line, edit);
    entry.findings.push(finding);
    targets.set(path, entry);
  }
  return targets;
}

/** Rewrites `uses: owner/action@vN` to the major version the rule names. SHA-pinned and floating references are left alone. */
export const githubActionsUsesFixer = defineCodemod({
  id: "github-actions-uses",
  rules: ["github-actions.*", "nodejs.runtime.*", "python.runtime.*"],
  async plan(result, refuse) {
    const targets = collectTargets(result, refuse);
    const planRuntime = setupRuntimePlanner(result);

    const patches: FilePatch[] = [];
    for (const [path, { lines, findings, runtimes }] of [...targets].sort(([a], [b]) => a.localeCompare(b))) {
      const decline = (reason: string) => {
        for (const finding of [...findings, ...runtimes]) refuse?.(finding, reason);
      };
      const absolute = resolve(result.root, path);
      const inside = relative(resolve(result.root), absolute);
      if (inside.startsWith("..") || isAbsolute(inside)) {
        decline("The path resolves outside the repository.");
        continue;
      }
      const before = await readFile(absolute, "utf8").catch(() => undefined);
      if (before === undefined) {
        decline("The workflow file could not be read.");
        continue;
      }
      if (!before.endsWith("\n")) {
        decline("The workflow file does not end with a newline.");
        continue;
      }
      const runtimeEdits = await planRuntime(before, runtimes, refuse);
      const original = before.split("\n");
      const updated = original.map((line, index) => {
        const edit = lines.get(index + 1);
        return edit ? bumpAction(line, edit.action, edit.major) : line;
      });
      const patch = patchFor(
        path,
        before,
        [...runtimeEdits, ...actionEdits(original, updated)],
        runtimeEdits.length > 0,
      );
      if (patch) patches.push(patch);
      for (const finding of findings) {
        const reason = refusalFor(finding, original, updated, lines);
        if (reason !== undefined) refuse?.(finding, reason);
      }
    }
    return patches;
  },
});

function actionEdits(original: string[], updated: string[]): Edit[] {
  let offset = 0;
  return original.flatMap((line, index) => {
    const start = offset;
    offset += line.length + 1;
    const replacement = updated[index];
    return replacement !== undefined && replacement !== line ? [{ start, end: start + line.length, replacement }] : [];
  });
}

function actionEdit(finding: Finding): ActionEdit | undefined {
  if (finding.location.line === undefined || !finding.location.path.startsWith(".github/workflows/")) return undefined;
  const match = ACTION_REPLACEMENT.exec(finding.replacement ?? "");
  const action = match?.[1];
  const major = match?.[2];
  return action === undefined || major === undefined
    ? undefined
    : { action: action.toLowerCase(), major: Number(major) };
}

function bumpAction(line: string, action: string, major: number): string {
  const match = USES_LINE.exec(line);
  const target = match?.[2];
  if (!match || target === undefined) return line;
  const separator = target.lastIndexOf("@");
  if (separator <= 0 || target.slice(0, separator).toLowerCase() !== action) return line;
  const current = TAG_REF.exec(target.slice(separator + 1));
  if (!current || Number(current[1]) >= major) return line;
  return `${match[1]}${target.slice(0, separator)}@v${major}${match[3]}`;
}

/** The refusal for a finding whose line the edit left unchanged, or undefined when there is nothing to report. */
function refusalFor(
  finding: Finding,
  original: readonly string[],
  updated: readonly string[],
  lines: ReadonlyMap<number, ActionEdit>,
): string | undefined {
  const line = finding.location.line;
  if (line === undefined) return undefined;
  const edit = lines.get(line);
  if (edit === undefined) return undefined;
  const index = line - 1;
  return updated[index] === original[index] ? refusalReason(original[index], edit) : undefined;
}

/** Why the line still holds the reference the finding named, or undefined when there was nothing left to raise. */
function refusalReason(line: string | undefined, edit: ActionEdit): string | undefined {
  if (line === undefined) return "The finding names no line to rewrite.";
  const match = USES_LINE.exec(line);
  const target = match?.[2];
  if (!match || target === undefined) return "The line is not a `uses:` reference.";
  const separator = target.lastIndexOf("@");
  if (separator <= 0 || target.slice(0, separator).toLowerCase() !== edit.action)
    return "The line names a different action than the rule.";
  const reference = target.slice(separator + 1);
  if (COMMIT_SHA.test(reference)) return "The reference is pinned to a commit SHA, not a major-version tag.";
  const current = TAG_REF.exec(reference);
  if (!current) return "The reference is not a version tag; a branch or floating reference is left alone.";
  if (Number(current[1]) >= edit.major) return undefined;
  return "The reference did not match the action on its line.";
}

function isActionRule(id: string): boolean {
  return id.startsWith("github-actions.") && !id.startsWith("github-actions.workflow-command.");
}

import { renderDiff } from "../../../agent-instructions.js";
import type { FilePatch, FixerPatch } from "../../types.js";

/** One replacement of a source range, by character offsets. */
export interface Edit {
  start: number;
  end: number;
  replacement: string;
}

/** Applies edits from the end of the file backwards so earlier offsets stay valid; same-start edits apply shortest first. */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  let text = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start || left.end - right.end)) {
    text = `${text.slice(0, edit.start)}${edit.replacement}${text.slice(edit.end)}`;
  }
  return text;
}

/** The patch that turns `before` into `after`, or undefined when the text is unchanged. */
export function diffFor(path: string, before: string, after: string): FilePatch | undefined {
  if (after === before) return undefined;
  // renderDiff treats the text after the last newline as a line; dropping the newline keeps git apply from seeing a phantom one.
  return { path, diff: renderDiff(path, before.slice(0, -1), after.slice(0, -1)) };
}

interface PatchSource {
  before: string;
  edits: readonly Edit[];
  combine: boolean;
}

const sources = new WeakMap<FixerPatch | FilePatch, PatchSource>();

/** The patch for a file whose edits changed it, with its exact edited spans available to the planner. */
export function patchFor(path: string, before: string, edits: readonly Edit[], combine = false): FilePatch | undefined {
  const patch = edits.length === 0 ? undefined : diffFor(path, before, applyEdits(before, edits));
  if (patch) rememberPatchEdits(patch, before, edits, combine);
  return patch;
}

export function rememberPatchEdits(patch: FilePatch, before: string, edits: readonly Edit[], combine = false): void {
  sources.set(patch, { before, edits, combine });
}

export function labelPatch(patch: FilePatch, fixer: string): FixerPatch {
  const labeled = { ...patch, fixer };
  const source = sources.get(patch);
  if (source) sources.set(labeled, source);
  return labeled;
}

/** Coalesce the marked migrations on a shared file before their unified-diff context can overlap. */
export function composePatches(patches: FixerPatch[]): FixerPatch[] {
  const groups = new Map<string, FixerPatch[]>();
  for (const patch of patches) {
    const group = groups.get(patch.path) ?? [];
    group.push(patch);
    groups.set(patch.path, group);
  }
  return [...groups].flatMap(([path, group]) => combineGroup(path, group));
}

function combineGroup(path: string, group: FixerPatch[]): FixerPatch[] {
  const source = group.flatMap((patch) => {
    const details = sources.get(patch);
    return details ? [details] : [];
  });
  const first = source[0];
  const fixer = group[0]?.fixer;
  if (!first || !fixer || source.length !== group.length || group.length < 2) return group;
  if (source.some(({ before }) => before !== first.before) || !source.some(({ combine }) => combine)) return group;
  const changes = source
    .flatMap(({ edits }) => edits)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let after = "";
  let cursor = 0;
  for (const { start, end, replacement } of changes) {
    if (cursor > start) return group;
    after += first.before.slice(cursor, start) + replacement;
    cursor = end;
  }
  const patch = diffFor(path, first.before, after + first.before.slice(cursor));
  return patch ? [{ ...patch, fixer }] : group;
}

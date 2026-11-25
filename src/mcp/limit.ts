import { type JsonObject, resolvePointer } from "./output-schema.js";

/** The most a tool answer may cost a model, in estimated tokens. */
export const MAX_TOOL_TOKENS = 2000;
/** Characters of JSON text per estimated token. Shorter than the usual four, so dense JSON stays under the cap. */
const CHARS_PER_TOKEN = 3;
/** A text longer than this is shortened before any list is cut. */
const LONG_STRING_CHARS = 600;
/** The shortest a text is still shortened to when an answer stays over the cap. */
const MIN_STRING_CHARS = 24;
/** A list that costs at most this share of the cap is restored before any longer list. */
const SMALL_LIST_SHARE = 0.25;
/** Ends every shortened text, so a reader can tell it continues. */
export const TRUNCATION_MARKER = " …[truncated]";
/** The fields an agent acts on directly. They are never shortened, whatever their size. */
const PROTECTED_KEYS = new Set(["status", "replacement"]);

/** One array in an answer that may lose elements, and the fewest its published schema lets it keep. */
interface ListSlot {
  /** The live array: the kept elements, in the order the full answer has them. */
  items: unknown[];
  original: unknown[];
  /** Tokens of the whole array as the answer gave it. It is taken before anything is cut, and never changes. */
  size: number;
  /** Indices of `original` in the order they are kept: the most severe first when elements carry a severity. */
  ranking: number[];
  kept: Set<number>;
  minimum: number;
  /** Where the array sits, with every index replaced by `[]`, such as `findings[].migration.steps`. */
  pattern: string;
  /** The array whose element holds this one; absent for an array at the top of the answer. */
  parent?: ListSlot;
  /** The element of `parent` that holds this array. */
  parentIndex: number;
}

/** One array pattern that lost elements: how many are in the answer and how many the full answer has. */
interface Omission {
  path: string;
  shown: number;
  total: number;
}

/** What was left out of an answer to keep it under the cap, and where to read the rest. */
export interface MorePointer {
  truncated: true;
  hint: string;
  omitted: Omission[];
  clipped?: string[];
  /** Size of the answer as returned, by the same estimate that applies the cap. */
  estimatedTokens: number;
}

interface LimitState {
  answer: Record<string, unknown>;
  slots: ListSlot[];
  hint: string;
  clipped: Set<string>;
}

/** Tokens in the JSON text an agent reads, estimated at `CHARS_PER_TOKEN` characters each. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The JSON text a tool returns beside its structured content. */
export const serialized = (value: unknown): string => JSON.stringify(value, null, 2);

/**
 * Shortens `text` to about `limit` characters and marks the cut. A text with lines is cut after its last whole
 * line, so a table never keeps half a row; a single line is cut after its last word.
 */
export function clipText(text: string, limit: number): string {
  const base = text.endsWith(TRUNCATION_MARKER) ? text.slice(0, -TRUNCATION_MARKER.length) : text;
  if (base.length <= limit) return text;
  const head = base.slice(0, limit);
  const breakAt = head.includes("\n") ? head.lastIndexOf("\n") : head.lastIndexOf(" ");
  return `${(breakAt > limit / 2 ? head.slice(0, breakAt) : head).trimEnd()}${TRUNCATION_MARKER}`;
}

/** An object that is not an array or `null`, as the JSON text of an answer holds it. */
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An array, typed as unknown elements rather than the `any[]` `Array.isArray` infers. */
const isList = (value: unknown): value is unknown[] => Array.isArray(value);

/** Shortens, in place, every text over `limit` except the protected fields; `clipped` collects where. */
function clipStrings(node: unknown, limit: number, path: string, clipped: Set<string>): void {
  if (isList(node)) {
    const at = `${path}[]`;
    node.forEach((element: unknown, index: number) => {
      if (typeof element !== "string") clipStrings(element, limit, at, clipped);
      else if (element.length > limit) {
        node[index] = clipText(element, limit);
        clipped.add(at);
      }
    });
    return;
  }
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const at = path ? `${path}.${key}` : key;
    if (typeof value !== "string") clipStrings(value, limit, at, clipped);
    else if (value.length > limit && !PROTECTED_KEYS.has(key)) {
      node[key] = clipText(value, limit);
      clipped.add(at);
    }
  }
}

/** The schema for a node: its own keywords over the target of a reference inside the same document. */
function localSchema(schema: unknown, document: Record<string, unknown>): unknown {
  if (!isObject(schema) || typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) return schema;
  const keywords = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$ref"));
  const target = resolvePointer(document, schema.$ref.slice(1));
  // A reference that does not resolve is left alone: its arrays are then not cut, which keeps the answer valid.
  return isObject(target) ? { ...target, ...keywords } : schema;
}

/** The severity levels an array's elements may take, in the schema's order from the mildest to the most severe. */
function severityLevels(elementSchema: unknown): unknown[] {
  const properties = isObject(elementSchema) ? elementSchema.properties : undefined;
  const severity = isObject(properties) ? properties.severity : undefined;
  return isObject(severity) && isList(severity.enum) ? severity.enum : [];
}

/**
 * Element indices in the order they are kept. An array whose elements carry a `severity` keeps its most severe
 * elements first, so a cut list of findings keeps what matters; every other array keeps the order it was written in.
 */
function rankingOf(original: readonly unknown[], elementSchema: unknown): number[] {
  const rankOf = new Map<unknown, number>();
  severityLevels(elementSchema).forEach((level, rank) => rankOf.set(level, rank));
  const rank = (element: unknown): number => (isObject(element) ? (rankOf.get(element.severity) ?? -1) : -1);
  return original
    .map((_, index) => index)
    .sort((left, right) => rank(original[right]) - rank(original[left]) || left - right);
}

/** Every array the schema declares in `answer`, in document order, each with the arrays above it already listed. */
function listSlots(answer: Record<string, unknown>, schema: Record<string, unknown>): ListSlot[] {
  const slots: ListSlot[] = [];
  const visit = (node: unknown, at: unknown, path: string, above?: ListSlot, index = 0): void => {
    const resolved = localSchema(at, schema);
    if (!isObject(resolved)) return;
    if (isList(node)) {
      // Only an array the schema declares is cut, so the shortened answer still validates.
      if (resolved.type !== "array") return;
      const ranking = rankingOf(node, resolved.items);
      const slot: ListSlot = {
        items: node,
        original: [...node],
        size: estimateTokens(JSON.stringify(node)),
        ranking,
        kept: new Set(ranking),
        minimum: typeof resolved.minItems === "number" ? resolved.minItems : 0,
        pattern: path,
        parentIndex: index,
        ...(above ? { parent: above } : {}),
      };
      slots.push(slot);
      node.forEach((element, position) => visit(element, resolved.items, `${path}[]`, slot, position));
      return;
    }
    if (!isObject(node)) return;
    const properties = isObject(resolved.properties) ? resolved.properties : {};
    for (const [key, value] of Object.entries(node)) {
      visit(value, properties[key], path ? `${path}.${key}` : key, above, index);
    }
  };
  visit(answer, schema, "");
  return slots;
}

/** Rewrites the live array from the kept elements. */
function sync(slot: ListSlot): void {
  slot.items.length = 0;
  slot.original.forEach((element, index) => {
    if (slot.kept.has(index)) slot.items.push(element);
  });
}

/** Whether every array above this one still shows the element that holds it. */
function visible(slot: ListSlot): boolean {
  for (let node: ListSlot | undefined = slot; node?.parent !== undefined; node = node.parent) {
    if (!node.parent.kept.has(node.parentIndex)) return false;
  }
  return true;
}

function insideElement(candidate: ListSlot, list: ListSlot, index: number): boolean {
  for (let node = candidate; node.parent !== undefined; node = node.parent) {
    if (node.parent === list && node.parentIndex === index) return true;
  }
  return false;
}

/** The fewest elements an array may keep. */
const fewest = (slot: ListSlot): Set<number> => new Set(slot.ranking.slice(0, slot.minimum));

/** Whether `ancestor` is one of the arrays above `slot`, at any depth. */
function hasAncestor(slot: ListSlot, ancestor: ListSlot): boolean {
  for (let node: ListSlot | undefined = slot; node?.parent !== undefined; node = node.parent) {
    if (node.parent === ancestor) return true;
  }
  return false;
}

/** Cuts an array back to the fewest elements its schema lets it keep, and every array inside it with it. */
function floor(slot: ListSlot, slots: readonly ListSlot[]): void {
  for (const nested of slots) {
    if (nested === slot || hasAncestor(nested, slot)) nested.kept = fewest(nested);
  }
  for (const nested of slots) sync(nested);
}

/** The elements of an array when the element holding it is shown: all of them, or the fewest it may keep. */
const nestedKeep = (nested: ListSlot, whole: boolean): Set<number> =>
  new Set(whole ? nested.ranking : nested.ranking.slice(0, nested.minimum));

/** Puts element `index` back, with the arrays inside it full or cut to their minimum. */
function restoreElement(slots: readonly ListSlot[], list: ListSlot, index: number, whole: boolean): void {
  list.kept.add(index);
  for (const nested of slots) {
    if (!insideElement(nested, list, index)) continue;
    nested.kept = nestedKeep(nested, whole);
    sync(nested);
  }
  sync(list);
}

/** The next element to keep, or undefined when the array shows all of them. */
function nextElement(slot: ListSlot): number | undefined {
  return slot.ranking.find((index) => !slot.kept.has(index));
}

/** Every array pattern that lost elements, with how many elements the answer shows and the full answer has. */
function omissions(slots: readonly ListSlot[]): Omission[] {
  const totals = new Map<string, Omission>();
  for (const slot of slots) {
    const entry = totals.get(slot.pattern) ?? { path: slot.pattern, shown: 0, total: 0 };
    entry.total += slot.original.length;
    if (visible(slot)) entry.shown += slot.kept.size;
    totals.set(slot.pattern, entry);
  }
  return [...totals.values()].filter(({ shown, total }) => shown < total);
}

/** Rewrites the pointer from the answer as it is now. */
function writeMore(state: LimitState, estimatedTokens: number): void {
  state.answer.more = {
    truncated: true,
    hint: state.hint,
    omitted: omissions(state.slots),
    ...(state.clipped.size > 0 ? { clipped: [...state.clipped] } : {}),
    estimatedTokens,
  };
}

/** Whether the answer with its pointer fits; the four-digit placeholder keeps the number's width while fitting. */
function fits(state: LimitState): boolean {
  writeMore(state, 9999);
  return estimateTokens(serialized(state.answer)) <= MAX_TOOL_TOKENS;
}

/**
 * Writes the pointer with the answer's own size. The size stands in for a placeholder of the same width or wider,
 * and is measured again when writing it changed the width, so it is the size of the answer as returned.
 */
function measure(state: LimitState): void {
  let tokens = 9999;
  for (let pass = 0; pass < 3; pass += 1) {
    const measured = estimateTokens(serialized(state.answer));
    if (measured === tokens) return;
    tokens = measured;
    writeMore(state, measured);
  }
}

/**
 * Every array shows its first element before any array grows, so no list loses its start to another one. An
 * element that wraps a long list would otherwise take most of the cap here, whole, and leave nothing for the
 * lists after it. The arrays inside the first element stay at their minimum; `restoreWholeLists` brings them
 * back in the same order as any other array.
 */
function keepFirstElements(state: LimitState): void {
  for (const slot of state.slots) {
    const first = slot.ranking[0];
    if (first === undefined || !visible(slot)) continue;
    restoreElement(state.slots, slot, first, false);
    if (!fits(state)) floor(slot, state.slots);
  }
}

/**
 * Short lists come first, because restoring one whole costs little. Then the longer lists of objects, then the
 * longer lists of plain values: a finding is worth more than a file path. The size is the one taken before the cut.
 */
function priority(slot: ListSlot): number {
  const objects = slot.original[0] !== null && typeof slot.original[0] === "object";
  return slot.size <= MAX_TOOL_TOKENS * SMALL_LIST_SHARE ? 0 : objects ? 1 : 2;
}

/**
 * Arrays still missing elements, in the order they are restored: by priority, and inside one priority as the answer
 * lists them, which is the order the tool chose for what matters.
 */
function restorationOrder(slots: readonly ListSlot[]): ListSlot[] {
  // `sort` is stable, so the arrays of one priority keep the order of `slots`, which is the answer's own.
  return slots
    .filter((slot) => visible(slot) && slot.kept.size < slot.original.length)
    .sort((left, right) => priority(left) - priority(right));
}

/** Restores whole elements, most important array first, until the next element would not fit whole. */
function restoreWholeLists(state: LimitState): void {
  for (const slot of restorationOrder(state.slots)) {
    // An array that could not show even its first element stays as it is.
    if (slot.kept.size === 0) continue;
    for (let next = nextElement(slot); next !== undefined; next = nextElement(slot)) {
      restoreElement(state.slots, slot, next, true);
      if (fits(state)) continue;
      // The element does not fit whole and it is not the first, so the array stops before it.
      slot.kept.delete(next);
      sync(slot);
      break;
    }
  }
}

/**
 * Keeps one tool answer under `MAX_TOOL_TOKENS` by cutting it in place, so it still validates against the schema
 * the tool advertises. Only three things go: elements from an array, the elements' own texts with them, and texts
 * too long to fit. `status` and `replacement` are never touched. When anything was cut, the answer ends with a
 * `more` pointer that counts what is missing and says where to read it. An answer inside the cap is not changed.
 *
 * An element of an array comes back whole, with every array inside it, or not at all, so a finding never appears
 * with part of its migration steps. The first element of each array is the one exception: it is shown before any
 * array grows, with the arrays inside it still cut, and those come back in the same order as every other array.
 * So a list always shows what it starts with, and the first element is the one that can end up with arrays cut.
 * Elements are kept most severe first when they carry a severity, and stay in the order the full answer has them.
 *
 * An answer can still be over the cap only when a `status` or `replacement` is itself longer than the cap. Those
 * are never cut, and the pointer then reports the answer's true size.
 */
export function limitToolAnswer(answer: Record<string, unknown>, schema: JsonObject, hint: string): void {
  if (estimateTokens(serialized(answer)) <= MAX_TOOL_TOKENS) return;

  // Long texts go first, so each array is measured at the size it will be fitted at.
  const clipped = new Set<string>();
  clipStrings(answer, LONG_STRING_CHARS, "", clipped);
  const state: LimitState = { answer, slots: listSlots(answer, schema), hint, clipped };
  for (const slot of state.slots) slot.kept = fewest(slot);
  for (const slot of state.slots) sync(slot);

  keepFirstElements(state);
  restoreWholeLists(state);
  // Only an answer whose fixed part alone is too long, such as echoed input, gets here.
  for (let limit = LONG_STRING_CHARS / 2; !fits(state) && limit >= MIN_STRING_CHARS; limit /= 2) {
    clipStrings(answer, Math.floor(limit), "", state.clipped);
  }
  measure(state);
}

import { isMap, isNode, isScalar, isSeq, parseDocument, type Node } from "yaml";
import { isDeepStrictEqual } from "node:util";

import { AgentFileError } from "../agent-instructions.js";

type Collection = Extract<Node, { items: unknown[] }>;
type ObjectValue = Record<string, unknown>;

interface Item {
  readonly start: number;
  readonly end: number;
  readonly node: Node;
}

/** Use the flow-collection source ranges for edits, after the caller validates the text as JSON. */
function items(collection: Collection): Item[] {
  if (isMap(collection)) {
    return collection.items.flatMap(({ key, value }) =>
      isNode(key) && key.range && isNode(value) && value.range
        ? [{ start: key.range[0], end: value.range[1], node: value }]
        : [],
    );
  }
  return collection.items.flatMap((node) =>
    isNode(node) && node.range ? [{ start: node.range[0], end: node.range[1], node }] : [],
  );
}

function field(collection: Collection, key: string): Item | undefined {
  if (!isMap(collection)) return undefined;
  const pair = collection.items.find((item) => isScalar(item.key) && item.key.value === key);
  return items(collection).find(({ node }) => node === pair?.value);
}

function tree(text: string): Collection {
  const doc = parseDocument(text, { schema: "failsafe", prettyErrors: false });
  if (!isMap(doc.contents) || doc.errors.length > 0)
    throw new AgentFileError("Could not locate the hooks in the JSON config, so it was not changed.");
  return doc.contents;
}

function append(text: string, parent: Collection, fragment: string): string {
  const last = items(parent).at(-1);
  const offset = last?.end ?? (parent.range?.[0] ?? 0) + 1;
  return text.slice(0, offset) + (last ? "," : "") + "\n  " + fragment + text.slice(offset);
}

function omit(text: string, parent: Collection, item: Item): string {
  const siblings = items(parent);
  const index = siblings.findIndex(({ start }) => item.start === start);
  const previous = siblings[index - 1];
  const next = siblings[index + 1];
  if (previous) return text.slice(0, previous.end) + text.slice(item.end);
  if (next) return text.slice(0, item.start) + text.slice(next.start);
  const opening = (parent.range?.[0] ?? 0) + 1;
  const start = text.slice(opening, item.start) === "\n  " ? opening : item.start;
  return text.slice(0, start) + text.slice(item.end);
}

export interface HookJson {
  readonly event: string;
  readonly wrapped?: false;
  readonly versioned?: true;
  readonly entry: ObjectValue;
}

function property(key: string, value: unknown): string {
  return `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
}

function eventValue(spec: HookJson): ObjectValue {
  return { [spec.event]: [spec.entry] };
}

function eventCollection(root: Collection, spec: HookJson): Collection | undefined {
  if (spec.wrapped === false) return root;
  const node = field(root, "hooks")?.node;
  return isMap(node) ? node : undefined;
}

function insertEntry(text: string, spec: HookJson): string {
  const root = tree(text);
  const config = eventCollection(root, spec);
  const list = config && field(config, spec.event)?.node;
  if (isSeq(list)) return append(text, list, JSON.stringify(spec.entry));
  if (config) return append(text, config, property(spec.event, [spec.entry]));
  return append(text, root, property("hooks", eventValue(spec)));
}

// This layout identifies a version added alongside the hook, even if the original config was compact.
const addedVersion = '"version" : 1';

export function insertHook(text: string, spec: HookJson): string {
  const updated = insertEntry(text, spec);
  if (!spec.versioned) return updated;
  const root = tree(updated);
  return field(root, "version") ? updated : append(updated, root, addedVersion);
}

function matches(text: string, item: Item, entry: ObjectValue): boolean {
  const value: unknown = JSON.parse(text.slice(item.start, item.end));
  const legacy = JSON.stringify(entry).replace('"command":"offing hook ', '"command":"npx --no-install offing hook ');
  return isDeepStrictEqual(value, entry) || isDeepStrictEqual(value, JSON.parse(legacy));
}

/** Remove an exact managed entry. Compact containers created with it can be removed as a unit. */
function removeEntry(text: string, spec: HookJson): string {
  const root = tree(text);
  const config = eventCollection(root, spec);
  if (!config) return text;
  const event = field(config, spec.event);
  if (!event || !isSeq(event.node)) return text;
  const wrapper = field(root, "hooks");
  if (
    spec.wrapped !== false &&
    wrapper &&
    text.slice(wrapper.start, wrapper.end) === property("hooks", eventValue(spec))
  )
    return omit(text, root, wrapper);
  if (text.slice(event.start, event.end) === property(spec.event, [spec.entry])) return omit(text, config, event);
  const entry = items(event.node).find((item) => matches(text, item, spec.entry));
  return entry ? omit(text, event.node, entry) : text;
}

export function removeHook(text: string, spec: HookJson): string {
  const updated = removeEntry(text, spec);
  if (updated === text || !spec.versioned) return updated;
  const root = tree(updated);
  const version = field(root, "version");
  return version && updated.slice(version.start, version.end) === addedVersion ? omit(updated, root, version) : updated;
}

interface FilePatch {
  path: string;
  moveTo?: string;
  add: boolean;
  body: string[];
}

/** Read Codex file sections without invoking a patch tool or touching the working tree. */
export function pendingPatches(command: string): FilePatch[] {
  const lines = command.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch") return [];
  const patches: FilePatch[] = [];
  let patch: FilePatch | undefined;
  for (const line of lines) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header?.[2]) {
      patch = header[1] === "Delete" ? undefined : { path: header[2], add: header[1] === "Add", body: [] };
      if (patch) patches.push(patch);
    } else if (patch && line.startsWith("*** Move to: ")) {
      patch.moveTo = line.slice("*** Move to: ".length);
    } else {
      patch?.body.push(line);
    }
  }
  return patches;
}

function findSequence(lines: readonly string[], expected: readonly string[], start: number): number {
  for (let index = start; index <= lines.length - expected.length; index++) {
    if (expected.every((line, offset) => lines[index + offset] === line)) return index;
  }
  return -1;
}

interface Hunk {
  anchor: string;
  old: string[];
  next: string[];
  end: boolean;
}

function readHunks(body: readonly string[]): Hunk[] | undefined {
  const hunks: Hunk[] = [];
  let hunk = { anchor: "", old: [] as string[], next: [] as string[], end: false };
  for (const line of body) {
    const marker = line[0];
    if (line.startsWith("@@")) {
      if (hunk.old.length || hunk.next.length) hunks.push(hunk);
      hunk = { anchor: line.slice(2).trimStart(), old: [], next: [], end: false };
    } else if (line === "*** End of File") {
      hunk.end = true;
    } else if (marker === " " || marker === "+" || marker === "-") {
      if (marker !== "+") hunk.old.push(line.slice(1));
      if (marker !== "-") hunk.next.push(line.slice(1));
    } else return undefined;
  }
  if (hunk.old.length || hunk.next.length) hunks.push(hunk);
  return hunks;
}

export function previewPatch(patch: FilePatch, original: string): string | undefined {
  if (patch.add) {
    return patch.body.every((line) => line.startsWith("+"))
      ? patch.body.map((line) => line.slice(1)).join("\n") + "\n"
      : undefined;
  }
  const hunks = readHunks(patch.body);
  if (!hunks) return undefined;
  const lines = original.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const result: string[] = [];
  let start = 0;
  for (const hunk of hunks) {
    const anchor = hunk.anchor ? lines.indexOf(hunk.anchor, start) + 1 : start;
    if (hunk.anchor && anchor === 0) return undefined;
    const at = findSequence(lines, hunk.old, hunk.end ? Math.max(anchor, lines.length - hunk.old.length) : anchor);
    if (at < 0) return undefined;
    for (let index = start; index < at; index++) result.push(lines[index] ?? "");
    for (const line of hunk.next) result.push(line);
    start = at + hunk.old.length;
  }
  return [...result, ...lines.slice(start)].join("\n") + "\n";
}

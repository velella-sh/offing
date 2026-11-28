import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type CaptionFile = { tape: string; output: string };

const range = /^(\d{2}:[0-5]\d:[0-5]\d,\d{3}) --> (\d{2}:[0-5]\d:[0-5]\d,\d{3})$/u;

export function renderTapeCaptions(tape: string): string {
  const [, ...annotations] = tape.split(/^# Caption /mu);
  if (!annotations.length) throw new Error("No caption cues are annotated in the tape.");
  let previousEnd = "";
  const cues = annotations.map((annotation, index) => {
    const [timing = "", ...rows] = annotation.split("\n");
    const match = range.exec(timing);
    const [, start, end] = match ?? [];
    const text = [];
    for (const row of rows) {
      if (!row.startsWith("# | ")) break;
      text.push(row.slice(4));
    }
    if (!start || !end || start < previousEnd || start >= end || !text.length || text.some((line) => !line.trim())) {
      throw new Error(`Invalid caption cue ${index + 1}.`);
    }
    previousEnd = end;
    return [String(index + 1), timing, ...text].join("\n");
  });
  return cues.join("\n\n") + "\n";
}

async function expectedCaption(root: string, path: string): Promise<string> {
  try {
    return renderTapeCaptions(await readFile(resolve(root, path), "utf8"));
  } catch (error) {
    throw new Error(`Could not render captions from ${path}.`, { cause: error });
  }
}

export async function writeDemoCaptions(root: string, files: CaptionFile[]): Promise<void> {
  for (const { tape, output } of files) {
    await writeFile(resolve(root, output), await expectedCaption(root, tape));
  }
}

export async function checkDemoCaptions(root: string, files: CaptionFile[]): Promise<void> {
  for (const { tape, output } of files) {
    const actual = await readFile(resolve(root, output), "utf8").catch(() => "");
    if (actual !== (await expectedCaption(root, tape))) {
      throw new Error(`Demo captions do not match ${tape}: ${output}.`);
    }
  }
}

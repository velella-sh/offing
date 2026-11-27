import { stat } from "node:fs/promises";
import process from "node:process";
import { parseArgs } from "node:util";

import { loadImageRules } from "../detectors/container/image-lifecycle.js";
import { buildImageLineage } from "../lineage/index.js";
import { readLineageInputs } from "../lineage/inputs.js";
import { renderLineageMermaid, renderLineageText } from "../lineage/render.js";
import type { CliCommand, CommandContext } from "./types.js";

const options = {
  json: { type: "boolean" },
  format: { type: "string" },
  "resolve-digests": { type: "boolean" },
} as const;
const usage = "  offing lineage [path] [--json | --format mermaid] [--resolve-digests]   # trace container base images";

async function run(args: string[], ctx: CommandContext): Promise<number> {
  const parsed = (() => {
    try {
      return parseArgs({ args, options, allowPositionals: true });
    } catch {
      return undefined;
    }
  })();
  if (!parsed || parsed.positionals.length > 1) return ctx.fail("usage", usage.trim());
  const {
    values,
    positionals: [path = "."],
  } = parsed;
  const format = values.format ?? (values.json ? "json" : "text");
  if ((values.json && values.format) || !["text", "json", "mermaid"].includes(format)) {
    return ctx.fail("usage", "Choose one lineage format: text, json, or mermaid.");
  }
  const directory = await stat(path).catch(() => undefined);
  if (!directory?.isDirectory()) return ctx.fail("usage", "The lineage path must be a readable repository directory.");

  const [inputs, rules] = await Promise.all([readLineageInputs(path), loadImageRules()]);
  let result = buildImageLineage([inputs], rules);
  if (values["resolve-digests"]) {
    const { resolveLineageDigests } = await import("../lineage/registry.js");
    const tags = await resolveLineageDigests(result);
    if (tags.size > 0) result = buildImageLineage([inputs], rules, tags);
  }
  const output =
    format === "json"
      ? JSON.stringify(result, null, 2)
      : format === "mermaid"
        ? renderLineageMermaid(result)
        : renderLineageText(result);
  process.stdout.write(`${output}\n`);
  return 0;
}

export const command: CliCommand = {
  name: "lineage",
  flags: Object.keys(options).map((key) => `--${key}`),
  example: "offing lineage . --format mermaid",
  usage: [usage],
  run,
};

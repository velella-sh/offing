import { basename } from "node:path";

import { ACTION_RUNTIME_TARGET, actionRuntime } from "../../detectors/github-actions-runtime.js";
import { defineCodemod } from "../kit/define.js";
import { patchFor } from "./shared/edits.js";
import { readRepositoryFile } from "./shared/source.js";

export const actionRuntimeFixer = defineCodemod({
  id: "action-runtime",
  rules: [{ id: "nodejs.runtime.legacy", detector: "github-actions" }],
  async plan(result, refuse) {
    const patches = [];
    for (const finding of result.findings) {
      const { path, line } = finding.location;
      if (!/^action\.ya?ml$/i.test(basename(path)) || finding.replacement !== ACTION_RUNTIME_TARGET) continue;
      const file = await readRepositoryFile(result.root, path, "action metadata");
      if ("reason" in file) {
        refuse?.(finding, file.reason);
        continue;
      }
      const runtime = actionRuntime(file.text);
      const range = runtime?.node.range;
      if (!runtime || !range || runtime.line !== line || runtime.node.anchor || runtime.node.tag) {
        refuse?.(finding, "The runs.using entry is not an unambiguous literal JavaScript runtime.");
        continue;
      }
      const [start, end] = range;
      const raw = file.text.slice(start, end);
      const next = raw.replace(runtime.node.value, ACTION_RUNTIME_TARGET);
      if (next === raw) {
        refuse?.(finding, "The runs.using entry uses a quoted escape or multiline syntax.");
        continue;
      }
      const patch = patchFor(path, file.text, [{ start, end, replacement: next }]);
      if (patch) patches.push(patch);
    }
    return patches;
  },
});

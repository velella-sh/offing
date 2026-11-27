// Deterministic sample agent: apply a patch the user has already reviewed.
import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";

const patch = process.argv[2];
if (!process.env.OFFING_MIGRATION_PROMPT_FILE || !patch || !isAbsolute(patch)) {
  console.error("Use as an Offing agent command with an absolute path to a reviewed patch.");
  process.exitCode = 2;
} else {
  const result = spawnSync("git", ["apply", "--", patch], { stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}

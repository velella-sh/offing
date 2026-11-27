import type { Capability } from "../schema.js";

const migrationExecute: Capability = {
  id: "migration.execute",
  status: "experimental",
  version: "1",
  description: "Run an explicitly supplied local migration agent in an isolated Git worktree.",
  ecosystems: [],
};

export default migrationExecute;

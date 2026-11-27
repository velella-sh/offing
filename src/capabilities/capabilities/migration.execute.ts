import type { Capability } from "../schema.js";

const migrationExecute: Capability = {
  id: "migration.execute",
  status: "supported",
  version: "1",
  description: "Run an approved recorded migration with pinned container tests in an isolated Git worktree.",
  ecosystems: [],
};

export default migrationExecute;

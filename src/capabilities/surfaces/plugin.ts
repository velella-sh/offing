import { workflowCapabilityIds } from "../constants.js";
import type { CapabilitySurface } from "../schema.js";

const plugin: CapabilitySurface = {
  id: "plugin",
  kind: "plugin",
  status: "experimental",
  version: "0",
  entryPoints: ["offing mcp", "skills/offing/SKILL.md"],
  capabilityIds: [...workflowCapabilityIds],
};

export default plugin;

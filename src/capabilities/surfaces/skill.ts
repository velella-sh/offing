import { workflowCapabilityIds } from "../constants.js";
import type { CapabilitySurface } from "../schema.js";

const skill: CapabilitySurface = {
  id: "skill",
  kind: "skill",
  status: "supported",
  version: "1",
  entryPoints: ["skills/offing/SKILL.md"],
  capabilityIds: [...workflowCapabilityIds],
};

export default skill;

import type { CapabilitySurface } from "../schema.js";
import { VERSION } from "../../version.js";

const ciGitlab: CapabilitySurface = {
  id: "ci.gitlab",
  kind: "ci",
  status: "experimental",
  version: VERSION,
  entryPoints: ["offing"],
  capabilityIds: ["repository.scan", "environment.doctor"],
};

export default ciGitlab;

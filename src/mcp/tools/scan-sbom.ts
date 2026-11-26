import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { scanSbomFile } from "../../sbom-scan.js";
import { failure, registerMcpTool, repositoryInput, success } from "../tool-support.js";

export function registerScanSbom(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "scan_sbom",
    title: "Scan SBOM",
    description:
      "Call when you have a local SBOM file and need lifecycle findings for its components, with JSON Pointer locations. Reads CycloneDX, SPDX or Syft JSON offline and returns offing.scan.v1.",
    inputSchema: z.object({
      ...repositoryInput,
      sbom_path: z
        .string()
        .min(1)
        .refine((path) => path !== "-", "A local SBOM file is required.")
        .describe("Path to a local JSON SBOM file."),
    }),
    async handler(_context, { sbom_path, repository_path }) {
      try {
        return success(await scanSbomFile(sbom_path, repository_path));
      } catch (error) {
        return failure(error);
      }
    },
  });
}

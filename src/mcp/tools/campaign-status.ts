import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { readCampaignState } from "../../campaign/document.js";
import { failure, registerMcpTool, success } from "../tool-support.js";

export function registerCampaignStatus(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "campaign_status",
    title: "Read campaign status",
    description:
      "Call when you need campaign status from a saved state file. Validates offing.campaign-state.v1 and returns the pinned repositories, batch assignments, phase history and omissions without editing the file.",
    inputSchema: z.object({
      state_path: z.string().min(1).describe("Local path to a saved campaign state JSON file."),
    }),
    async handler(_context, { state_path }) {
      try {
        return success(await readCampaignState(state_path));
      } catch (error) {
        return failure(error);
      }
    },
  });
}

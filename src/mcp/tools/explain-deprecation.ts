import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { failure, findingInput, registerMcpTool, success } from "../tool-support.js";

/** Registers `explain_deprecation`: one complete finding from a fresh scan. */
export function registerExplainDeprecation(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "explain_deprecation",
    title: "Explain deprecation",
    description:
      "Call when a scan or list has given you a finding id and you need its evidence before changing code: what is affected, where it is used, the replacement and deadline when a rule gives them, and the authoritative sources. Runs a fresh local scan with no network. Returns one complete finding.",
    inputSchema: z.object(findingInput),
    async handler(context, { finding_id, repository_path }) {
      try {
        const result = await context.tools.explain(finding_id, repository_path);
        context.server.sendResourceListChanged();
        return success(result);
      } catch (error) {
        return failure(error);
      }
    },
  });
}

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { failure, registerMcpTool, repositoryInput, success } from "../tool-support.js";

/** Registers `list_deprecations`: a compact list of the findings a fresh scan returns. */
export function registerListDeprecations(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "list_deprecations",
    title: "List deprecations",
    description:
      "Call when you need an overview of a repository's lifecycle findings before planning a change: one entry per finding with its id, rule, severity, and location. Runs a fresh local scan with no network. Returns offing.deprecations.v1. Pass an id to explain_deprecation for the full evidence.",
    inputSchema: z.object(repositoryInput),
    async handler(context, { repository_path }) {
      try {
        const result = await context.tools.list(repository_path);
        context.server.sendResourceListChanged();
        return success(result);
      } catch (error) {
        return failure(error);
      }
    },
  });
}

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { failure, registerMcpTool, repositoryInput, success } from "../tool-support.js";

export function registerImageLineage(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "image_lineage",
    title: "Trace container image lineage",
    description:
      "Call when you need to trace which container bases or build stages a Dockerfile, Compose service, or dev container uses. Reads only local files and returns offing.lineage.v1 with exact file and line evidence, reviewed lifecycle matches, and unresolved references.",
    inputSchema: z.object(repositoryInput),
    async handler(context, { repository_path }) {
      try {
        return success(await context.tools.imageLineage(repository_path));
      } catch (error) {
        return failure(error);
      }
    },
  });
}

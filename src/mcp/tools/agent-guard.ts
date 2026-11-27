import { fromJsonSchema, type JsonSchemaType, type McpServer } from "@modelcontextprotocol/server";

import { checkAgentGuard } from "../../agent-guard.js";
import { agentGuardRequestSchema, parseAgentGuardRequest } from "../../agent-guard-request.js";
import { toolOutputSchema } from "../output-schema.js";
import { MCP_TOOL_ANNOTATIONS } from "../tool-names.js";
import { failure, success } from "../tool-support.js";

export function registerAgentGuard(server: McpServer): void {
  server.registerTool(
    "agent_guard",
    {
      title: "Agent Guard protocol",
      description:
        "Call when you need a protocol v1 guard verdict for a proposed operation. Returns an allow, warn, or block decision and its evidence.",
      inputSchema: fromJsonSchema(agentGuardRequestSchema() as JsonSchemaType),
      outputSchema: fromJsonSchema(toolOutputSchema("agent_guard") as JsonSchemaType),
      annotations: MCP_TOOL_ANNOTATIONS,
    },
    async (input) => {
      try {
        return success(await checkAgentGuard(parseAgentGuardRequest(input)));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

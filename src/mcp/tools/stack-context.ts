import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { readStackContext } from "../../stack-context-local.js";
import { serialized } from "../limit.js";
import { failure, registerMcpTool, repositoryInput, success } from "../tool-support.js";

const stackContextUri = "offing://stack/context";
const description =
  "Call when starting a coding session to read stack context with observed runtime pins, reviewed support dates, and packages or APIs to avoid. Use scan_repository for the complete dependency scan.";

export function registerStackContext(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "stack_context",
    title: "Stack context",
    description,
    inputSchema: z.object(repositoryInput),
    async handler(_context, { repository_path }) {
      try {
        return success(await readStackContext(repository_path));
      } catch (error) {
        return failure(error);
      }
    },
  });
  server.registerResource(
    "stack-context",
    stackContextUri,
    {
      title: "Stack context",
      description: `${description} Uses the server's working directory.`,
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: serialized(await readStackContext(".")) }],
    }),
  );
}

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { checkSnippet } from "../../check-snippet.js";
import { failure, registerMcpTool, success } from "../tool-support.js";

/** Registers `check_snippet`: one intended file, checked in an isolated temporary directory. */
export function registerCheckSnippet(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "check_snippet",
    title: "Check snippet",
    description:
      "Check proposed file contents for lifecycle issues before writing them. Pass the intended repository-relative path and the exact content. Supports Node.js and Python API usage, GitHub Actions, Kubernetes, and other built-in detectors that can read one file in isolation. Findings include the snippet location, evidence, and the reviewed replacement when available.",
    inputSchema: z.object({
      path: z
        .string()
        .min(1)
        .describe(
          "The intended repository-relative path, for example Dockerfile, .github/workflows/ci.yml, or package.json. It decides which detector reads the snippet.",
        ),
      content: z.string().min(1).describe("The exact content the agent intends to write."),
    }),
    async handler(_context, { path, content }) {
      try {
        return success(await checkSnippet({ path, content }));
      } catch (error) {
        return failure(error);
      }
    },
  });
}

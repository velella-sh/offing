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
      "Call before you write a file: a package manifest, Dockerfile, CI workflow, Kubernetes manifest, or Node.js or Python code that calls an API. Pass the intended repository-relative path and the exact content. Returns offing.check-snippet.v1: each finding with its line, the flagged code, the replacement when one is reviewed, and a source. Reads no repository.",
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

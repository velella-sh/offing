import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { estimateTokens, MAX_TOOL_TOKENS } from "../limit.js";
import type { OffingAgentTools } from "../../agent-tools.js";
import { renderReceiptMarkdown } from "../../receipt-markdown.js";
import { renderVerifyResultArtifactBlock } from "../../verify-result.js";
import { failure, findingInput, registerMcpTool, success } from "../tool-support.js";

/** Registers `verify_migration`: whether a finding observed earlier is gone after a fresh scan. */
export function registerVerifyMigration(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "verify_migration",
    title: "Verify migration",
    description:
      "Call when you have changed code to resolve a finding and need to confirm it is gone. Re-scans the repository locally, with no network, and checks the finding observed earlier in this session. Returns offing.verification.v1 with verified, the findings a fresh scan still reports, and suggested commands, which are never run.",
    inputSchema: z.object(findingInput),
    async handler(context, { finding_id, repository_path }) {
      try {
        const result = await context.tools.verify(finding_id, repository_path);
        context.server.sendResourceListChanged();
        if (result.verifyResult && estimateTokens(JSON.stringify(result, null, 2)) > MAX_TOOL_TOKENS) {
          const legacy = { ...result };
          delete legacy.verifyResult;
          if (legacy.receipt)
            legacy.receipt_markdown = `${renderReceiptMarkdown(legacy.receipt)}\n${renderVerifyResultArtifactBlock()}`;
          return success({ ...legacy, verifyResultUnavailable: "tool-size-limit" });
        }
        return success(result);
      } catch (error) {
        return failure(error);
      }
    },
  });
}

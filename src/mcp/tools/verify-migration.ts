import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { renderReceiptMarkdown } from "../../receipt-markdown.js";
import { renderVerifyResultArtifactBlock } from "../../verify-result.js";
import { estimateTokens, MAX_TOOL_TOKENS, serialized } from "../limit.js";
import { failure, findingInput, registerMcpTool, success } from "../tool-support.js";

const fits = (value: object): boolean => estimateTokens(serialized(value)) <= MAX_TOOL_TOKENS;

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
        if (!result.verifyResult || !result.receipt || fits(result)) return success(result);
        const summary = renderReceiptMarkdown(result.receipt);
        const compact = { ...result, receipt_markdown: `${summary}\n${renderVerifyResultArtifactBlock()}` };
        if (fits(compact)) return success(compact);
        delete compact.verifyResult;
        return success({ ...compact, receipt_markdown: summary, verifyResultUnavailable: "tool-size-limit" });
      } catch (error) {
        return failure(error);
      }
    },
  });
}

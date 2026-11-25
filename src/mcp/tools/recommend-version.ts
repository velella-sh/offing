import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { DEFAULT_MINIMUM_SUPPORT_DAYS, recommendVersion } from "../../recommend.js";
import { failure, registerMcpTool, success } from "../tool-support.js";

/** Registers `recommend_version`: which release line to write today, from the bundled lifecycle data only. */
export function registerRecommendVersion(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "recommend_version",
    title: "Recommend version",
    description:
      "Call before you write a version into a Dockerfile, CI workflow, or manifest and want a line that stays supported. Returns offing.recommend.v1: the recommended line with its end date, alternatives, lines to avoid, and sources, from bundled lifecycle data only; it never says 'latest'. no-data means no data for the product, not that a version is safe.",
    inputSchema: z.object({
      product: z
        .string()
        .min(1)
        .describe("A product name as lookup accepts it (node, python, postgres) or a Package URL without a version."),
      minimumSupportDays: z
        .number()
        .int()
        .min(0)
        .default(DEFAULT_MINIMUM_SUPPORT_DAYS)
        .describe("Days a release line must stay supported to qualify. Defaults to 180."),
      as_of: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Date the answer is for, YYYY-MM-DD. Defaults to today (UTC); set it for a repeatable answer."),
    }),
    async handler(_context, { product, minimumSupportDays, as_of }) {
      try {
        return success(
          await recommendVersion({
            name: product,
            minimumSupportDays,
            ...(as_of === undefined ? {} : { asOf: as_of }),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  });
}

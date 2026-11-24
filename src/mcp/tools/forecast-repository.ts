import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { DEFAULT_FORECAST_MONTHS, MAX_FORECAST_MONTHS } from "@velella/ebb/forecast";
import { isIsoDate } from "@velella/ebb/registry";
import { failure, registerMcpTool, repositoryInput, success } from "../tool-support.js";

/** Registers `forecast_repository`: what reaches a dated end of life in the coming months. */
export function registerForecastRepository(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "forecast_repository",
    title: "Forecast repository",
    description:
      "Call when you plan a roadmap or upgrade schedule and need to know what reaches end of life first. Runs a fresh local scan, with no network. Returns ebb.forecast.v1: buckets by months left (0-3, 3-6, 6-12) with the events that affect this repository, then the same events by month. Only dated events are listed; nothing is estimated.",
    inputSchema: z.object({
      ...repositoryInput,
      months: z
        .number()
        .int()
        .min(1)
        .max(MAX_FORECAST_MONTHS)
        .default(DEFAULT_FORECAST_MONTHS)
        .describe(
          `How many months ahead to look, from 1 to ${MAX_FORECAST_MONTHS}. Defaults to ${DEFAULT_FORECAST_MONTHS}.`,
        ),
      as_of: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "as_of must be a date (YYYY-MM-DD).")
        .refine(isIsoDate, "as_of must be a date (YYYY-MM-DD).")
        .optional()
        .describe("The day to start the window from, as YYYY-MM-DD. Defaults to today in UTC."),
    }),
    async handler(context, { repository_path, months, as_of }) {
      try {
        const result = await context.tools.forecast(repository_path, months, as_of);
        context.server.sendResourceListChanged();
        return success(result);
      } catch (error) {
        return failure(error);
      }
    },
  });
}

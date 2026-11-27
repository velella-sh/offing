import type { McpServer } from "@modelcontextprotocol/server";
import { MAX_FORECAST_MONTHS } from "@velella/ebb/forecast";
import * as z from "zod/v4";
import type { OffingAgentTools } from "../../agent-tools.js";
import { simulateRepository } from "../../what-if/index.js";
import { simulationTargets } from "../../what-if/target.js";
import { failure, registerMcpTool, repositoryInput, success } from "../tool-support.js";

export function registerSimulateUpgrade(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "simulate_upgrade",
    title: "Simulate runtime upgrade",
    description:
      "Call before you compare proposed runtime targets. Simulate each upgrade independently. Returns static blockers, literal pins and projected lifecycle deadlines from local evidence, without changing files or running builds.",
    inputSchema: z.object({
      ...repositoryInput,
      targets: z.array(z.string().min(1)).min(1).max(8).describe("Runtime versions such as nodejs@22 or python@3.13."),
      months: z.number().int().min(1).max(MAX_FORECAST_MONTHS).optional(),
      as_of: z.string().optional().describe("Start day in YYYY-MM-DD. Defaults to today in UTC."),
      effort: z.boolean().optional().describe("Include deterministic, assisted and manual effort evidence."),
    }),
    async handler(_context, { repository_path, targets, months, as_of, effort }) {
      try {
        return success(
          await simulateRepository(repository_path, simulationTargets(targets), {
            ...(months === undefined ? {} : { months }),
            ...(as_of === undefined ? {} : { asOf: as_of }),
            ...(effort === undefined ? {} : { effort }),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  });
}

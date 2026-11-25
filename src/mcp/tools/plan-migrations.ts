import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { buildPlan } from "../../plan-build.js";
import { failure, registerMcpTool, repositoryInput, success } from "../tool-support.js";

/** Registers `plan_migrations`: a migration plan of waves a coordinating agent can hand out. */
export function registerPlanMigrations(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "plan_migrations",
    title: "Plan migrations",
    description:
      "Call when several findings must be fixed and you are splitting the work across tasks or agents. Runs a fresh local scan, with no network. Returns offing.plan.v1: one item per finding with the paths it touches and a suggested branch, and waves in which no two items touch the same path, so they can run in parallel.",
    inputSchema: z.object(repositoryInput),
    async handler(context, { repository_path }) {
      try {
        const result = await context.tools.scan(repository_path);
        context.server.sendResourceListChanged();
        return success(buildPlan(result));
      } catch (error) {
        return failure(error);
      }
    },
  });
}

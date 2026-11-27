import type { McpServer } from "@modelcontextprotocol/server";
import { resolve } from "node:path";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { OffingError } from "../../offing-error.js";
import { buildBlockerGraph } from "../../upgrade/graph.js";
import { checkUpgrade, parseUpgradeTarget } from "../../upgrade/index.js";
import { failure, registerMcpTool, success } from "../tool-support.js";

/** Registers `check_upgrade`: whether the repository can move to a target runtime. */
export function registerCheckUpgrade(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "check_upgrade",
    title: "Check upgrade",
    description:
      "Call before you upgrade to a runtime, such as php@8.4 or nodejs@22. Reads the lockfiles and manifests in the repository; runs nothing, uses no network. Returns offing.upgrade.v1: the verdict and every blocker, warning, and unknown with its path, line, and constraint. An unknown verdict means no evidence was found; it is not a statement that the upgrade is safe.",
    inputSchema: z.object({
      path: z
        .string()
        .min(1)
        .default(".")
        .describe("Local path to the repository. Defaults to the server working directory."),
      target: z
        .string()
        .min(1)
        .describe("Runtime and release to move to, as runtime@version, for example php@8.4 or nodejs@22."),
    }),
    async handler(_context, { path, target }) {
      try {
        const parsed = parseUpgradeTarget(target);
        if (!parsed)
          return failure(
            new OffingError(
              "invalid-argument",
              `target must be <runtime>@<version>, for example php@8.4 (got "${target}").`,
            ),
          );
        const report = await checkUpgrade(resolve(path), parsed);
        return success({ ...report, graph: await buildBlockerGraph(report) });
      } catch (error) {
        return failure(error);
      }
    },
  });
}

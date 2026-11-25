import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../../agent-tools.js";
import { checkDependency } from "../../check-dependency.js";
import { failure, registerMcpTool, success } from "../tool-support.js";

/** Registers `check_dependency`: one package, and optionally one version, against the lifecycle rules. */
export function registerCheckDependency(server: McpServer, tools: OffingAgentTools): void {
  registerMcpTool(server, tools, {
    name: "check_dependency",
    title: "Check dependency",
    description:
      "Call before you install, add, or pick a package or GitHub Action. Pass a Package URL such as pkg:npm/request@2.88.2 or pkg:github/actions/checkout@v4. Returns offing.check.v1 with replacement first when one is known, then status: affected, version-dependent, not-affected, or no-data. no-data means Offing has no rule for the package, not that it is safe. Reads no repository and no network.",
    inputSchema: z.object({
      purl: z
        .string()
        .min(1)
        .describe(
          "Package URL of the dependency, with the version when it is known, for example pkg:npm/request@2.88.2.",
        ),
      version: z
        .string()
        .min(1)
        .optional()
        .describe("Exact version to check; overrides a version written in the PURL."),
    }),
    async handler(_context, { purl, version }) {
      try {
        const { status, ...rest } = await checkDependency({ purl, ...(version ? { version } : {}) });
        // An agent reads what to use before the status it branches on, so the replacement of the most severe
        // finding comes first. Each finding keeps its own replacement; the field is left out when none is known.
        const replacement = rest.findings[0]?.replacement;
        return success({ ...(replacement ? { replacement } : {}), status, ...rest });
      } catch (error) {
        return failure(error);
      }
    },
  });
}

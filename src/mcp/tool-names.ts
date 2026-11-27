/** The tools the MCP server exposes, in the order it registers them. */
export const MCP_TOOL_NAMES = [
  "scan_repository",
  "list_deprecations",
  "explain_deprecation",
  "create_migration_context",
  "verify_migration",
  "check_dependency",
  "check_upgrade",
  "check_snippet",
  "agent_guard",
  "forecast_repository",
  "plan_migrations",
  "recommend_version",
  "scan_sbom",
  "image_lineage",
  "simulate_upgrade",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** The published JSON Schema each tool's structured content conforms to. */
export const MCP_OUTPUT_SCHEMA_FILES = {
  scan_repository: "scan.v1.schema.json",
  list_deprecations: "deprecations.v1.schema.json",
  explain_deprecation: "finding.v1.schema.json",
  create_migration_context: "context.v1.schema.json",
  verify_migration: "verification.v1.schema.json",
  check_dependency: "check.v1.schema.json",
  check_upgrade: "upgrade.v1.schema.json",
  check_snippet: "check-snippet.v1.schema.json",
  agent_guard: "agent-guard-response.v1.schema.json",
  forecast_repository: "forecast.v1.schema.json",
  plan_migrations: "plan.v1.schema.json",
  recommend_version: "recommend.v1.schema.json",
  scan_sbom: "scan.v1.schema.json",
  image_lineage: "lineage.v1.schema.json",
  simulate_upgrade: "whatif.v1.schema.json",
} as const satisfies Record<McpToolName, string>;

/** MCP hints shared by every tool: read-only, idempotent, closed-world, and non-destructive. */
export const MCP_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Where the rest of a cut answer is read, one line per tool; an answer over the cap ends with it as `more.hint`. */
export const MCP_TOOL_MORE_HINTS = {
  scan_repository:
    "Call list_deprecations on the same repository_path to see the findings more compactly, then explain_deprecation with one id. The full document: offing scan <path> --json.",
  list_deprecations:
    "The findings kept are the most severe. For all of them run offing scan <path> --format compact in a terminal, then call explain_deprecation with an id.",
  explain_deprecation: "The complete finding, with every usage: offing explain <finding_id> <path> --json.",
  create_migration_context: "The complete packet: offing context <finding_id> <path> --json.",
  verify_migration:
    "Call list_deprecations on the same repository_path to see every finding a fresh scan still reports, then explain_deprecation with one id.",
  check_dependency: "The complete check: offing check <purl> --json.",
  check_upgrade: "The complete report: offing upgrade-check --to <runtime>@<version> --json.",
  check_snippet: "The complete check: offing check-snippet --path <path> --json, with the content on stdin.",
  forecast_repository: "The complete forecast: offing forecast <path> --months <n> --as-of <date> --json.",
  plan_migrations: "The complete plan: offing plan <path> --json.",
  recommend_version: "The complete answer: offing recommend <product> --json.",
  scan_sbom: "The complete report: offing scan --sbom <file> --json.",
  simulate_upgrade: "The complete report: offing forecast <path> --target <runtime>@<version> --effort --json.",
  image_lineage: "The complete report: offing lineage <path> --json.",
} as const satisfies Record<Exclude<McpToolName, "agent_guard">, string>;

import { fromJsonSchema, type McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OffingAgentTools } from "../agent-tools.js";
import { classifyError, EXIT_CODES } from "../offing-error.js";
import { estimateTokens, limitToolAnswer, MAX_TOOL_TOKENS, serialized } from "./limit.js";
import { type JsonObject, toolOutputSchema } from "./output-schema.js";
import { MCP_TOOL_ANNOTATIONS, MCP_TOOL_MORE_HINTS } from "./tool-names.js";

/** Input every repository-scoped tool shares. */
export const repositoryInput = {
  repository_path: z
    .string()
    .min(1)
    .default(".")
    .describe("Local path to the repository. Defaults to the server working directory."),
};

/** Input every tool that follows up on one observed finding shares. */
export const findingInput = {
  finding_id: z.string().min(1).describe("Exact finding ID returned by Offing."),
  ...repositoryInput,
};

/** What a tool handler may use: the host session and the agent tools it drives. */
export interface McpToolContext {
  server: McpServer;
  tools: OffingAgentTools;
}

/** The subset of the MCP `CallToolResult` a tool returns. */
export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Keeps a successful result under the token cap. The structured content is cut against the schema the tool
 * advertises, which is the one the SDK validates it with, and the JSON text is rewritten from it.
 */
function capped(result: McpToolResult, schema: JsonObject, more: string): McpToolResult {
  const answer = result.structuredContent;
  if (result.isError === true || answer === undefined) return result;
  const text = result.content.find((part) => part.type === "text")?.text ?? serialized(answer);
  if (estimateTokens(text) <= MAX_TOOL_TOKENS) return result;
  limitToolAnswer(answer, schema, more);
  return { ...result, content: [{ type: "text", text: serialized(answer) }] };
}

/** A successful call: the same JSON as text and as structured content, so either client style works. */
export function success(value: object): McpToolResult {
  const structuredContent = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent,
  };
}

/**
 * A failed call: the message as text and the MCP error flag, never as structured content. The stable reason code, its
 * failure class, and the CLI exit code for that class travel in `_meta.offing`, so a client branches without parsing
 * the message.
 */
export function failure(error: unknown): McpToolResult {
  const { code, kind } = classifyError(error);
  return {
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
    _meta: { offing: { code, class: kind, exitCode: EXIT_CODES[kind] } },
  };
}

/** Registers one tool with its schema, output schema, and shared read-only annotations. */
export function registerMcpTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  tools: OffingAgentTools,
  config: {
    name: keyof typeof MCP_TOOL_MORE_HINTS;
    title: string;
    description: string;
    inputSchema: z.ZodObject<Shape>;
    handler: (context: McpToolContext, input: z.infer<z.ZodObject<Shape>>) => Promise<McpToolResult>;
  },
): void {
  const schema = toolOutputSchema(config.name);
  server.registerTool(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      outputSchema: fromJsonSchema(schema as Parameters<typeof fromJsonSchema>[0]),
      annotations: MCP_TOOL_ANNOTATIONS,
    },
    async (input) => capped(await config.handler({ server, tools }, input), schema, MCP_TOOL_MORE_HINTS[config.name]),
  );
}

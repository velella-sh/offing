import * as z from "zod/v4";

const SERVER_NAME = "io.github.velella-sh/offing";
const OFFICIAL_METADATA = "io.modelcontextprotocol.registry/official";
export const MCP_LISTING = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(SERVER_NAME)}/versions/latest`;

const listing = z.object({
  server: z.object({ name: z.literal(SERVER_NAME) }),
  _meta: z.object({ [OFFICIAL_METADATA]: z.object({ status: z.enum(["active", "deprecated", "deleted"]) }) }),
});

export async function collectListings(fetchPublic: typeof fetch) {
  const response = await fetchPublic(MCP_LISTING);
  if (response.status === 404) return { officialRegistry: 0 };
  if (!response.ok) throw new Error(`MCP Registry listing request returned HTTP ${response.status}.`);
  const parsed = listing.safeParse(await response.json());
  if (!parsed.success) throw new Error("The MCP Registry returned an unexpected server or status.");
  return { officialRegistry: parsed.data._meta[OFFICIAL_METADATA].status === "active" ? 1 : 0 };
}

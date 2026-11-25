import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createOffingMcpServer } from "../src/mcp.js";

export interface RpcResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

export interface McpTestClient {
  /** Sends one request and returns its result; a JSON-RPC error rejects with its message. */
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Methods of every notification the server sent. */
  notifications(): string[];
  close(): Promise<void>;
}

/**
 * A client connected to a fresh Offing MCP server over the SDK's in-memory transport: no port, subprocess, or
 * network. Call `close()` when done.
 */
export async function connectMcpClient(): Promise<McpTestClient> {
  const server = createOffingMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (response: RpcResponse) => void>();
  const notifications: string[] = [];
  let nextId = 1;
  clientTransport.onmessage = (message) => {
    const response = message as RpcResponse & { method?: string };
    if (typeof response.id === "number") pending.get(response.id)?.(response);
    else if (response.method) notifications.push(response.method);
  };
  await clientTransport.start();
  await server.connect(serverTransport);

  const request = async (method: string, params?: Record<string, unknown>) => {
    const id = nextId;
    nextId += 1;
    const response = new Promise<RpcResponse>((resolve) => pending.set(id, resolve));
    await clientTransport.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) } as never);
    const received = await response;
    pending.delete(id);
    if (received.error) throw new Error(received.error.message ?? "MCP request failed");
    return received.result ?? {};
  };
  await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "offing-test", version: "1.0.0" },
  });
  await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" } as never);

  return {
    request,
    notifications: () => [...notifications],
    async close() {
      await clientTransport.close();
      await server.close();
    },
  };
}

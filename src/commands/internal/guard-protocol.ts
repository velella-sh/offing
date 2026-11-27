import process from "node:process";

import { checkAgentGuard } from "../../agent-guard.js";
import { parseAgentGuardRequest } from "../../agent-guard-request.js";
import { OffingError } from "../../offing-error.js";
import type { CommandContext } from "../types.js";

// JSON may escape each byte of the 1 MB snippet with up to six bytes.
const MAX_REQUEST_BYTES = 6_010_000;

async function readRequest(stream: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) throw new OffingError("invalid-argument", "Agent Guard request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new OffingError("invalid-argument", "Agent Guard requires one UTF-8 JSON request on standard input.");
  }
}

export async function runGuardProtocol(ctx: CommandContext): Promise<number> {
  try {
    if (process.stdin.isTTY)
      throw new OffingError("invalid-argument", "Pipe the Agent Guard request to standard input.");
    const request = parseAgentGuardRequest(await readRequest(process.stdin));
    process.stdout.write(`${JSON.stringify(await checkAgentGuard(request))}\n`);
    return 0;
  } catch (error) {
    return ctx.failError(error);
  }
}

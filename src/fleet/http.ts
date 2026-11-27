import { setTimeout } from "node:timers/promises";

import { FleetHostError } from "./host.js";

interface ClientOptions {
  readonly fetch?: typeof fetch;
  readonly wait?: (ms: number) => Promise<unknown>;
}

function delayMs(response: Response): number | undefined {
  const { headers, status } = response;
  if (status !== 403 && status !== 429) return undefined;
  const retry = headers.get("retry-after");
  if (retry !== null) {
    const seconds = Number(retry);
    const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now();
    if (Number.isFinite(duration)) return Math.max(duration, 0);
  }
  const reset = headers.get("x-ratelimit-reset");
  if (headers.get("x-ratelimit-remaining") === "0" && reset !== null && Number.isFinite(Number(reset))) {
    return Math.max(Number(reset) * 1000 - Date.now(), 0);
  }
  return status === 429 ? 1000 : undefined;
}

export function fleetClient(
  headers: Readonly<Record<string, string>>,
  denied: string,
  { fetch: request = fetch, wait = setTimeout }: ClientOptions = {},
) {
  let blockedUntil = 0;
  return async (url: URL, redirect: RequestRedirect = "error"): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const remaining = blockedUntil - Date.now();
      if (remaining > 0) await wait(remaining);
      // Response headers and bodies can contain credentials or private data. Errors never include either.
      const response = await request(url, { headers, redirect, signal: AbortSignal.timeout(120_000) }).catch(() => {
        throw new FleetHostError("Could not contact the fleet host.");
      });
      if (response.ok || (redirect === "manual" && response.status === 302)) return response;
      await response.body?.cancel().catch(() => undefined);
      const delay = delayMs(response);
      if (delay !== undefined) {
        if (delay > 120_000 || attempt >= 3) throw new FleetHostError("Fleet host rate limit reached. Retry later.");
        blockedUntil = Math.max(blockedUntil, Date.now() + Math.max(delay, 100));
        continue;
      }
      if ([401, 403, 404].includes(response.status)) throw new FleetHostError(denied);
      throw new FleetHostError(`Fleet host returned HTTP ${response.status}.`);
    }
  };
}

export async function fleetJson(response: Response): Promise<unknown> {
  return response.json().catch(() => {
    throw new FleetHostError("Fleet host returned invalid JSON.");
  });
}

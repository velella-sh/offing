import { setTimeout } from "node:timers/promises";

import { fleetRateLimitDelay } from "../fleet/http.js";
import { invalidCampaign } from "./document.js";

export interface HostHttpOptions {
  request?: typeof fetch;
  wait?: (ms: number) => Promise<unknown>;
  now?: () => number;
}

const maxResponse = 2 * 1024 * 1024;

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxResponse) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    if (size <= maxResponse) return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw invalidCampaign("Campaign host returned unreadable JSON.");
  }
  throw invalidCampaign("Campaign host response exceeded the size limit.");
}

export function campaignHttp(
  base: URL,
  authorization: Record<string, string>,
  { request = fetch, wait = setTimeout, now = Date.now }: HostHttpOptions,
) {
  return async (
    endpoint: string,
    options: { method?: string; body?: object; absent?: boolean; unavailable?: boolean } = {},
  ) => {
    const { method = "GET", body, absent, unavailable } = options;
    const url = new URL(endpoint, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw invalidCampaign("Campaign request left its approved API.");
    }
    for (let retry = 0; ; retry += 1) {
      const response = await request(url, {
        method,
        headers: { ...authorization, accept: "application/json", ...(body && { "content-type": "application/json" }) },
        ...(body && { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      }).catch(() => {
        throw invalidCampaign("Campaign host could not be reached. Rerun to reconcile recorded work.");
      });
      if (response.ok) return readJson(response);
      await response.body?.cancel().catch(() => undefined);
      if (absent && response.status === 404) return undefined;
      const delay = fleetRateLimitDelay(response, now());
      if (delay !== undefined) {
        if (delay > 120_000 || retry >= 2) throw invalidCampaign("Campaign host rate limit reached. Retry later.");
        await wait(Math.max(delay, 100));
        continue;
      }
      if (unavailable && [403, 404].includes(response.status)) return undefined;
      throw invalidCampaign(
        `Campaign host returned HTTP ${response.status}. Rerun after checking permissions and pins.`,
      );
    }
  };
}

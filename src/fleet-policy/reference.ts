import { ConfigError } from "../config.js";

export interface PolicyReference {
  provider: "github" | "gitlab";
  repository: string;
  path: string;
  ref: string;
  source: string;
}

const segment = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
const sha = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;

export function isPolicyCommit(value: string): boolean {
  return sha.test(value);
}

/** The remote syntax names a repository and a file, never a general URL. */
export function parsePolicyReference(source: string): PolicyReference | undefined {
  const match = /^(github|gitlab):([^@]+)(?:@([^@]+))?$/.exec(source);
  if (!match) {
    if (/^(github|gitlab):/.test(source)) throw new ConfigError(`Invalid remote policy reference ${source}.`);
    return undefined;
  }
  const [, provider, location = "", ref = "HEAD"] = match;
  const parts = location.split("/");
  if (
    parts.length < 2 ||
    !parts.every((part) => segment.test(part)) ||
    !ref.split("/").every((part) => segment.test(part))
  ) {
    throw new ConfigError(`Invalid remote policy reference ${source}.`);
  }
  return {
    provider: provider === "github" ? "github" : "gitlab",
    repository: (provider === "github" ? parts.slice(0, 2) : parts).join("/"),
    path: (provider === "github" ? parts.slice(2).join("/") : "") || ".offing-policy.json",
    ref,
    source,
  };
}

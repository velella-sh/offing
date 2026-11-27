interface GitHubLocation {
  owner: string;
  repo: string;
  ref: string;
}

const source = /^github\/([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\/([A-Za-z0-9_.-]{1,100})(?:@(.+))?$/u;
const invalidRef = /[\s\p{Cc}\p{Surrogate}~^:?*[\\]|\.\.|@\{/u;
const format = "Use github/<owner>/<repo> or github/<owner>/<repo>@<ref>.";

function readRef(value: string): string {
  let ref: string;
  try {
    ref = decodeURIComponent(value);
  } catch {
    throw new Error(format);
  }
  if (
    ref.length > 512 ||
    ref === "@" ||
    ref.endsWith(".") ||
    invalidRef.test(ref) ||
    ref.split("/").some((part) => part === "" || part.startsWith(".") || part.endsWith(".lock"))
  ) {
    throw new Error(format);
  }
  return ref;
}

/** Parse the URL input value supplied by the tool host, without the leading fragment marker. */
export function parseGitHubForecastInput(value: string): GitHubLocation {
  const [, owner, repo, ref = "HEAD"] = source.exec(value) ?? [];
  if (!owner || !repo || repo === "." || repo === "..") throw new Error(format);
  return { owner, repo, ref: readRef(ref) };
}

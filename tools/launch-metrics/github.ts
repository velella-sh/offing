import * as z from "zod/v4";

export const GITHUB_REPOSITORY = "https://api.github.com/repos/velella-sh/offing";

const repositoryStats = z.object({
  stargazers_count: z.int().nonnegative(),
  forks_count: z.int().nonnegative(),
});

export async function collectGitHub(fetchPublic: typeof fetch) {
  const response = await fetchPublic(GITHUB_REPOSITORY);
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after") ||
        /rate limit/i.test(await response.text())))
  ) {
    throw new Error("GitHub rate limit reached for anonymous requests. Try again after the limit resets.");
  }
  if (!response.ok) throw new Error(`GitHub repository request returned HTTP ${response.status}.`);
  const parsed = repositoryStats.safeParse(await response.json());
  if (!parsed.success) throw new Error("GitHub returned invalid star or fork counts.");
  return { stars: parsed.data.stargazers_count, forks: parsed.data.forks_count };
}

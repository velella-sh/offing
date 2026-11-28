import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const repository = "https://github.com/velella-sh/offing";
export const githubApi = "https://api.github.com/repos/velella-sh/offing";
export const githubJson = "application/vnd.github+json";
export const p0Issues = `${repository}/issues?q=is%3Aissue+is%3Aopen+label%3Abug+label%3A%22priority%3A+P0%22`;
export const milestoneIssues = (milestone: number): string => `${repository}/milestone/${milestone}`;
export const releaseUrl = `${repository}/releases`;
export const scorecardUrl = "https://api.securityscorecards.dev/projects/github.com/velella-sh/offing";

export function publicGet(
  fetcher: typeof fetch,
  address: string,
  accept: string,
  deadline?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(10_000);
  return fetcher(address, {
    headers: { accept },
    credentials: "omit",
    redirect: "manual",
    signal: deadline ? AbortSignal.any([deadline, timeout]) : timeout,
  });
}

export function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function publishedRelease(fetcher: typeof fetch, version?: string) {
  const endpoint = version ? `tags/v${version}` : "latest";
  const response = await publicGet(fetcher, `${githubApi}/releases/${endpoint}`, githubJson);
  if (response.status !== 200) return undefined;
  const value = object(await response.json());
  if (typeof value.tag_name !== "string" || !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.tag_name)) {
    return undefined;
  }
  const published = typeof value.published_at === "string" ? value.published_at.slice(0, 10) : undefined;
  const exact = value.tag_name.slice(1);
  if (!isDate(published) || value.draft !== false || (version !== undefined && exact !== version)) return undefined;
  return { version: exact, published, url: `${releaseUrl}/tag/${value.tag_name}` };
}

export async function releaseCommit(fetcher: typeof fetch, version: string) {
  const response = await publicGet(fetcher, `${githubApi}/commits/v${version}`, githubJson);
  if (response.status !== 200) return undefined;
  const sha = object(await response.json()).sha;
  return typeof sha === "string" && /^[\da-f]{40}$/.test(sha) ? sha : undefined;
}

export async function releaseScorecard(fetcher: typeof fetch, commit: string | undefined) {
  const scorecard = await publicGet(fetcher, scorecardUrl, "application/json");
  if (scorecard.status !== 200) return undefined;
  const value = object(await scorecard.json());
  const source = object(value.repo);
  const date = typeof value.date === "string" ? value.date.slice(0, 10) : undefined;
  if (
    typeof value.score !== "number" ||
    !Number.isFinite(value.score) ||
    value.score < 0 ||
    value.score > 10 ||
    source.name !== "github.com/velella-sh/offing" ||
    typeof source.commit !== "string" ||
    !/^[\da-f]{40}$/.test(source.commit) ||
    !isDate(date)
  )
    return undefined;
  return {
    score: value.score,
    date,
    exact: commit === undefined ? undefined : source.commit === commit,
    source: `${repository}/commit/${source.commit}`,
  };
}

async function countOpenIssues(filter: { labels: string } | { milestone: string }, fetcher: typeof fetch) {
  const seen = new Set<number>();
  const query = new URLSearchParams({ state: "open", sort: "created", direction: "asc", per_page: "100", ...filter });
  for (let page = 1; page <= 20; page++) {
    query.set("page", String(page));
    const response = await publicGet(fetcher, `${githubApi}/issues?${query}`, githubJson);
    if (response.status !== 200) throw new Error(`GitHub issue list returned HTTP ${response.status}.`);
    const data: unknown = await response.json();
    if (!Array.isArray(data) || data.length > 100) throw new Error("Invalid GitHub issue batch.");
    for (const item of data.map(object)) {
      const number = count(item.number);
      if (number === undefined || item.state !== "open") throw new Error("Invalid open GitHub issue.");
      if (!Object.hasOwn(item, "pull_request")) seen.add(number);
    }
    if (!response.headers.get("link")?.includes('rel="next"')) return seen.size;
  }
  throw new Error("GitHub issue list exceeded 20 pages.");
}

export function countP0Bugs(fetcher: typeof fetch): Promise<number> {
  return countOpenIssues({ labels: "bug,priority: P0" }, fetcher);
}

export async function countMilestoneIssues(milestone: number, fetcher: typeof fetch): Promise<number> {
  const response = await publicGet(fetcher, `${githubApi}/milestones/${milestone}`, githubJson);
  if (response.status !== 200) throw new Error(`GitHub milestone returned HTTP ${response.status}.`);
  const value = object(await response.json());
  if (value.number !== milestone || value.state !== "open") throw new Error("The milestone is not open.");
  return countOpenIssues({ milestone: String(milestone) }, fetcher);
}

export async function readAdoption(directory: string, date: string, commit: string) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}-W\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  for (const name of names) {
    const parsed: unknown = JSON.parse(await readFile(join(directory, name), "utf8"));
    const metric = object(parsed);
    if (!isDate(metric.date)) {
      throw new Error(`Invalid snapshot date in ${name}.`);
    }
    if (metric.date > date) continue;
    const github = object(metric.github);
    const npm = object(metric.npm);
    const range = isDate(npm.start) && isDate(npm.end) ? ` (${npm.start} to ${npm.end})` : "";
    const measures = {
      Stars: count(github.stars),
      Forks: count(github.forks),
      Dependents: count(github.dependents),
      [`npm downloads${range}`]: count(npm.downloads),
      "Public workflow usage": count(github.publicWorkflowUsage),
    };
    return {
      measures: Object.entries(measures).map(([name, value]) => `${name} ${value ?? "unavailable"}`),
      complete: Object.values(measures).every((value) => value !== undefined),
      date: metric.date,
      evidence: `${repository}/blob/${commit}/metrics/${name}`,
    };
  }
  throw new Error("No dated launch-metrics snapshot was available for the observation date.");
}

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const repository = "https://github.com/velella-sh/offing";
const githubApi = "https://api.github.com/repos/velella-sh/offing";
const githubJson = "application/vnd.github+json";
export const p0Issues = `${repository}/issues?q=is%3Aissue+is%3Aopen+label%3Abug+label%3A%22priority%3A+P0%22`;
export const milestoneIssues = (milestone: number): string => `${repository}/milestone/${milestone}`;

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

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
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
    if (typeof metric.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(metric.date)) {
      throw new Error(`Invalid snapshot date in ${name}.`);
    }
    if (metric.date > date) continue;
    const github = object(metric.github);
    const npm = object(metric.npm);
    const note = (value: unknown) => count(value) ?? "unavailable";
    return {
      values: `Snapshot ${metric.date} · Stars ${note(github.stars)} · Forks ${note(github.forks)} · npm downloads ${note(npm.downloads)} · Dependents and public workflow usage unavailable`,
      evidence: `${repository}/blob/${commit}/metrics/${name}`,
    };
  }
  throw new Error("No dated launch-metrics snapshot was available for the observation date.");
}

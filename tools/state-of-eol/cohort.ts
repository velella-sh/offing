import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const size = 1000;
const day = 86_400_000;
const file = "benchmarks/state-of-eol/2027-cohort.json";
const repositoryName = /^[a-z\d][a-z\d-]*\/[a-z\d_.-]+$/i;
const sha = /^[a-f\d]{40}$/;
const version = "offing.state-of-eol.cohort.v1";

interface Repository {
  readonly repository: string;
  readonly stars: number;
  readonly pushedAt: string;
  readonly branch: string;
  readonly commit: string;
}

interface SearchRepository {
  readonly nameWithOwner: string;
  readonly stargazerCount: number;
  readonly pushedAt: string;
  readonly isArchived: boolean;
  readonly isDisabled: boolean;
  readonly isFork: boolean;
  readonly isPrivate: boolean;
  readonly defaultBranchRef: { name: string; target: { oid?: string } | null } | null;
}

interface SearchPage {
  readonly repositoryCount: number;
  readonly nodes: readonly SearchRepository[];
  readonly pageInfo: { endCursor: string | null; hasNextPage: boolean };
}

interface Cohort {
  readonly schemaVersion: typeof version;
  readonly startedAt: string;
  readonly retrievedAt: string;
  readonly activeSince: string;
  readonly cutoff: { stars: number; available: number; selected: number };
  readonly repositories: readonly Repository[];
}

type Search = (query: string, cursor?: string) => Promise<SearchPage>;

const document = `query($q: String!, $cursor: String) {
  search(query: $q, type: REPOSITORY, first: 100, after: $cursor) {
    repositoryCount
    pageInfo { endCursor hasNextPage }
    nodes { ... on Repository {
      nameWithOwner stargazerCount pushedAt isArchived isDisabled isFork isPrivate
      defaultBranchRef { name target { ... on Commit { oid } } }
    } }
  }
}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isBranch(value: unknown): value is SearchRepository["defaultBranchRef"] {
  if (value === null) return true;
  if (!isRecord(value) || typeof value.name !== "string") return false;
  const target = value.target;
  return target === null || (isRecord(target) && (target.oid === undefined || typeof target.oid === "string"));
}

function isSearchRepository(value: unknown): value is SearchRepository {
  if (!isRecord(value)) return false;
  if (typeof value.nameWithOwner !== "string" || !repositoryName.test(value.nameWithOwner)) return false;
  if (typeof value.stargazerCount !== "number" || !Number.isSafeInteger(value.stargazerCount)) return false;
  const flags = [value.isPrivate, value.isArchived, value.isDisabled, value.isFork];
  return (
    value.stargazerCount >= 0 &&
    typeof value.pushedAt === "string" &&
    flags.every((flag) => typeof flag === "boolean") &&
    isBranch(value.defaultBranchRef)
  );
}

function isSearchPage(value: unknown): value is SearchPage {
  if (!isRecord(value) || !Number.isSafeInteger(value.repositoryCount) || !isRecord(value.pageInfo)) return false;
  const { endCursor, hasNextPage } = value.pageInfo;
  return (
    (endCursor === null || typeof endCursor === "string") &&
    typeof hasNextPage === "boolean" &&
    isList(value.nodes) &&
    value.nodes.every(isSearchRepository)
  );
}

async function githubSearch(query: string, cursor?: string): Promise<SearchPage> {
  const args = ["api", "--hostname", "github.com", "graphql", "-f", `query=${document}`, "-f", `q=${query}`];
  if (cursor) args.push("-f", `cursor=${cursor}`);
  const { stdout } = await run("gh", args, { timeout: 30_000 });
  const result: unknown = JSON.parse(stdout);
  if (
    !isRecord(result) ||
    (isList(result.errors) && result.errors.length > 0) ||
    !isRecord(result.data) ||
    !isSearchPage(result.data.search)
  ) {
    throw new Error("GitHub returned an incomplete search response.");
  }
  return result.data.search;
}

function activeSince(startedAt: string): string {
  return new Date(Date.parse(startedAt) - 365 * day).toISOString().slice(0, 10);
}

function compare(left: Repository, right: Repository): number {
  const leftName = left.repository.toLowerCase();
  const rightName = right.repository.toLowerCase();
  return right.stars - left.stars || (leftName < rightName ? -1 : Number(leftName > rightName));
}

function validRow(row: Repository, since: string, until: string): boolean {
  const pushed = Date.parse(row.pushedAt);
  return (
    repositoryName.test(row.repository) &&
    !/\/\.{1,2}$/.test(row.repository) &&
    Number.isSafeInteger(row.stars) &&
    row.stars >= 0 &&
    typeof row.branch === "string" &&
    row.branch.length > 0 &&
    !/[\r\n]/.test(row.branch) &&
    sha.test(row.commit) &&
    pushed >= Date.parse(since) &&
    pushed <= Date.parse(until)
  );
}

function isRepository(value: unknown): value is Repository {
  if (!isRecord(value)) return false;
  const strings = [value.repository, value.pushedAt, value.branch, value.commit];
  return strings.every((field) => typeof field === "string") && typeof value.stars === "number";
}

function isCohort(value: unknown): value is Cohort {
  if (!isRecord(value) || !isRecord(value.cutoff) || value.schemaVersion !== version) return false;
  const dates = [value.startedAt, value.retrievedAt, value.activeSince];
  const counts = [value.cutoff.stars, value.cutoff.available, value.cutoff.selected];
  return (
    dates.every((field) => typeof field === "string") &&
    counts.every((field) => typeof field === "number") &&
    isList(value.repositories) &&
    value.repositories.every(isRepository)
  );
}

async function saveCohort(destination: string, cohort: Cohort): Promise<void> {
  const pending = join(dirname(destination), `.${randomUUID()}.tmp`);
  try {
    await writeFile(pending, `${JSON.stringify(cohort, null, 2)}\n`, { flag: "wx" });
    await link(pending, destination);
  } finally {
    await rm(pending, { force: true });
  }
}

function project(item: SearchRepository): Repository | undefined {
  if (item.isPrivate || item.isArchived || item.isDisabled || item.isFork || !item.defaultBranchRef) return undefined;
  const { name, target } = item.defaultBranchRef;
  if (!target?.oid) throw new Error(`Missing default-branch commit for ${item.nameWithOwner}.`);
  return {
    repository: item.nameWithOwner,
    stars: item.stargazerCount,
    pushedAt: item.pushedAt,
    branch: name,
    commit: target.oid,
  };
}

async function exactTies(search: Search, query: string, stars: number): Promise<SearchRepository[]> {
  const matches: SearchRepository[] = [];
  let cursor: string | undefined;
  let expected: number | undefined;
  for (let pageNo = 0; pageNo < 10; pageNo += 1) {
    const page = await search(`${query} stars:${stars}`, cursor);
    expected ??= page.repositoryCount;
    if (expected !== page.repositoryCount || expected > 1000) break;
    if (page.nodes.some((row) => row.stargazerCount !== stars)) break;
    matches.push(...page.nodes);
    if (!page.pageInfo.hasNextPage && matches.length === expected) return matches;
    const next = page.pageInfo.endCursor;
    if (!page.pageInfo.hasNextPage || !next || cursor === next) break;
    cursor = next;
  }
  throw new Error(`GitHub search did not enumerate the complete ${stars}-star tie.`);
}

async function searchBand(
  search: Search,
  query: string,
  ceiling: number,
): Promise<{ nodes: SearchRepository[]; floor: number }> {
  const bound = Number.isFinite(ceiling) ? ` stars:<${ceiling}` : "";
  const page = await search(query + bound);
  const last = page.nodes.at(-1);
  if (!last) throw new Error("GitHub search ended before the cohort was complete.");
  const floor = last.stargazerCount;
  if (page.nodes.some((row) => row.stargazerCount >= ceiling || row.stargazerCount < floor)) {
    throw new Error("GitHub search pagination did not respect the star range.");
  }
  if (!page.pageInfo.hasNextPage && page.repositoryCount === page.nodes.length) {
    return { nodes: [...page.nodes], floor };
  }
  if (page.nodes.length !== 100) throw new Error("Incomplete GitHub repository search page.");
  const ties = await exactTies(search, query, floor);
  const names = new Set(ties.map((row) => row.nameWithOwner.toLowerCase()));
  if (page.nodes.some((row) => row.stargazerCount === floor && !names.has(row.nameWithOwner.toLowerCase()))) {
    throw new Error("GitHub star ranks changed during capture. Start a new capture.");
  }
  return { nodes: [...page.nodes.filter((row) => row.stargazerCount > floor), ...ties], floor };
}

export async function collectCohort(
  search: Search,
  startedAt: string,
  now: () => string,
  limit = size,
): Promise<Cohort> {
  const since = activeSince(startedAt);
  const query = `is:public fork:false archived:false pushed:>=${since} sort:stars-desc`;
  const repositories: Repository[] = [];
  const seen = new Set<string>();
  let ceiling = Infinity;
  for (let band = 0; band < 30 && repositories.length < limit; band += 1) {
    const { nodes, floor } = await searchBand(search, query, ceiling);
    for (const row of nodes) {
      const id = row.nameWithOwner.toLowerCase();
      if (seen.has(id)) throw new Error(`Duplicate GitHub repository in capture: ${id}.`);
      seen.add(id);
      const repository = project(row);
      if (repository) repositories.push(repository);
    }
    ceiling = floor;
  }
  repositories.sort(compare);
  const selected = repositories.slice(0, limit);
  const final = selected.at(-1);
  if (selected.length !== limit || !final) throw new Error("GitHub search ended before the cohort was complete.");
  const stars = final.stars;
  return {
    schemaVersion: version,
    startedAt,
    retrievedAt: now(),
    activeSince: since,
    cutoff: {
      stars,
      available: repositories.filter((row) => row.stars === stars).length,
      selected: selected.filter((row) => row.stars === stars).length,
    },
    repositories: selected,
  };
}

export function verifyCohort(cohort: Cohort, limit = size): void {
  if (cohort.schemaVersion !== version || cohort.activeSince !== activeSince(cohort.startedAt)) {
    throw new Error("Unexpected cohort version or activity window.");
  }
  if (
    !Number.isFinite(Date.parse(cohort.retrievedAt)) ||
    Date.parse(cohort.retrievedAt) < Date.parse(cohort.startedAt)
  ) {
    throw new Error("Unexpected cohort retrieval time.");
  }
  if (cohort.repositories.length !== limit) throw new Error(`Expected ${limit} cohort repositories.`);
  const seen = new Set<string>();
  let previous: Repository | undefined;
  for (const row of cohort.repositories) {
    if (!validRow(row, cohort.activeSince, cohort.retrievedAt))
      throw new Error(`Invalid cohort row: ${row.repository}.`);
    const id = row.repository.toLowerCase();
    if (seen.has(id) || (previous && compare(previous, row) > 0))
      throw new Error(`Invalid rank for ${row.repository}.`);
    seen.add(id);
    previous = row;
  }
  const { stars, selected, available } = cohort.cutoff;
  if (stars !== previous?.stars || selected !== cohort.repositories.filter((row) => row.stars === stars).length) {
    throw new Error("Unexpected cohort cutoff.");
  }
  if (!Number.isSafeInteger(available) || available < selected) throw new Error("Unexpected cutoff tie count.");
}

async function main(args: string[]): Promise<void> {
  const [mode, destination = file] = args;
  if (args.length > 2 || (mode !== "--record" && mode !== "--verify")) {
    throw new Error("Usage: node dist/tools/state-of-eol/cohort.js --verify|--record [cohort.json]");
  }
  if (mode === "--record") {
    const now = () => new Date().toISOString();
    const cohort = await collectCohort(githubSearch, now(), now);
    verifyCohort(cohort);
    await saveCohort(destination, cohort);
    process.stdout.write(`Recorded ${size} repositories in ${destination}.\n`);
  } else {
    const cohort: unknown = JSON.parse(await readFile(destination, "utf8"));
    if (!isCohort(cohort)) throw new Error("Malformed State of EOL cohort file.");
    verifyCohort(cohort);
    process.stdout.write(`Verified ${size} pinned repositories and cutoff ranks.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

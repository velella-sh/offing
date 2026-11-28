import { isRecord } from "../github-api-values.js";
import { forgeApi } from "../fleet/remote.js";
import { digest } from "../proof/document.js";
import { type CampaignPublication, invalidCampaign } from "./document.js";
import type { HostTarget } from "./host-config.js";
import { campaignHttp, type HostHttpOptions } from "./host-http.js";

type RecordValue = Record<string, unknown>;
type Lifecycle = "review" | "merged" | "closed";
type Observation = NonNullable<CampaignPublication["observed"]>;

interface RequestIdentity {
  branch: string;
  baseBranch: string;
  head: string;
  bodySha256: string;
}

function record(value: unknown): RecordValue {
  if (!isRecord(value)) {
    throw invalidCampaign("Campaign host response lacked required fields.");
  }
  return value;
}

function items(value: unknown): RecordValue[] {
  if (!Array.isArray(value) || value.length > 100) throw invalidCampaign("Campaign host returned an invalid page.");
  return value.map(record);
}

function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw invalidCampaign("Campaign host response lacked a safe numeric identifier.");
  }
  return value;
}

function matchesGitHub(found: RecordValue, expected: RequestIdentity, projectId: number) {
  const head = record(found.head);
  const base = record(found.base);
  return (
    head.ref === expected.branch &&
    base.ref === expected.baseBranch &&
    head.sha === expected.head &&
    record(head.repo).id === projectId &&
    record(base.repo).id === projectId
  );
}

function matchesGitLab(found: RecordValue, expected: RequestIdentity, projectId: number) {
  return (
    found.source_project_id === projectId &&
    found.target_project_id === projectId &&
    found.source_branch === expected.branch &&
    found.target_branch === expected.baseBranch &&
    found.sha === expected.head
  );
}

function lifecycle(found: RecordValue, gitlab: boolean): Lifecycle {
  if (found.state === "merged" || (!gitlab && found.merged === true)) return "merged";
  if (found.state === (gitlab ? "opened" : "open")) return "review";
  if (found.state === "closed") return "closed";
  throw invalidCampaign("Campaign host returned an unrecognized request state.");
}

function matchingBody(body: unknown, { branch, bodySha256 }: RequestIdentity): boolean {
  const key = branch.slice("offing-campaign/".length);
  return (
    typeof body === "string" &&
    body.split("\n").includes(`<!-- offing-campaign:${key} -->`) &&
    digest(body) === bodySha256
  );
}

class CampaignForge {
  readonly requests: string;

  constructor(
    private readonly http: ReturnType<typeof campaignHttp>,
    private readonly target: HostTarget,
    private readonly path: string,
    private readonly projectId: number,
  ) {
    this.requests = path + (target.gitlab ? "/merge_requests" : "/pulls");
  }

  async branch(name: string) {
    const gitlab = this.target.gitlab;
    const route = gitlab ? "/repository/branches/" : "/branches/";
    const value = await this.http(this.path + route + encodeURIComponent(name), { absent: true });
    if (value === undefined) return undefined;
    const found = record(value);
    const head = record(found.commit)[gitlab ? "id" : "sha"];
    if (found.name !== name || typeof head !== "string") {
      throw invalidCampaign("Campaign host response did not identify the requested branch.");
    }
    return head;
  }

  async request(number: number, expected: RequestIdentity) {
    const found = record(await this.http(`${this.requests}/${number}`));
    const { gitlab, actorId } = this.target;
    const matches = (gitlab ? matchesGitLab : matchesGitHub)(found, expected, this.projectId);
    const body = gitlab ? found.description : found.body;
    if (
      !matches ||
      found[gitlab ? "iid" : "number"] !== number ||
      record(found[gitlab ? "author" : "user"]).id !== actorId ||
      !matchingBody(body, expected)
    ) {
      throw invalidCampaign("Campaign request ownership, verified head or proof changed. Review it manually.");
    }
    return { status: lifecycle(found, gitlab), found };
  }

  async find(branch: string): Promise<number | undefined> {
    const { gitlab, repo } = this.target;
    const query = gitlab
      ? { source_branch: branch, scope: "all", per_page: "2" }
      : { head: `${repo.split("/")[0]}:${branch}`, state: "all", per_page: "2" };
    const matches = items(await this.http(`${this.requests}?${new URLSearchParams(query)}`));
    if (matches.length > 1) throw invalidCampaign("Campaign branch has multiple review requests. Review it manually.");
    const found = matches[0];
    return found ? id(found[gitlab ? "iid" : "number"]) : undefined;
  }

  async create(expected: RequestIdentity, title: string, body: string): Promise<number> {
    const gitlab = this.target.gitlab;
    const fields = gitlab
      ? { source_branch: expected.branch, target_branch: expected.baseBranch, title, description: body }
      : { head: expected.branch, base: expected.baseBranch, title, body };
    const response = record(await this.http(this.requests, { method: "POST", body: fields }));
    return id(response[gitlab ? "iid" : "number"]);
  }

  async close(number: number) {
    await this.http(
      `${this.requests}/${number}`,
      this.target.gitlab
        ? { method: "PUT", body: { state_event: "close" } }
        : { method: "PATCH", body: { state: "closed" } },
    );
  }

  async signals(number: number, head: string, found: RecordValue) {
    const route = `${this.requests}/${number}`;
    if (this.target.gitlab) {
      const approvals = await this.http(route + "/approvals", { unavailable: true });
      const approved = approvals === undefined ? undefined : record(approvals).approved;
      return gitlabSignals(head, found, approved);
    }
    const [checks, statuses, reviews] = await Promise.all([
      this.http(`${this.path}/commits/${head}/check-runs?filter=latest&per_page=100`),
      this.http(`${this.path}/commits/${head}/status`),
      this.http(route + "/reviews?per_page=100"),
    ]);
    return { checks: githubChecks(record(checks), record(statuses), head), review: githubReview(items(reviews)) };
  }
}

export async function openForge(target: HostTarget, options: HostHttpOptions) {
  const { gitlab, repo, origin, token } = target;
  const headers: Record<string, string> = gitlab
    ? { "private-token": token }
    : { authorization: "Bearer " + token, "x-github-api-version": "2022-11-28" };
  const http = campaignHttp(forgeApi(gitlab, origin), headers, options);
  const path = gitlab ? `projects/${encodeURIComponent(repo)}` : `repos/${repo}`;
  const identity = record(await http(path));
  if (
    identity[gitlab ? "path_with_namespace" : "full_name"] !== repo ||
    identity.archived !== false ||
    identity.default_branch !== target.baseBranch ||
    identity.disabled === true ||
    identity.pending_delete === true
  ) {
    throw invalidCampaign("Campaign repository identity or default branch differs from its approved scope.");
  }
  const actor = id(record(await http("user")).id);
  if (actor !== target.actorId) throw invalidCampaign("Campaign token does not authenticate as its approved actor.");
  return new CampaignForge(http, target, path, id(identity.id));
}

function gitlabSignals(head: string, found: RecordValue, approved: unknown) {
  const pipeline = found.head_pipeline ? record(found.head_pipeline) : undefined;
  const status = pipeline?.sha === head ? pipeline.status : undefined;
  return {
    checks: gitlabChecks(status),
    review: approved === true ? "approved" : approved === false ? "pending" : "unknown",
  } as const;
}

function gitlabChecks(state: unknown) {
  if (state === "success") return "passed";
  if (state === "failed" || state === "canceled") return "failed";
  if (
    ["created", "pending", "running", "preparing", "waiting_for_resource", "scheduled", "manual"].includes(
      String(state),
    )
  )
    return "pending";
  return "unknown";
}

function githubReview(reviews: RecordValue[]): Observation["review"] {
  if (reviews.length === 100) return "unknown";
  const latest = new Map<number, string>();
  for (const { state, user } of reviews) {
    if (typeof state === "string" && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(state)) {
      latest.set(id(record(user).id), state);
    }
  }
  const decisions = [...latest.values()];
  if (decisions.includes("CHANGES_REQUESTED")) return "changes-requested";
  if (decisions.includes("APPROVED")) return "approved";
  return "pending";
}

function githubChecks(checks: RecordValue, statuses: RecordValue, head: string): Observation["checks"] {
  const runs = items(checks.check_runs);
  const count = statuses.total_count;
  const state = statuses.state;
  if (checks.total_count !== runs.length || runs.some((run) => run.head_sha !== head) || typeof count !== "number")
    return "unknown";
  const completed = runs.filter((run) => run.status === "completed");
  if (
    (count > 0 && ["error", "failure"].includes(String(state))) ||
    completed.some((run) => !["success", "neutral", "skipped"].includes(String(run.conclusion)))
  )
    return "failed";
  if (completed.length !== runs.length || (count > 0 && state === "pending")) return "pending";
  if (runs.length || (count > 0 && state === "success")) return "passed";
  return "unknown";
}

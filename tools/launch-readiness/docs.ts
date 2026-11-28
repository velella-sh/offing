import { githubApi, githubJson, isDate, object, publicGet, repository } from "./evidence.js";

const checks = [
  {
    label: "Packed launch commands",
    workflow: "package-smoke.yml",
    job: "npm, Docker, and Action",
    step: "acc-launch-docs",
  },
  {
    label: "Built launch links",
    workflow: "docs-doctor.yml",
    job: "mizzen check (docs)",
    step: "Check built launch links",
  },
];

const maxRuns = 5;
const exactEvents = new Set(["workflow_dispatch", "schedule", "push", "merge_group"]);
const pendingFullChecks = [282, 287, 301];
type DocsCheck = (typeof checks)[number];
type Query = { commit: string; date: string };
type Outcome = { result: "passed" | "failed" | "missing"; source: string };

async function readArray(fetcher: typeof fetch, path: string, field: string) {
  try {
    const response = await publicGet(fetcher, `${githubApi}${path}`, githubJson);
    if (response.status !== 200) return [];
    if (field === "jobs" && response.headers.get("link")?.includes('rel="next"')) return [];
    const data = object(await response.json())[field];
    return Array.isArray(data) ? data.map(object) : [];
  } catch {
    return [];
  }
}

function validRuns(runs: Record<string, unknown>[], spec: DocsCheck, date: string) {
  return runs.slice(0, maxRuns).filter((run) => {
    const updated = typeof run.updated_at === "string" ? run.updated_at.slice(0, 10) : undefined;
    return (
      run.path === `.github/workflows/${spec.workflow}` &&
      run.status === "completed" &&
      object(run.head_repository).full_name === "velella-sh/offing" &&
      typeof run.head_sha === "string" &&
      /^[0-9a-f]{40}$/u.test(run.head_sha) &&
      isDate(updated) &&
      updated <= date &&
      id(run.id) !== undefined
    );
  });
}

function id(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function readStep(fetcher: typeof fetch, spec: DocsCheck, run: number): Promise<Outcome | undefined> {
  const jobs = await readArray(fetcher, `/actions/runs/${run}/jobs?per_page=100`, "jobs");
  const matchingJobs = jobs.filter(({ name }) => name === spec.job);
  const job = matchingJobs.length === 1 ? matchingJobs[0] : undefined;
  const jobId = id(job?.id);
  if (!jobId || job?.status !== "completed" || !Array.isArray(job.steps)) return undefined;
  const named = job.steps.map(object).filter(({ name }) => name === spec.step);
  const step = named.length === 1 ? named[0] : undefined;
  const stepNumber = id(step?.number);
  if (!stepNumber) return undefined;
  const source = `${repository}/actions/runs/${run}/job/${jobId}#step:${stepNumber}:1`;
  const conclusion = step?.status === "completed" ? step.conclusion : undefined;
  const result = conclusion === "success" ? "passed" : conclusion === "failure" ? "failed" : "missing";
  return { result, source };
}

function currentCheckout(run: Record<string, unknown>, commit: string) {
  return run.head_sha === commit && typeof run.event === "string" && exactEvents.has(run.event);
}

async function readCheck(fetcher: typeof fetch, spec: DocsCheck, { commit, date }: Query) {
  const workflow = `${repository}/actions/workflows/${spec.workflow}`;
  const endpoint = `/actions/workflows/${spec.workflow}/runs?status=completed&per_page=${maxRuns}`;
  const matching = validRuns(
    await readArray(fetcher, `${endpoint}&head_sha=${encodeURIComponent(commit)}`, "workflow_runs"),
    spec,
    date,
  );
  const visited = new Set<number>();
  for (const run of matching.filter((item) => currentCheckout(item, commit))) {
    const runId = id(run.id);
    if (!runId) continue;
    visited.add(runId);
    const step = await readStep(fetcher, spec, runId);
    if (step) return { ...step, scope: "current revision" };
  }
  const recent = validRuns(await readArray(fetcher, endpoint, "workflow_runs"), spec, date);
  for (const run of recent) {
    const runId = id(run.id);
    if (!runId || visited.has(runId)) continue;
    const step = await readStep(fetcher, spec, runId);
    if (!step || step.result === "missing") continue;
    const scope = currentCheckout(run, commit)
      ? "current revision"
      : `prior ${run.event === "pull_request" ? "PR check at " : "revision "}${String(run.head_sha).slice(0, 8)}`;
    return { ...step, scope };
  }
  return { result: "missing", source: workflow, scope: "current revision" } as const;
}

export async function readLaunchDocs(fetcher: typeof fetch, query: Query) {
  const observations = await Promise.all(
    checks.map(async (spec) => ({ label: spec.label, ...(await readCheck(fetcher, spec, query)) })),
  );
  const status = observations.some(({ result, scope }) => result === "failed" && scope === "current revision")
    ? "red"
    : "amber";
  return {
    status,
    observed:
      observations.map(({ label, result, scope }) => `${label} ${result} (${scope})`).join(" · ") +
      " · Full launch docs and README evidence incomplete",
    evidence: [
      ...observations.map(({ source }) => source),
      ...pendingFullChecks.map((issue) => `${repository}/issues/${issue}`),
    ],
  } as const;
}

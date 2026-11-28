import { githubApi, githubJson, isDate, object, publicGet, repository } from "./evidence.js";

const verifierSteps = {
  provenance: { job: "publish-npm / verify-provenance", step: "Verify the npm provenance" },
  attestation: {
    job: "sbom / verify-attestation / lifecycle",
    step: "Verify published bytes with the GitHub CLI and Cosign",
  },
};

function stepResult(jobs: Record<string, unknown>[], role: keyof typeof verifierSteps): "green" | "red" | undefined {
  const { job, step } = verifierSteps[role];
  const jobRun = jobs.find(({ name }) => name === job);
  if (!jobRun || !Array.isArray(jobRun.steps)) return undefined;
  const check = jobRun.steps.map(object).find(({ name }) => name === step);
  if (check?.conclusion === "failure") return "red";
  if (check?.conclusion === "success" && jobRun.conclusion === "success") return "green";
  return undefined;
}

export async function releaseVerification(fetcher: typeof fetch, version: string, commit: string) {
  const tag = `v${version}`;
  const query = new URLSearchParams({ branch: tag, event: "push", status: "completed", per_page: "10" });
  const runs = await publicGet(fetcher, `${githubApi}/actions/workflows/release.yml/runs?${query}`, githubJson);
  if (runs.status !== 200) return undefined;
  const value = object(await runs.json()).workflow_runs;
  if (!Array.isArray(value)) return undefined;
  const release = value
    .map(object)
    .find(
      (run) =>
        run.head_branch === tag &&
        run.head_sha === commit &&
        run.event === "push" &&
        run.status === "completed" &&
        object(run.head_repository).full_name === "velella-sh/offing" &&
        run.path === ".github/workflows/release.yml",
    );
  if (typeof release?.id !== "number" || !Number.isSafeInteger(release.id) || release.id < 1) return undefined;
  const date = typeof release.updated_at === "string" ? release.updated_at.slice(0, 10) : undefined;
  if (!isDate(date)) return undefined;
  const result = await publicGet(fetcher, `${githubApi}/actions/runs/${release.id}/jobs?per_page=100`, githubJson);
  if (result.status !== 200 || result.headers.get("link")?.includes('rel="next"')) return undefined;
  const jobs = object(await result.json()).jobs;
  if (!Array.isArray(jobs)) return undefined;
  const scoped = jobs.map(object);
  return {
    date,
    source: `${repository}/actions/runs/${release.id}`,
    provenance: stepResult(scoped, "provenance"),
    attestation: stepResult(scoped, "attestation"),
  };
}

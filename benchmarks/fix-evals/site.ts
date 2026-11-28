import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { metrics } from "./evaluate.js";

const reports = "benchmarks/fix-evals/results";
const agentRuns = "benchmarks/agent-migrations/results";
const github = "https://github.com/velella-sh/offing/blob/main/";
const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const count = z.int().nonnegative();
const metric = z.object({ passed: count, applicable: count, percent: z.number().min(0).max(100).nullable() });
export const fixEvalReport = z.looseObject({
  schemaVersion: z.literal("offing.fix-evals.v1"),
  selected: count,
  repositories: count,
  fixtures: z.literal(false),
  evidenceSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  revision: z.string().regex(/^[a-f0-9]{40}$/u),
  ebb: z.string(),
  excluded: z.array(z.object({ id, reason: id })),
  fixers: z.array(
    z.object({
      id,
      cases: count,
      status: z.enum(["measured", "too few cases"]),
      metrics: z.record(z.enum(metrics), metric),
      failures: z.array(z.object({ repository: id, failures: z.array(z.enum(metrics)) })),
    }),
  ),
});

const agentRecord = z.object({
  agent: z.object({ name: z.string(), version: z.string(), model: z.string() }),
  cases: z
    .array(
      z.object({
        conditions: z.array(
          z.object({
            condition: z.enum(["baseline", "packet"]),
            staticSuccess: z.boolean().optional(),
            success: z.boolean(),
            projectVerificationStatus: z.enum(["pass", "fail", "timeout", "not-run"]),
          }),
        ),
      }),
    )
    .min(1),
});

type AgentRecord = z.infer<typeof agentRecord>;
type Rate = z.infer<typeof metric>;

const metricLabels = {
  deterministic: "Deterministic",
  applied: "Applied",
  resolved: "Resolved",
  noNewFinding: "No new finding",
  idempotent: "Idempotent",
  buildKeptGreen: "Build or validation stayed green",
  testsKeptGreen: "Tests stayed green",
} as const satisfies Record<(typeof metrics)[number], string>;

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function latestFixEval(root: string): Promise<{ date: string; path: string }> {
  const entries = await readdir(resolve(root, reports), { withFileTypes: true });
  const date = entries
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/u.test(name))
    .sort()
    .at(-1);
  if (date === undefined) throw new Error("No dated fix evaluation results.");
  return { date, path: `${reports}/${date}/report.json` };
}

function rates({ passed, applicable, percent }: Rate): string {
  if (applicable === 0) return "not applicable";
  return `${passed}/${applicable}${percent === null ? "" : ` (${percent.toFixed(1)}%)`}`;
}

function agentRows(record: AgentRecord, file: string) {
  return (["baseline", "packet"] as const).map((mode) => {
    const arms = record.cases.flatMap(({ conditions }) => conditions.filter(({ condition }) => condition === mode));
    const project = arms.filter(({ projectVerificationStatus }) => projectVerificationStatus !== "not-run");
    const staticPassed = arms.filter(({ staticSuccess, success }) => staticSuccess ?? success).length;
    const projectPassed = project.filter(
      ({ projectVerificationStatus }) => projectVerificationStatus === "pass",
    ).length;
    const bothPassed = project.filter(({ success }) => success).length;
    if (arms.length !== record.cases.length) throw new Error(`Incomplete paired agent run in ${file}.`);
    return {
      id: `${file.slice(0, -5)}-${mode}`,
      date: file.slice(0, 10),
      profile: project.length === 0 ? "Static checks" : "Static checks and selected project checks",
      agent: `${record.agent.name} ${record.agent.version} · ${record.agent.model}`,
      arm: mode === "baseline" ? "Bare prompt" : "Migration packet",
      static: `${staticPassed}/${arms.length}`,
      project: project.length === 0 ? "not run" : `${projectPassed}/${project.length}`,
      both: project.length === 0 ? "not run" : `${bothPassed}/${project.length}`,
      source: `${github}${agentRuns}/${file}`,
    };
  });
}

export async function fixEvalPageData(root: string) {
  const { date, path } = await latestFixEval(root);
  const result = fixEvalReport.parse(await json(resolve(root, path)));
  if (result.repositories + result.excluded.length !== result.selected) {
    throw new Error("The evaluated and excluded repositories must cover the selection.");
  }
  const fixes = result.fixers.map((fixer) => ({
    id: fixer.id,
    cases: fixer.cases,
    status: fixer.status,
    ...Object.fromEntries(metrics.map((key) => [key, rates(fixer.metrics[key])])),
  }));
  const charts = result.fixers.flatMap(({ id: label, metrics: { buildKeptGreen } }) =>
    buildKeptGreen.percent === null ? [] : [{ label, percent: buildKeptGreen.percent }],
  );
  const files = (await readdir(resolve(root, agentRuns)))
    .filter((file) => /^\d{4}-\d{2}-\d{2}-.+\.json$/u.test(file))
    .sort();
  const agent = (
    await Promise.all(
      files.map(async (file) => agentRows(agentRecord.parse(await json(resolve(root, agentRuns, file))), file)),
    )
  ).flat();
  const failures = result.fixers.flatMap((fixer) =>
    fixer.failures.map(
      ({ repository, failures }) =>
        `- \`${fixer.id}\` on [${repository}](${github}${reports}/${date}/failures/${repository}.json) · ${failures.map((key) => metricLabels[key]).join(", ")}`,
    ),
  );
  const run = [
    {
      id: "fix-evals",
      date,
      selected: result.selected,
      measured: result.repositories,
      excluded: result.excluded.length,
      revision: result.revision,
      ebb: result.ebb,
      evidence: `[Verified summary](${github}${path}) · [Raw logs and hashes](${github}${reports}/${date}/evidence.tar.gz)`,
      failureLinks: failures.length === 0 ? "No failed metrics in this run." : failures.join("\n"),
      agentLinks: files.map((file) => `- [${file.slice(0, 10)} agent run](${github}${agentRuns}/${file})`).join("\n"),
    },
  ];
  return { schemaVersion: "offing.fix-evals-page.v1", run, fixes, charts, agent };
}

export async function renderFixEvalCollections(root: string): Promise<Record<string, string>> {
  const data = await fixEvalPageData(root);
  return Object.fromEntries(
    [
      ["fix-evals", data],
      ["fix-evals-run", data.run],
      ["fix-evals-fixers", data.fixes],
      ["fix-evals-agent", data.agent],
    ].map(([file, value]) => [`docs/_data/${file}.json`, `${JSON.stringify(value, null, 2)}\n`]),
  );
}

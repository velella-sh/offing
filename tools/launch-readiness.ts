import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { nodeFileSystem } from "../src/node-file-system.js";
import { readReleaseDemos } from "./launch-readiness/demos.js";
import {
  countMilestoneIssues,
  countP0Bugs,
  milestoneIssues,
  p0Issues,
  publishedRelease,
  readAdoption,
  releaseCommit,
  releaseScorecard,
  releaseUrl,
  repository,
  scorecardUrl,
} from "./launch-readiness/evidence.js";
import { checkSitemap, sitemapUrl } from "./launch-readiness/site.js";
import { readColdInstall } from "./launch-readiness/timing.js";
import { releaseVerification } from "./launch-readiness/verification.js";

const thresholds = {
  "Public pages":
    "Green when every sitemap URL returns 200 with its built title. Amber when inventory or title evidence is unavailable. Red when an HTTP or title mismatch is observed.",
  "Release demos":
    "Green when the inventory matches the released version and recorded digests. Amber when the release or manifest is unavailable. Red when a version or file differs.",
  "Cold install":
    "Green when every supported OS and Node.js pair reaches first output in under 10 seconds. Amber when the matrix is incomplete. Red when a required pair fails or takes at least 10 seconds.",
  "Documentation and README":
    "Green when all required checks pass. Amber when a result is unavailable. Red when a required check fails.",
  Adoption:
    "Green when all five measures have values. Amber when evidence is incomplete. There is no minimum adoption target.",
  Scorecard: "Green at 6.0 or higher. Amber when the result is unavailable. Red below 6.0.",
  "npm provenance":
    "Green when provenance verifies for the released package. Amber when verification is unavailable. Red when verification fails.",
  "Release attestation":
    "Green when the published release attestation verifies. Amber when verification is unavailable. Red when verification fails.",
  "Open P0 bugs": "Green when the count is zero. Amber when it is unavailable. Red when it is greater than zero.",
  "Open milestone issues":
    "Green when the count is zero. Amber when issues remain open or the count is unavailable. There is no red issue-count threshold.",
} as const;

type CheckName = keyof typeof thresholds;
type Status = "green" | "amber" | "red";
type SiteEvidence = { directory: string; run: string };
type ReadinessInput = {
  date: string;
  milestone: number;
  commit: string;
  site?: SiteEvidence;
  timing?: string;
  version?: string;
  demoRoot?: string;
};

function check(name: CheckName, status: Status, observed: string, evidence: string[]) {
  return { name, status, observed, thresholds: thresholds[name], evidence };
}

function outstanding(name: CheckName, issue: number) {
  return check(name, "amber", "Released-version evidence unavailable", [`${repository}/issues/${issue}`]);
}

async function siteCheck(input: SiteEvidence | undefined, fetcher: typeof fetch) {
  const links = [sitemapUrl];
  if (input) links.push(`${repository}/actions/runs/${input.run}`);
  const observation = input ? await checkSitemap(input.directory, fetcher).catch(() => undefined) : undefined;
  const status = observation?.issues.some((issue) => issue.kind === "mismatch") ? "red" : "amber";
  const result = observation
    ? check(
        "Public pages",
        observation.issues.length ? status : "green",
        `${observation.pages - observation.issues.length} of ${observation.pages} titles and HTTP responses matched`,
        links,
      )
    : check("Public pages", "amber", "Matching build and public sitemap evidence unavailable", links);
  return { result, issues: observation?.issues ?? [] };
}

async function releaseChecks(input: ReadinessInput, fetcher: typeof fetch) {
  const release = await publishedRelease(fetcher, input.version).catch(() => undefined);
  const commit = release ? await releaseCommit(fetcher, release.version).catch(() => undefined) : undefined;
  const [timing, scorecard, verification] = await Promise.all([
    release && input.timing
      ? readColdInstall(input.timing, input.date, release.version).catch(() => undefined)
      : undefined,
    release ? releaseScorecard(fetcher, commit).catch(() => undefined) : undefined,
    release && commit ? releaseVerification(fetcher, release.version, commit).catch(() => undefined) : undefined,
  ]);
  const version = release ? `v${release.version}` : "Published version unavailable";
  const label = release ? `${version} · ` : "";
  const outcome = (status: Status | undefined) =>
    !status || !verification
      ? `${label}Released-artifact verification unavailable`
      : `${label}${status === "green" ? "Verified" : "Verification failed"} on ${verification.date} (UTC)`;
  const sources = verification ? [verification.source] : [];
  const scoreScope = scorecard?.exact === false ? " for a different commit · release score unavailable" : "";
  const score = scorecard
    ? `${label}${scorecard.score.toFixed(1)} on ${scorecard.date}${commit ? scoreScope : " · release tag commit unavailable"}`
    : `${label}Scorecard result unavailable`;
  return {
    release,
    cold: check(
      "Cold install",
      timing?.status ?? "amber",
      timing?.observed ?? `${label}Clean published-package timings unavailable`,
      [timing?.evidence ?? `${repository}/actions/workflows/first-minute.yml`],
    ),
    scorecard: check("Scorecard", scorecard?.exact ? (scorecard.score >= 6 ? "green" : "red") : "amber", score, [
      scorecardUrl,
      ...(scorecard ? [scorecard.source] : []),
    ]),
    provenance: check("npm provenance", verification?.provenance ?? "amber", outcome(verification?.provenance), [
      ...sources,
      release ? `https://www.npmjs.com/package/@velella/offing/v/${release.version}` : `${repository}/issues/927`,
    ]),
    attestation: check(
      "Release attestation",
      verification?.attestation ?? "amber",
      outcome(verification?.attestation),
      [...sources, release?.url ?? releaseUrl, `${repository}/actions/workflows/release-verify.yml`],
    ),
  };
}

export async function collectReadiness(input: ReadinessInput, fetcher: typeof fetch, metricsDirectory: string) {
  const [p0, milestone, adoption, site, release] = await Promise.all([
    countP0Bugs(fetcher).catch(() => undefined),
    countMilestoneIssues(input.milestone, fetcher).catch(() => undefined),
    readAdoption(metricsDirectory, input.date, input.commit).catch(() => undefined),
    siteCheck(input.site, fetcher),
    releaseChecks(input, fetcher),
  ]);
  const demos = await readReleaseDemos(input.demoRoot ?? ".", input.commit, release.release);
  return {
    formatVersion: 1,
    date: input.date,
    milestone: input.milestone,
    release: release.release ?? null,
    checks: [
      site.result,
      check("Release demos", demos.status, demos.observed, demos.evidence),
      release.cold,
      outstanding("Documentation and README", 1041),
      check(
        "Adoption",
        adoption?.complete ? "green" : "amber",
        adoption ? `Snapshot ${adoption.date} · ${adoption.measures.join(" · ")}` : "Dated snapshot unavailable",
        [adoption?.evidence ?? `${repository}/tree/${input.commit}/metrics`],
      ),
      release.scorecard,
      release.provenance,
      release.attestation,
      check("Open P0 bugs", p0 === undefined ? "amber" : p0 === 0 ? "green" : "red", p0?.toString() ?? "Unavailable", [
        p0Issues,
      ]),
      check("Open milestone issues", milestone === 0 ? "green" : "amber", milestone?.toString() ?? "Unavailable", [
        milestoneIssues(input.milestone),
      ]),
    ],
    pageIssues: site.issues,
  };
}

type ReadinessReport = Awaited<ReturnType<typeof collectReadiness>>;

export function renderReadiness(report: ReadinessReport): string {
  const rows = report.checks.map(({ name, status, observed, thresholds, evidence }) => {
    const links = evidence.map((url, index) => `[Source ${index + 1}](${url})`).join(", ");
    return `| ${name} | ${status} | ${observed} | ${thresholds} | ${links} |`;
  });
  return [
    `# Launch readiness · ${report.date}`,
    "",
    `Milestone [#${report.milestone}](${milestoneIssues(report.milestone)}). The launch decision stays with the owner.`,
    report.release
      ? `Published release [v${report.release.version}](${report.release.url}) on ${report.release.published} (UTC).`
      : "Published release information unavailable.",
    "",
    "| Check | Status | Observed | Thresholds | Evidence |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    ...report.pageIssues.map(({ address, detail }) => `- [${address}](${address}) · ${detail}`),
    "",
  ].join("\n");
}

function options(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      milestone: { type: "string" },
      out: { type: "string", default: "metrics/launch-readiness" },
      "site-dir": { type: "string" },
      "site-run": { type: "string" },
      "timing-dir": { type: "string" },
      version: { type: "string" },
    },
  });
  const { milestone, out, "site-dir": directory, "site-run": run, "timing-dir": timing, version } = values;
  if (!milestone || !/^[1-9]\d*$/.test(milestone) || !Number.isSafeInteger(Number(milestone))) {
    throw new Error("Pass the current GitHub milestone number as --milestone.");
  }
  if ((run === undefined) !== (directory === undefined) || (run !== undefined && !/^[1-9]\d*$/.test(run))) {
    throw new Error("Pass --site-dir and its numeric --site-run together.");
  }
  if (version && !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw new Error("Pass an exact release --version without the v prefix.");
  return {
    milestone: Number(milestone),
    out,
    ...(directory && run ? { site: { directory, run } } : {}),
    ...(timing ? { timing } : {}),
    ...(version ? { version } : {}),
  };
}

async function main(args: string[]) {
  const { out, ...input } = options(args);
  const date = new Date().toISOString().slice(0, 10);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const report = await collectReadiness({ ...input, date, commit }, fetch, "metrics");
  await mkdir(out, { recursive: true });
  await Promise.all([
    nodeFileSystem.writeTextAtomically(join(out, `${date}.json`), `${JSON.stringify(report, null, 2)}\n`),
    nodeFileSystem.writeTextAtomically(join(out, `${date}.md`), renderReadiness(report)),
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
